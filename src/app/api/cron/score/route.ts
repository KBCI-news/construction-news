import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { clusterArticles, type ClusterSummary } from "@/lib/cluster";
import { stripHtml } from "@/lib/format";
import { scoreArticle } from "@/lib/scoring";
import { extractIndicators } from "@/lib/indicators";
import { sourceTier } from "@/lib/lexicon";
import { officialIndicatorKeys } from "@/lib/indicator-source";

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

// 클러스터링 대상: 태그가 붙은 기사 전부 + 그 밖의 상위 점수 기사.
// 점수 30 이상만 묶던 때는 10점대 보도자료 전재(세종학당 후원 11건 등)가 전부
// 대표로 남아 '전체' 태그에 줄줄이 노출됐고, 점수가 식어 집합에서 빠진 대표와
// 남은 구성원이 따로 대표가 되는 일도 있었다. 뉴스 화면에 뜨는 건 태그 기사뿐이므로
// 그 집합은 점수와 무관하게 늘 통째로 묶는다. (7일 창: 태그 ~1.5천, 30점 이상 ~4.6천)
const CLUSTER_MIN_SCORE = 30;
const CLUSTER_MAX_ROWS = 6000;
// 창 밖 미묶음(소급 수집) 기사 — 회차당 최신 쪽부터 이 날짜 폭만큼, 최대 이 건수
// 창 밖 행은 묶음 결과가 바뀐 것만 저장하므로 회차 비용은 바뀐 건수에 비례한다.
// (창 4.9천 + 창 밖 1.1만을 전부 저장했더니 60초를 넘겨 504 — 정규 크론까지 멈췄다)
const BACKLOG_MAX_ROWS = 3000;
const NEIGHBOR_MAX_ROWS = 3000;
const BACKLOG_SPAN_DAYS = 120;
// 이 시각을 넘기면 창 밖 행 저장은 다음 회차로 미룬다(함수 상한 60초)
const OLD_ROWS_DEADLINE_MS = 42_000;
// 이 시각을 넘기면 어떤 행이든 저장을 멈추고 다음 회차로 미룬다 — 504 보다 낫다
const HARD_DEADLINE_MS = 52_000;
// 창 안 행도 묶음이 그대로면 이 시간 안에는 다시 채점·저장하지 않는다 — 신선도 감쇠는
// 여섯 시간에 한 번 반영해도 목록 순서에 차이가 없고, 7일 창 7천 행을 매 회차 다시
// 채점·저장하는 것만으로 60초를 넘겼다
const RESCORE_AFTER_MS = 6 * 3_600_000;

// 아직 점수가 없는 기사에 기본 점수를 부여하는 상한
const BACKFILL_MAX_ROWS = 3000;

// 사전을 고친 뒤 scored_at을 비우면 7일 창 밖(30일 보존분)은 영영 다시 채점되지
// 않아 옛 태그가 목록에 남았다. 창 밖 기사는 태그·점수만 다시 매기고 중복 묶음
// (cluster_id·is_rep)은 그대로 둔다 — 백필 경로처럼 is_rep=true로 되돌리면
// 이미 접힌 중복 기사가 다시 펼쳐진다.
const RETAG_WINDOW_DAYS = 30;
const RETAG_MAX_ROWS = 3000;

type Row = {
  link: string;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
  cluster_id: string | null;
  cluster_hosts: number | null;
  is_rep: boolean | null;
  matched_terms: string[] | null;
  scored_at: string | null;
};

