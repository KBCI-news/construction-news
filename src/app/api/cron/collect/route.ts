import { NextRequest, NextResponse } from "next/server";
import { POLL_MINUTES, QUERY_TERMS } from "@/lib/lexicon";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hostOf } from "@/lib/format";
import { fetchOgImage } from "@/lib/og";
import { scoreArticle } from "@/lib/scoring";
import type { NaverNewsItem } from "@/app/api/naver-news/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const PER_KEYWORD = 100;

// 한 회차에 호출할 검색어 상한. 티어별 폴링 주기로 자연히 분산된다.
const MAX_QUERIES_PER_RUN = 40;

// 이미지 백필: 매번 최신만 재시도하면 NULL 백로그가 단조 증가하므로
// 오래된 것부터 순환하도록 pub_date 오름차순으로 가져온다.
const MAX_IMAGE_CRAWL = 60;
const IMAGE_CONCURRENCY = 10;

type ArticleUpsert = {
  link: string;
  original_link: string | null;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
  categories: string[];
  desks: string[];
  kinds: string[];
  matched_terms: string[];
  importance: number;
  importance_tier: string;
  urgent: boolean;
  reasons: unknown;
  importance_parts: unknown;
  scored_at: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * 이번 회차에 호출할 검색어를 티어별 주기에 따라 고른다.
 * 분 단위 시계를 슬롯으로 써서, 배포마다 상태를 저장하지 않고도
 * T0는 30분마다 / T1은 120분마다 도는 효과를 낸다.
 */
function dueTerms(nowMinutes: number) {
  const due = QUERY_TERMS.filter((t) => {
    const period = POLL_MINUTES[t.tier];
    const slot = Math.floor(nowMinutes / 30) * 30; // cron이 30분 주기
    return slot % period === 0;
  });
  // 항상 T0를 우선 채우고 남는 자리를 하위 티어로
  const sorted = due.sort((a, b) => a.tier - b.tier);
  return sorted.slice(0, MAX_QUERIES_PER_RUN);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Naver API credentials are not configured" },
      { status: 500 },
    );
  }

  const nowMs = Date.now();
  const tasks = dueTerms(Math.floor(nowMs / 60_000));

  let fetchedCount = 0;
  const failures: { keyword: string; status: number }[] = [];

  const fetchWithRetry = async (keyword: string): Promise<NaverNewsItem[]> => {
    const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(keyword)}&display=${PER_KEYWORD}&sort=date`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { items: NaverNewsItem[] };
        fetchedCount += data.items.length;
        return data.items;
      }
      // 429는 지수 백오프로 재시도 — 조용히 실패하지 않게 한다
      if (response.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      failures.push({ keyword, status: response.status });
      return [];
    }
    return [];
  };

  // 배치당 5개씩, 배치 간 800ms — 네이버 rate limit 회피
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 800;
  const collected: NaverNewsItem[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((t) => fetchWithRetry(t.term)));
    batchResults.forEach((items) => collected.push(...items));
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // 링크 기준 중복 제거 + 수집 시점에 사전 태깅·1차 채점
  // (클러스터 기반 보도량은 /api/cron/score 가 나중에 보정한다)
  const byKey = new Map<string, ArticleUpsert>();
  for (const item of collected) {
    if (byKey.has(item.link)) continue;
    const res = scoreArticle({
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      sourceHost: hostOf(item.originallink || item.link),
      now: nowMs,
    });
    byKey.set(item.link, {
      link: item.link,
      original_link: item.originallink || null,
      title: item.title,
      description: item.description || null,
      pub_date: new Date(item.pubDate).toISOString(),
      source_host: hostOf(item.originallink || item.link),
      categories: [],
      desks: res.desks,
      kinds: res.kinds,
      matched_terms: res.matchedTerms.slice(0, 40),
      importance: res.score,
      importance_tier: res.tier,
      urgent: res.urgent,
      reasons: res.reasons,
      importance_parts: res.parts,
      scored_at: new Date(nowMs).toISOString(),
    });
  }

  const rows = Array.from(byKey.values());
  const supabase = getSupabaseAdmin();

  let upsertedCount = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from("articles")
      .upsert(rows, { onConflict: "link", count: "exact" });
    if (error) {
      return NextResponse.json(
        { error: "Supabase upsert failed", detail: error.message },
        { status: 500 },
      );
    }
    upsertedCount = count ?? rows.length;
  }

  const imagesFilled = await backfillImages(supabase);

  const { error: purgeError } = await supabase.rpc("purge_old_articles");
  await supabase.rpc("purge_old_search_logs");

  return NextResponse.json({
    ok: true,
    queriesRun: tasks.length,
    fetched: fetchedCount,
    unique: rows.length,
    upserted: upsertedCount,
    imagesFilled,
    failures,
    ...(purgeError ? { warning: "Purge failed", detail: purgeError.message } : {}),
  });
}

async function backfillImages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<number> {
  // 중요도가 높은 기사부터 이미지를 채운다 — 게시판에 붙일 후보가 우선이다
  const { data, error } = await supabase
    .from("articles")
    .select("link, original_link")
    .is("image_url", null)
    .gte("pub_date", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("importance", { ascending: false, nullsFirst: false })
    .limit(MAX_IMAGE_CRAWL);

  if (error || !data || data.length === 0) return 0;

  const targets = data as { link: string; original_link: string | null }[];
  let filled = 0;

  for (let i = 0; i < targets.length; i += IMAGE_CONCURRENCY) {
    const batch = targets.slice(i, i + IMAGE_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (row) => ({
        link: row.link,
        image: await fetchOgImage(row.original_link || row.link),
      })),
    );
    await Promise.all(
      resolved
        .filter((r) => r.image)
        .map(async (r) => {
          const { error: updateError } = await supabase
            .from("articles")
            .update({ image_url: r.image })
            .eq("link", r.link);
          if (!updateError) filled += 1;
        }),
    );
  }

  return filled;
}
