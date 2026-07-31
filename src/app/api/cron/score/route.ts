import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assignClusters } from "@/lib/cluster";
import { scoreArticle } from "@/lib/scoring";
import { extractIndicators } from "@/lib/indicators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 클러스터링과 채점을 서버에서 일괄 수행한다.
// 창을 7일로 두어 '주간' 뷰가 '일간'과 같은 목록을 보여주던 문제를 없앤다.
// (이전에는 브라우저가 매 페이지 로드마다 1000건을 O(n²)로 재계산했다)
const WINDOW_HOURS = 24 * 7;

// PostgREST는 요청당 행 수를 1000으로 제한하므로 .limit()에 기대지 않고
// .range()로 명시적으로 페이지를 넘긴다. (이걸 놓쳐서 14,945건 중 1,000건만
// 클러스터링되고 나머지가 전부 is_rep=true 로 남아 중복 노출됐다)
const PAGE = 1000;

// 클러스터링 대상: 피드 상단에 오를 수 있는 기사만. O(n²) 비용을 묶는다.
const CLUSTER_MIN_SCORE = 45;
const CLUSTER_MAX_ROWS = 5000;

// 아직 점수가 없는 기사에 기본 점수를 부여하는 상한
const BACKFILL_MAX_ROWS = 3000;

type Row = {
  link: string;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
};

const SELECT = "link,title,description,pub_date,source_host";

async function fetchPaged(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  build: () => ReturnType<ReturnType<typeof getSupabaseAdmin>["from"]>,
  maxRows: number,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const to = Math.min(from + PAGE, maxRows) - 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (build() as any).range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < to - from + 1) break; // 마지막 페이지
  }
  return out;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  // 사내 관심 신호 — 담당자가 실제로 검색한 키워드를 순위에 되먹인다
  let internalTerms: string[] = [];
  const { data: trending } = await supabase.rpc("top_search_queries", {
    days: 7,
    result_limit: 20,
  });
  if (Array.isArray(trending)) {
    internalTerms = (trending as { query: string }[]).map((t) => t.query);
  }

  const now = Date.now();
  const scoreOf = (r: Row, clusterHosts = 1, wireOnly = false) =>
    scoreArticle({
      title: r.title,
      description: r.description,
      pubDate: r.pub_date,
      sourceHost: r.source_host,
      clusterHosts,
      wireOnly,
      internalTerms,
      now,
    });

  const payload = new Map<string, Record<string, unknown>>();

  // ---- 1) 클러스터링 대상: 상위 점수 기사 ------------------------------------
  let clusterRows: Row[] = [];
  try {
    clusterRows = await fetchPaged(
      supabase,
      () =>
        supabase
          .from("articles")
          .select(SELECT)
          .gte("pub_date", since)
          .gte("importance", CLUSTER_MIN_SCORE)
          .order("importance", { ascending: false })
          .order("pub_date", { ascending: false }) as never,
      CLUSTER_MAX_ROWS,
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to read articles", detail: (err as Error).message },
      { status: 500 },
    );
  }

  if (clusterRows.length > 0) {
    const prelim = clusterRows.map((r) => ({
      link: r.link,
      title: r.title,
      pubDate: r.pub_date,
      sourceHost: r.source_host,
      matchedTerms: scoreOf(r).matchedTerms,
    }));
    const clusters = assignClusters(prelim);
    const byLink = new Map(clusters.map((c) => [c.link, c]));

    for (const r of clusterRows) {
      const c = byLink.get(r.link);
      const res = scoreOf(r, c?.clusterHosts ?? 1, c?.wireOnly ?? false);
      payload.set(r.link, {
        link: r.link,
        title: r.title,
        pub_date: r.pub_date,
        importance: res.score,
        importance_tier: res.tier,
        importance_parts: res.parts,
        reasons: res.reasons,
        urgent: res.urgent,
        desks: res.desks,
        kinds: res.kinds,
        matched_terms: res.matchedTerms.slice(0, 40),
        cluster_id: c?.clusterId ?? r.link,
        cluster_hosts: c?.clusterHosts ?? 1,
        is_rep: c?.isRep ?? true,
        scored_at: new Date(now).toISOString(),
      });
    }
  }

  // ---- 2) 아직 채점되지 않은 기사에 기본 점수 부여 ---------------------------
  let unscored: Row[] = [];
  try {
    unscored = await fetchPaged(
      supabase,
      () =>
        supabase
          .from("articles")
          .select(SELECT)
          .gte("pub_date", since)
          .is("scored_at", null)
          .order("pub_date", { ascending: false }) as never,
      BACKFILL_MAX_ROWS,
    );
  } catch {
    unscored = [];
  }

  for (const r of unscored) {
    if (payload.has(r.link)) continue;
    const res = scoreOf(r);
    payload.set(r.link, {
      link: r.link,
      title: r.title,
      pub_date: r.pub_date,
      importance: res.score,
      importance_tier: res.tier,
      importance_parts: res.parts,
      reasons: res.reasons,
      urgent: res.urgent,
      desks: res.desks,
      kinds: res.kinds,
      matched_terms: res.matchedTerms.slice(0, 40),
      cluster_id: r.link,
      cluster_hosts: 1,
      is_rep: true,
      scored_at: new Date(now).toISOString(),
    });
  }

  // ---- 3) 저장 ---------------------------------------------------------------
  const rows = Array.from(payload.values());
  let saved = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error: upErr } = await supabase
      .from("articles")
      .upsert(chunk, { onConflict: "link" });
    if (upErr) {
      return NextResponse.json(
        { error: "Score upsert failed", detail: upErr.message, saved },
        { status: 500 },
      );
    }
    saved += chunk.length;
  }

  // ---- 4) 경제지표 추출 -------------------------------------------------------
  // 최신 기사부터 훑어 지표별로 가장 최근 값 하나만 남긴다.
  const found = new Map<string, { value: string; row: Row }>();
  const scanned = [...clusterRows, ...unscored].sort(
    (a, b) => new Date(b.pub_date).getTime() - new Date(a.pub_date).getTime(),
  );
  for (const r of scanned) {
    for (const hit of extractIndicators(r.title, r.description)) {
      if (!found.has(hit.key)) found.set(hit.key, { value: hit.value, row: r });
    }
  }
  let indicatorsUpdated = 0;
  for (const [key, { value, row }] of found) {
    const { error: indErr } = await supabase
      .from("indicators")
      .update({
        value,
        as_of: row.pub_date,
        source_host: row.source_host,
        source_link: row.link,
        source_title: row.title,
        updated_at: new Date(now).toISOString(),
      })
      .eq("key", key);
    if (!indErr) indicatorsUpdated += 1;
  }

  const absorbed = rows.filter((r) => r.is_rep === false).length;

  return NextResponse.json({
    ok: true,
    windowHours: WINDOW_HOURS,
    clusterCandidates: clusterRows.length,
    backfilled: unscored.length,
    saved,
    absorbed,
    indicatorsUpdated,
  });
}
