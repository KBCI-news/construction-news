import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type BidItem = {
  bidKey: string;
  bidNo: string;
  bidOrd: string;
  title: string;
  workDiv: string | null;
  noticeKind: string | null;
  contractMethod: string | null;
  noticeAgency: string | null;
  demandAgency: string | null;
  region: string | null;
  presmptPrice: number | null;
  budgetAmount: number | null;
  noticeDt: string | null;
  closeDt: string | null;
  openingDt: string | null;
  detailUrl: string | null;
  areas: string[];
  matchedTerms: string[];
  relevance: number;
};

export type BidsResponse = {
  total: number;
  items: BidItem[];
  /** 수집 크론이 마지막으로 돈 시각 — "멈춘 것"과 "공고가 없는 것"을 구분한다 */
  lastRun: { ranAt: string; matched: number; ok: boolean; detail: string | null } | null;
  /** 테이블 마이그레이션이 아직 안 됐으면 false */
  ready: boolean;
  detail?: string;
};

const SELECT =
  "bid_key,bid_no,bid_ord,title,work_div,notice_kind,contract_method," +
  "notice_agency,demand_agency,region,presmpt_price,budget_amount," +
  "notice_dt,close_dt,opening_dt,detail_url,areas,matched_terms,relevance";

const RANGE_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

type Row = {
  bid_key: string;
  bid_no: string;
  bid_ord: string;
  title: string;
  work_div: string | null;
  notice_kind: string | null;
  contract_method: string | null;
  notice_agency: string | null;
  demand_agency: string | null;
  region: string | null;
  presmpt_price: number | null;
  budget_amount: number | null;
  notice_dt: string | null;
  close_dt: string | null;
  opening_dt: string | null;
  detail_url: string | null;
  areas: string[] | null;
  matched_terms: string[] | null;
  relevance: number | null;
};

const toItem = (r: Row): BidItem => ({
  bidKey: r.bid_key,
  bidNo: r.bid_no,
  bidOrd: r.bid_ord,
  title: r.title,
  workDiv: r.work_div,
  noticeKind: r.notice_kind,
  contractMethod: r.contract_method,
  noticeAgency: r.notice_agency,
  demandAgency: r.demand_agency,
  region: r.region,
  presmptPrice: r.presmpt_price,
  budgetAmount: r.budget_amount,
  noticeDt: r.notice_dt,
  closeDt: r.close_dt,
  openingDt: r.opening_dt,
  detailUrl: r.detail_url,
  areas: r.areas ?? [],
  matchedTerms: r.matched_terms ?? [],
  relevance: r.relevance ?? 0,
});

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const area = p.get("area");
  // 기본은 '진행중' — 이미 마감된 공고는 액션이 불가능하다
  const status = p.get("status") ?? "open";
  const rangeKey = p.get("range") ?? "30d";
  const days = rangeKey in RANGE_DAYS ? RANGE_DAYS[rangeKey] : 30;
  const q = (p.get("q") ?? "").trim();
  const sort = p.get("sort") ?? "notice";
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 100), 1), 300);

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supabase not configured" },
      { status: 500 },
    );
  }

  let query = supabase.from("bids").select(SELECT);

  if (days !== null) {
    query = query.gte("notice_dt", new Date(Date.now() - days * 86_400_000).toISOString());
  }
  if (area) query = query.contains("areas", [area]);

  const nowIso = new Date().toISOString();
  // 마감일시가 비어 오는 공고가 있다. '진행중'에서 떨구면 조용히 사라지므로
  // null은 진행중 쪽에 남겨 두고 화면에서 마감 '-'로 보이게 한다.
  if (status === "open") query = query.or(`close_dt.gte.${nowIso},close_dt.is.null`);
  else if (status === "closed") query = query.lt("close_dt", nowIso);

  if (q) {
    const safe = q.replace(/[%,()]/g, " ").trim();
    if (safe) {
      query = query.or(
        `title.ilike.%${safe}%,demand_agency.ilike.%${safe}%,notice_agency.ilike.%${safe}%`,
      );
    }
  }

  if (sort === "close") {
    // 마감 임박순 — 마감일이 빈 공고는 뒤로
    query = query.order("close_dt", { ascending: true, nullsFirst: false });
  } else if (sort === "relevance") {
    query = query
      .order("relevance", { ascending: false })
      .order("notice_dt", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("notice_dt", { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    // 0009 마이그레이션 전에는 테이블이 없다. 사이트를 죽이지 않고 안내한다.
    return NextResponse.json(
      {
        total: 0,
        items: [],
        lastRun: null,
        ready: false,
        detail: error.message,
      } satisfies BidsResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const items = ((data ?? []) as unknown as Row[]).map(toItem);

  const { data: runRows } = await supabase
    .from("bid_runs")
    .select("ran_at,matched,ok,detail")
    .order("ran_at", { ascending: false })
    .limit(1);

  const run = (runRows ?? [])[0] as
    | { ran_at: string; matched: number; ok: boolean; detail: string | null }
    | undefined;

  return NextResponse.json(
    {
      total: items.length,
      items,
      lastRun: run
        ? { ranAt: run.ran_at, matched: run.matched, ok: run.ok, detail: run.detail }
        : null,
      ready: true,
    } satisfies BidsResponse,
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
