import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, type ArticleRow } from "@/lib/supabase";
import { stripHtml } from "@/lib/format";
import { searchRank } from "@/lib/scoring";
import { LEGAL_KINDS, TAG_DESKS, type ImportanceTier } from "@/lib/lexicon";
import type { ReasonTag } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export type FeedItem = {
  link: string;
  originallink: string;
  title: string;
  description: string;
  pubDate: string;
  imageUrl: string | null;
  sourceHost: string | null;
  importance: number | null;
  tier: ImportanceTier | null;
  urgent: boolean;
  desks: string[];
  kinds: string[];
  reasons: ReasonTag[];
  clusterHosts: number;
  matchedTerms: string[];
};

export type FeedResponse = {
  total: number;
  items: FeedItem[];
  /** 아직 서버 채점이 한 번도 돌지 않았으면 true — UI가 등급 표기를 감춘다 */
  unscored: boolean;
};

// "all"은 보관 중인 아카이브 전체 — 기간 필터를 걸지 않는다
// (보존: 태그 없는 일반 기사 30일, 태그 기사 3년, KB신용정보 수집분 5년 — purge_old_articles)
const RANGE_HOURS: Record<string, number | null> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  all: null,
};

const SELECT =
  "link,original_link,title,description,pub_date,image_url,source_host," +
  "importance,importance_tier,urgent,desks,kinds,reasons,cluster_id,cluster_hosts,is_rep,matched_terms";

type Row = Pick<
  ArticleRow,
  "link" | "original_link" | "title" | "description" | "pub_date" | "image_url" | "source_host"
> & {
  importance: number | null;
  importance_tier: string | null;
  urgent: boolean | null;
  desks: string[] | null;
  kinds: string[] | null;
  reasons: ReasonTag[] | null;
  cluster_id: string | null;
  cluster_hosts: number | null;
  is_rep: boolean | null;
  matched_terms: string[] | null;
};

/** 목록 응답에서 요약은 표시·검색 폴백용 240자면 충분하다 —
    150건 × 원문 크기의 JSON이 모바일 첫 로드를 무겁게 했다 */
const slim = (it: FeedItem): FeedItem => ({
  ...it,
  description: stripHtml(it.description).slice(0, 240),
});

