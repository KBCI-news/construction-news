import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assignClusters } from "@/lib/cluster";
import { scoreArticle } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 클러스터링과 채점을 서버에서 일괄 수행한다.
// (이전에는 브라우저가 매 페이지 로드마다 1000건을 O(n²)로 재계산했다)
const WINDOW_HOURS = 72;
const MAX_ROWS = 4000;

type Row = {
  link: string;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
};

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

  const { data, error } = await supabase
    .from("articles")
    .select("link,title,description,pub_date,source_host")
    .gte("pub_date", since)
    .order("pub_date", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json(
      { error: "Failed to read articles", detail: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return NextResponse.json({ ok: true, scored: 0 });

  // 사내 관심 신호 — 담당자가 실제로 검색한 키워드를 순위에 되먹인다
  let internalTerms: string[] = [];
  const { data: trending } = await supabase.rpc("top_search_queries", {
    days: 7,
    result_limit: 20,
  });
  if (Array.isArray(trending)) {
    internalTerms = (trending as { query: string }[]).map((t) => t.query);
  }

  // 1차: term 매칭만으로 클러스터 힌트를 얻는다 (제목 유사도 + 공통 term)
  const prelim = rows.map((r) => ({
    link: r.link,
    title: r.title,
    pubDate: r.pub_date,
    sourceHost: r.source_host,
    matchedTerms: scoreArticle({
      title: r.title,
      description: r.description,
      pubDate: r.pub_date,
      sourceHost: r.source_host,
      internalTerms,
    }).matchedTerms,
  }));

  const clusters = assignClusters(prelim);
  const byLink = new Map(clusters.map((c) => [c.link, c]));

  const now = Date.now();
  const updates = rows.map((r) => {
    const c = byLink.get(r.link);
    const res = scoreArticle({
      title: r.title,
      description: r.description,
      pubDate: r.pub_date,
      sourceHost: r.source_host,
      clusterHosts: c?.clusterHosts ?? 1,
      wireOnly: c?.wireOnly ?? false,
      internalTerms,
      now,
    });
    return {
      link: r.link,
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
    };
  });

  // link가 unique 이므로 upsert로 일괄 갱신한다.
  // 필수 컬럼(title/pub_date)이 빠지면 insert 경로에서 실패하므로 원본 값을 함께 싣는다.
  const byLinkRow = new Map(rows.map((r) => [r.link, r]));
  const payload = updates.map((u) => {
    const src = byLinkRow.get(u.link)!;
    return { ...u, title: src.title, pub_date: src.pub_date };
  });

  let saved = 0;
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
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

  const tiers = updates.reduce<Record<string, number>>((acc, u) => {
    acc[u.importance_tier] = (acc[u.importance_tier] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    ok: true,
    scored: saved,
    windowHours: WINDOW_HOURS,
    tiers,
    urgent: updates.filter((u) => u.urgent).length,
  });
}
