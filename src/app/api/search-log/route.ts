import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 사용자가 검색을 실행할 때 검색어를 기록한다(인기 검색어 집계용).
export async function POST(request: NextRequest) {
  let query: unknown;
  try {
    ({ query } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) {
    return NextResponse.json({ error: "query is empty" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    // 검색 로그는 부가 기능이므로 미설정 시 조용히 무시
    return NextResponse.json({ ok: false });
  }

  const { error } = await supabase
    .from("search_logs")
    .insert({ query: trimmed });
  if (error) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
