import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, type ArticleRow } from "@/lib/supabase";
import { searchRelevance } from "@/lib/scoring";
import type { ImportanceTier } from "@/lib/lexicon";
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
};

export type FeedResponse = {
  total: number;
  items: FeedItem[];
  /** 아직 서버 채점이 한 번도 돌지 않았으면 true — UI가 등급 표기를 감춘다 */
  unscored: boolean;
};

const RANGE_HOURS: Record<string, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const SELECT =
  "link,original_link,title,description,pub_date,image_url,source_host," +
  "importance,importance_tier,urgent,desks,kinds,reasons,cluster_hosts,is_rep";

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
  cluster_hosts: number | null;
  is_rep: boolean | null;
};

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
});

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const desk = p.get("desk");
  const kinds = p.getAll("kind").filter(Boolean);
  const range = RANGE_HOURS[p.get("range") ?? "7d"] ?? RANGE_HOURS["7d"];
  const q = (p.get("q") ?? "").trim();
  const sortParam = p.get("sort");
  const minScore = Number(p.get("minScore") ?? "");
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 60), 1), 200);
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

  const since = new Date(Date.now() - range * 3_600_000).toISOString();

  let query = supabase
    .from("articles")
    .select(SELECT)
    .gte("pub_date", since);

  if (desk) query = query.contains("desks", [desk]);
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
  const { data, error } = await query.limit(fetchLimit);

  // 큐레이션 마이그레이션(0004)이 아직 적용되지 않은 환경에서도 사이트가 죽지 않게
  // 기본 컬럼만으로 재조회한다. 등급·근거는 UI에서 자동으로 감춰진다.
  if (error) {
    const legacy = await supabase
      .from("articles")
      .select("link,original_link,title,description,pub_date,image_url,source_host")
      .gte("pub_date", since)
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
        .map((it) => ({ it, r: searchRelevance(q, it) }))
        .filter((x) => x.r > 0)
        .sort((a, b) => b.r - a.r)
        .map((x) => x.it);
    }
    return NextResponse.json(
      { total: items.length, items: items.slice(0, limit), unscored: true } satisfies FeedResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const rows = (data ?? []) as unknown as Row[];
  let items = rows.map(toItem);
  const unscored = items.length > 0 && items.every((it) => it.importance === null);

  if (sort === "relevance" && q) {
    items = items
      .map((it) => ({
        it,
        // 질의어 관련도를 1순위로, 중요도를 보정항으로 합성한다
        r: searchRelevance(q, it) * 2 + (it.importance ?? 0) * 0.35,
      }))
      .sort((a, b) => b.r - a.r)
      .map((x) => x.it);
  }

  items = items.slice(0, limit);

  return NextResponse.json(
    { total: items.length, items, unscored } satisfies FeedResponse,
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