const toItem = (r: Row): FeedItem => ({
  link: r.link,
  originallink: r.original_link ?? r.link,
  title: r.title,
  description: r.description ?? "",
  pubDate: r.pub_date,
  imageUrl: r.image_url ?? null,
  sourceHost: r.source_host ?? null,
  importance: r.importance ?? null,
  tier: (r.importance_tier as ImportanceTier | null) ?? null,
  urgent: Boolean(r.urgent),
  desks: r.desks ?? [],
  kinds: r.kinds ?? [],
  reasons: r.reasons ?? [],
  clusterHosts: r.cluster_hosts ?? 1,
  matchedTerms: r.matched_terms ?? [],
});

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const desk = p.get("desk");
  // scope=general : 우리 업권 사전에 걸리지 않은 '일반 뉴스'
  const scope = p.get("scope");
  const kinds = p.getAll("kind").filter(Boolean);
  const rangeKey = p.get("range") ?? "all";
  const range = rangeKey in RANGE_HOURS ? RANGE_HOURS[rangeKey] : null;
  const q = (p.get("q") ?? "").trim();
  // qt = 수집 검색어. 네이버 요약에 검색어가 안 보이는 기사가 많아 제목·요약 검색만으로는
  // "KB신용정보"로 가져온 기사 대부분을 놓쳤다 — 수집 검색어(query_terms)로도 찾는다
  const qt = (p.get("qt") ?? "").replace(/[%,(){}]/g, " ").trim();
  const sortParam = p.get("sort");
  const minScore = Number(p.get("minScore") ?? "");
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 60), 1), 200);
  // 목록 끝에서 이어 받기 — 최신순처럼 서버 정렬을 그대로 쓰는 조회에서만 의미가 있다
  const offset = Math.max(0, Math.floor(Number(p.get("offset") ?? 0) || 0));
  const includeDupes = p.get("dupes") === "1";

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supabase not configured" },
      { status: 500 },
    );
  }

  const since =
    range === null ? null : new Date(Date.now() - range * 3_600_000).toISOString();

  let query = supabase.from("articles").select(SELECT);
  if (since) query = query.gte("pub_date", since);

  if (desk) query = query.contains("desks", [desk]);
  if (scope === "general") query = query.eq("desks", "{}");
  else if (scope === "curated") query = query.neq("desks", "{}");
  // scope=tagged : 뉴스 화면의 태그 중 하나에라도 속하는 기사만 ("전체" 태그).
  // 태그 체계에 없는 데스크(정보보호·부실채권·대출 등)만 걸린 기사는 뺀다.
  // (서버에서 다시 거르던 것을 SQL 로 옮겨 offset 이어 받기가 정확히 맞물린다)
  else if (scope === "tagged") {
    query = query.or(
      `desks.ov.{${TAG_DESKS.join(",")}},kinds.ov.{${(LEGAL_KINDS as string[]).join(",")}}`,
    );
  }
  if (qt) {
    query = query.or(
      `query_terms.cs.{${qt}},title.ilike.%${qt}%,description.ilike.%${qt}%`,
    );
  }
  if (kinds.length) query = query.overlaps("kinds", kinds);
  if (!Number.isNaN(minScore) && p.get("minScore")) {
    query = query.gte("importance", minScore);
  }
  if (!includeDupes) query = query.eq("is_rep", true);

  // 검색은 자체 아카이브(최대 30일)를 대상으로 한다.
  // 기존에는 네이버 실시간 결과만 최신순으로 보여줘 관련도가 무시됐다.
  if (q) {
    const safe = q.replace(/[%,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  // 정렬: 검색이면 관련도, 아니면 중요도 → 최신
  const sort = sortParam ?? (q ? "relevance" : "score");
  if (sort === "date") {
    query = query.order("pub_date", { ascending: false });
  } else {
    // 관련도 정렬도 후보를 중요도순으로 넉넉히 받아 서버에서 재정렬한다
    query = query
      .order("importance", { ascending: false, nullsFirst: false })
      .order("pub_date", { ascending: false });
  }

  const fetchLimit = sort === "relevance" ? Math.min(limit * 4, 400) : limit;
  const { data, error } = await query.range(offset, offset + fetchLimit - 1);

  // 큐레이션 마이그레이션(0004)이 아직 적용되지 않은 환경에서도 사이트가 죽지 않게
  // 기본 컬럼만으로 재조회한다. 등급·근거는 UI에서 자동으로 감춰진다.
  if (error) {
    let legacyQuery = supabase
      .from("articles")
      .select("link,original_link,title,description,pub_date,image_url,source_host");
    if (since) legacyQuery = legacyQuery.gte("pub_date", since);
    const legacy = await legacyQuery
      .order("pub_date", { ascending: false })
      .limit(limit);

    if (legacy.error) {
      return NextResponse.json(
        { error: "Failed to read articles", detail: error.message },
        { status: 500 },
      );
    }

    const basic = (legacy.data ?? []) as unknown as Row[];
    let items = basic.map(toItem);
    if (q) {
      items = items
        .map((it) => ({ it, r: searchRank(q, it) }))
        .filter((x) => x.r > 0)
        .sort((a, b) => b.r - a.r)
        .map((x) => x.it);
    }
    return NextResponse.json(
      {
        total: items.length,
        items: items.slice(0, limit).map(slim),
        unscored: true,
      } satisfies FeedResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  let rows = (data ?? []) as unknown as Row[];
  // dupes=1 : 대표가 아닌 구성원도 받되 같은 사안은 하나만 — 회사명 태그(KB신용정보)는
  // 대표 제목에 회사명이 없어도 구성원이 언급하면 그 사안을 보여 줘야 하지만,
  // 전재 기사 열 건이 줄줄이 나오면 안 된다. 대표가 있으면 대표, 없으면 가장 새 기사.
  if (includeDupes) {
    const byCluster = new Map<string, Row>();
    for (const r of rows) {
      const key = r.cluster_id ?? r.link;
      const cur = byCluster.get(key);
      if (!cur || (r.is_rep && !cur.is_rep)) byCluster.set(key, r);
    }
    rows = rows.filter((r) => byCluster.get(r.cluster_id ?? r.link) === r);
  }
  let items = rows.map(toItem);
  const unscored = items.length > 0 && items.every((it) => it.importance === null);

  if (sort === "relevance" && q) {
    const now = Date.now();
    items = items
      .map((it) => ({ it, r: searchRank(q, { ...it, now }) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .map((x) => x.it);
  }

  items = items.slice(0, limit).map(slim);

  return NextResponse.json(
    { total: items.length, items, unscored } satisfies FeedResponse,
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