const SELECT =
  "link,title,description,pub_date,source_host,cluster_id,cluster_hosts,is_rep,matched_terms,scored_at";

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

  // dry=1 : 묶음·채점만 계산하고 저장하지 않는다 — 배포 뒤 묶음 품질 점검용
  const dry = request.nextUrl.searchParams.get("dry") === "1";

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

  // ---- 1) 클러스터링 대상: 태그 기사 전부 + 상위 점수 기사 ---------------------
  const clusterRows: Row[] = [];
  // 창 밖(소급·이웃) 행 — 묶음 결과가 바뀐 것만 저장한다
  const oldLinks = new Set<string>();
  const startedAt = Date.now();
  let clusterSummaries: ClusterSummary[] = [];
  let backlogCount = 0;
  let backlogLeft = 0;
  let oldUnchanged = 0;
  let freshUnchanged = 0;
  try {
    const tagged = await fetchPaged(
      supabase,
      () =>
        supabase
          .from("articles")
          .select(SELECT)
          .gte("pub_date", since)
          .neq("desks", "{}")
          .order("pub_date", { ascending: false }) as never,
      CLUSTER_MAX_ROWS,
    );
    const top = await fetchPaged(
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
    // (c) 창 밖인데 한 번도 묶이지 않은 태그·보관 기사 — 소급 수집으로 들어온 과거 기사.
    //     최신 쪽부터 최대 BACKLOG_SPAN_DAYS 치를 집어 그 날짜 구간의 이미 묶인 이웃
    //     기사까지 함께 다시 묶는다 — 다른 검색어가 나중에 가져온 전재 기사가 이미 있는
    //     사안 묶음에 들어가야지 혼자 대표로 남으면 안 된다. 다음 회차가 이어 받는다.
    const backlogRaw = await fetchPaged(
      supabase,
      () =>
        supabase
          .from("articles")
          .select(SELECT)
          .lt("pub_date", since)
          .is("cluster_id", null)
          .or("desks.neq.{},keep.eq.true")
          .order("pub_date", { ascending: false }) as never,
      BACKLOG_MAX_ROWS,
    );
    let backlog: Row[] = [];
    let neighbors: Row[] = [];
    if (backlogRaw.length > 0) {
      const newestMs = new Date(backlogRaw[0].pub_date).getTime();
      const floorMs = Math.max(
        new Date(backlogRaw[backlogRaw.length - 1].pub_date).getTime(),
        newestMs - BACKLOG_SPAN_DAYS * 86_400_000,
      );
      backlog = backlogRaw.filter((r) => new Date(r.pub_date).getTime() >= floorMs);
      const fromIso = new Date(floorMs - 86_400_000).toISOString();
      const toIso = new Date(Math.min(newestMs + 86_400_000, new Date(since).getTime())).toISOString();
      neighbors = await fetchPaged(
        supabase,
        () =>
          supabase
            .from("articles")
            .select(SELECT)
            .gte("pub_date", fromIso)
            .lt("pub_date", toIso)
            .not("cluster_id", "is", null)
            .or("desks.neq.{},keep.eq.true")
            .order("pub_date", { ascending: false }) as never,
        NEIGHBOR_MAX_ROWS,
      );
    }
    const seen = new Set<string>();
    for (const r of [...tagged, ...top]) {
      if (seen.has(r.link)) continue;
      seen.add(r.link);
      clusterRows.push(r);
    }
    for (const r of [...backlog, ...neighbors]) {
      if (seen.has(r.link)) continue;
      seen.add(r.link);
      clusterRows.push(r);
      oldLinks.add(r.link);
    }
    backlogCount = backlog.length;
    backlogLeft = backlogRaw.length - backlog.length;
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to read articles", detail: (err as Error).message },
      { status: 500 },
    );
  }

  if (clusterRows.length > 0) {
    // 묶음 입력의 업권 term 은 지난 채점이 남긴 matched_terms 를 쓴다 — 행마다 사전을
    // 다시 돌리면(1.5만 행 × 2회) 그것만으로 60초를 넘겼다. 채점은 저장할 행에만 한다.
    const prelim = clusterRows.map((r) => ({
      link: r.link,
      title: r.title,
      pubDate: r.pub_date,
      sourceHost: r.source_host,
      matchedTerms: r.matched_terms ?? [],
      description: r.description,
    }));
    const clustered = clusterArticles(prelim);
    clusterSummaries = clustered.clusters;
    const byLink = new Map(clustered.assignments.map((c) => [c.link, c]));

    for (const r of clusterRows) {
      const c = byLink.get(r.link);
      const same =
        (c?.clusterId ?? r.link) === r.cluster_id &&
        (c?.isRep ?? true) === r.is_rep &&
        (c?.clusterHosts ?? 1) === (r.cluster_hosts ?? 1);
      if (same && oldLinks.has(r.link)) {
        oldUnchanged += 1;
        continue;
      }
      if (same && r.scored_at && now - new Date(r.scored_at).getTime() < RESCORE_AFTER_MS) {
        freshUnchanged += 1;
        continue;
      }
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

  // ---- 2b) 창 밖 재채점 대기 기사: 태그·점수만 갱신 ---------------------------
  let retagRows: (Row & { cluster_hosts: number | null })[] = [];
  try {
    retagRows = (await fetchPaged(
      supabase,
      () =>
        supabase
          .from("articles")
          .select(`${SELECT},cluster_hosts`)
          .lt("pub_date", since)
          .gte("pub_date", new Date(now - RETAG_WINDOW_DAYS * 86_400_000).toISOString())
          .is("scored_at", null)
          .order("pub_date", { ascending: false }) as never,
      RETAG_MAX_ROWS,
    )) as (Row & { cluster_hosts: number | null })[];
  } catch {
    retagRows = [];
  }
  for (const r of retagRows) {
    const res = scoreOf(r, r.cluster_hosts ?? 1);
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
      scored_at: new Date(now).toISOString(),
    });
  }

  // ---- 3) 저장 ---------------------------------------------------------------
  // 창 밖 재채점 행은 열 구성이 달라(묶음 열 없음) 따로 upsert한다 —
  // 한 번에 보내면 PostgREST가 빠진 열을 null로 채운다
  const retagLinks = new Set(retagRows.map((r) => r.link));
  const all = Array.from(payload.values()).filter((r) => !retagLinks.has(r.link as string));
  // 창 안 행을 먼저, 창 밖 행은 뒤에 — 시간이 모자라면 창 밖 행이 다음 회차로 밀린다
  const rows = [
    ...all.filter((r) => !oldLinks.has(r.link as string)),
    ...all.filter((r) => oldLinks.has(r.link as string)),
  ];
  const retagPayload = Array.from(payload.values()).filter((r) => retagLinks.has(r.link as string));

  if (dry) {
    const groups = new Map<string, { n: number; hosts: number; titles: string[] }>();
    for (const r of rows) {
      const id = r.cluster_id as string;
      const g = groups.get(id) ?? { n: 0, hosts: r.cluster_hosts as number, titles: [] };
      g.n += 1;
      if (g.titles.length < 4) g.titles.push(stripHtml(r.title as string).slice(0, 50));
      groups.set(id, g);
    }
    const sample = Array.from(groups.values())
      .filter((g) => g.n >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, 20);
    // 오병합 의심 — 구성원이 프로필과 덜 닮은 묶음부터
    const titleOf = new Map(clusterRows.map((r) => [r.link, stripHtml(r.title).slice(0, 50)]));
    const weak = clusterSummaries
      .filter((c) => c.links.length >= 3)
      .sort((a, b) => a.coherence - b.coherence)
      .slice(0, 12)
      .map((c) => ({
        n: c.links.length,
        coherence: Math.round(c.coherence * 100) / 100,
        titles: c.links.slice(0, 5).map((l) => titleOf.get(l) ?? l),
      }));
    return NextResponse.json({
      ok: true,
      dry: true,
      windowHours: WINDOW_HOURS,
      clusterCandidates: clusterRows.length,
      backlog: backlogCount,
      backlogLeft,
      clusters: groups.size,
      multi: Array.from(groups.values()).filter((g) => g.n >= 2).length,
      absorbed: rows.filter((r) => r.is_rep === false).length,
      sample,
      weak,
    });
  }

  let saved = 0;
  let deferred = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const elapsed = Date.now() - startedAt;
    if (
      (oldLinks.has(chunk[0].link as string) && elapsed > OLD_ROWS_DEADLINE_MS) ||
      elapsed > HARD_DEADLINE_MS
    ) {
      deferred = rows.length - i;
      break;
    }
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
  let retagged = 0;
  for (let i = 0; i < retagPayload.length; i += CHUNK) {
    const chunk = retagPayload.slice(i, i + CHUNK);
    const { error: rtErr } = await supabase
      .from("articles")
      .upsert(chunk, { onConflict: "link" });
    if (rtErr) {
      return NextResponse.json(
        { error: "Retag upsert failed", detail: rtErr.message, saved, retagged },
        { status: 500 },
      );
    }
    retagged += chunk.length;
  }

  // ---- 4) 경제지표 추출 -------------------------------------------------------
  // 지표 기사는 대개 중요도가 낮아 위 두 집합에 거의 들어오지 않는다
  // (7일간 지표 문장 4,556건 중 중요도 45↑는 31건뿐).
  // 그래서 지표 후보만 따로, 최신순으로 조회한다.
  let indicatorRows: Row[] = [];
  try {
    const { data: indData } = await supabase
      .from("articles")
      .select(SELECT)
      .gte("pub_date", since)
      .or(
        [
          "title.ilike.%연체율%",
          "description.ilike.%연체율%",
          "title.ilike.%기준금리%",
          "description.ilike.%기준금리%",
        ].join(","),
      )
      .order("pub_date", { ascending: false })
      .limit(800);
    indicatorRows = (indData ?? []) as Row[];
  } catch {
    indicatorRows = [];
  }

  // 최신 기사부터 훑어 지표별로 가장 최근 값 하나만 남긴다.
  const found = new Map<string, { value: string; row: Row }>();
  // 지표는 "가장 최근 값"만 쓰므로 최근 48시간 행만 훑는다 — 창 전체(7천 행)를 매번
  // 정규식으로 훑는 비용을 아낀다
  const scanFloor = now - 48 * 3_600_000;
  const scanned = [
    ...indicatorRows,
    ...clusterRows.filter((r) => new Date(r.pub_date).getTime() >= scanFloor),
    ...unscored,
  ].sort((a, b) => new Date(b.pub_date).getTime() - new Date(a.pub_date).getTime());
  for (const r of scanned) {
    // 지표는 게시물에 그대로 쓰이므로 신뢰할 만한 매체만 인정한다
    // (암호화폐·미등록 매체에서 뽑힌 수치가 올라오던 문제)
    if (sourceTier(r.source_host) < 0.8) continue;
    for (const hit of extractIndicators(r.title, r.description)) {
      if (!found.has(hit.key)) found.set(hit.key, { value: hit.value, row: r });
    }
  }
  // 한국은행 ECOS 등 기관 원본으로 채워지는 지표는 기사 추출이 덮어쓰지 않는다
  const official = await officialIndicatorKeys(supabase);
  let indicatorsUpdated = 0;
  for (const [key, { value, row }] of found) {
    if (official.has(key)) continue;
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

    // 시계열 적재 — 같은 (지표, 시점, 값)은 중복 저장하지 않는다.
    // 연체율은 수준보다 추이가 중요해서 이력을 남긴다.
    const numeric = Number(value.replace(/,/g, ""));
    if (Number.isFinite(numeric)) {
      await supabase.from("indicator_history").upsert(
        {
          key,
          value: numeric,
          as_of: row.pub_date,
          source_host: row.source_host,
          source_link: row.link,
        },
        { onConflict: "key,as_of,value", ignoreDuplicates: true },
      );
    }
  }

  const absorbed = rows.filter((r) => r.is_rep === false).length;

  return NextResponse.json({
    ok: true,
    windowHours: WINDOW_HOURS,
    clusterCandidates: clusterRows.length,
    backlog: backlogCount,
    backlogLeft,
    oldUnchanged,
    freshUnchanged,
    deferred,
    elapsedMs: Date.now() - startedAt,
    backfilled: unscored.length,
    saved,
    retagged,
    absorbed,
    indicatorScanned: indicatorRows.length,
    indicatorsUpdated,
    officialKeys: Array.from(official),
  });
}
