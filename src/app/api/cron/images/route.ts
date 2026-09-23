import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchOgImage } from "@/lib/og";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 뉴스 썸네일 채우기. 네이버 검색 API는 이미지를 주지 않아 원문 페이지의
// og:image를 긁는다. 수집 크론 안에서 돌던 것을 떼어 냈다 — 검색어 호출과
// 시간을 나눠 쓰느라 회차당 60건이 한계였고, 실패를 기록하지 않아 og:image를
// 끝내 못 주는 상위 기사들이 매 회차 같은 자리를 차지했다.

/** 새 배치를 시작하지 않는 시점 — 배치 하나가 최대 8초(4초 × 두 주소) 걸린다 */
const BUDGET_MS = 45_000;
const CONCURRENCY = 20;
const PER_FETCH_TIMEOUT_MS = 4_000;
/** 이만큼 실패하면 포기한다 — 유료 기사·이미지 없는 속보 등 */
const MAX_ATTEMPTS = 3;
/** 실패한 기사는 이만큼 지난 뒤 다시 본다 — 일시적 차단·지연 대비 */
const RETRY_AFTER_MS = 2 * 3_600_000;
const WINDOW_DAYS = 7;
const MAX_CANDIDATES = 300;

type Row = { link: string; original_link: string | null; image_attempts: number | null };

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const supabase = getSupabaseAdmin();
  const since = new Date(started - WINDOW_DAYS * 86_400_000).toISOString();
  const retryBefore = new Date(started - RETRY_AFTER_MS).toISOString();

  // 화면에 나오는 것부터 — 태그 붙은 대표 기사, 그다음 나머지 대표 기사.
  // 같은 사건의 중복 기사(is_rep=false)는 목록에 나오지 않으므로 건너뛴다.
  const pick = async (tagged: boolean, limit: number): Promise<Row[]> => {
    let q = supabase
      .from("articles")
      .select("link, original_link, image_attempts")
      .is("image_url", null)
      .eq("is_rep", true)
      .lt("image_attempts", MAX_ATTEMPTS)
      .or(`image_checked_at.is.null,image_checked_at.lt."${retryBefore}"`)
      .gte("pub_date", since)
      .order("pub_date", { ascending: false })
      .limit(limit);
    q = tagged ? q.neq("desks", "{}") : q.eq("desks", "{}");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  };

  let rows: Row[];
  try {
    rows = await pick(true, MAX_CANDIDATES);
    if (rows.length < MAX_CANDIDATES) {
      rows = rows.concat(await pick(false, MAX_CANDIDATES - rows.length));
    }
  } catch (e) {
    return NextResponse.json(
      { error: "후보 조회 실패", detail: (e as Error).message },
      { status: 500 },
    );
  }

  let tried = 0;
  let filled = 0;
  let writeErrors = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    if (Date.now() - started > BUDGET_MS) break;
    const batch = rows.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (r) => {
        // 언론사 원문을 먼저, 안 되면 네이버 뉴스 사본 — 네이버 쪽은 og:image가 거의 항상 있다
        const urls = [r.original_link, r.link].filter(
          (u, k, all): u is string => Boolean(u) && all.indexOf(u) === k,
        );
        let image: string | null = null;
        for (const u of urls) {
          image = await fetchOgImage(u, PER_FETCH_TIMEOUT_MS);
          if (image) break;
        }
        return { r, image };
      }),
    );
    tried += batch.length;

    const checkedAt = new Date().toISOString();
    await Promise.all(
      results.map(async ({ r, image }) => {
        const { error } = await supabase
          .from("articles")
          .update({
            ...(image ? { image_url: image } : {}),
            image_attempts: (r.image_attempts ?? 0) + 1,
            image_checked_at: checkedAt,
          })
          .eq("link", r.link);
        if (error) writeErrors += 1;
        else if (image) filled += 1;
      }),
    );
  }

  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    tried,
    filled,
    ...(writeErrors ? { writeErrors } : {}),
    ms: Date.now() - started,
  });
}
