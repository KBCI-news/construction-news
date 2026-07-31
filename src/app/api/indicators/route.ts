import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type Indicator = {
  key: string;
  label: string;
  value: string | null;
  unit: string | null;
  asOf: string | null;
  sourceHost: string | null;
  sourceLink: string | null;
};

export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ indicators: [] });
  }

  const { data, error } = await supabase
    .from("indicators")
    .select("key,label,value,unit,as_of,source_host,source_link,sort_order")
    .order("sort_order", { ascending: true });

  if (error || !data) return NextResponse.json({ indicators: [] });

  // 값이 없는 지표는 아예 내려보내지 않는다 — 빈 칸을 보여주지 않기 위해
  const indicators: Indicator[] = (data as Record<string, string | null>[])
    .filter((r) => r.value)
    .map((r) => ({
      key: r.key as string,
      label: r.label as string,
      value: r.value,
      unit: r.unit,
      asOf: r.as_of,
      sourceHost: r.source_host,
      sourceLink: r.source_link,
    }));

  return NextResponse.json(
    { indicators },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
