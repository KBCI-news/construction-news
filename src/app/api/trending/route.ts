import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type TrendingResponse = {
  searches: { query: string; count: number }[];
};

// 최근 7일간 인기 검색어 TOP 10
export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ searches: [] } satisfies TrendingResponse);
  }

  const { data, error } = await supabase.rpc("top_search_queries", {
    days: 7,
    result_limit: 10,
  });

  if (error || !data) {
    return NextResponse.json({ searches: [] } satisfies TrendingResponse);
  }

  const searches = (data as { query: string; count: number }[]).map((r) => ({
    query: r.query,
    count: Number(r.count),
  }));

  return NextResponse.json({ searches } satisfies TrendingResponse);
}
