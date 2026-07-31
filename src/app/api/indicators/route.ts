import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type IndicatorPoint = { asOf: string; value: number };

export type Indicator = {
  key: string;
  label: string;
  value: string | null;
  unit: string | null;
  asOf: string | null;
  sourceHost: string | null;
  sourceLink: string | null;
  /** 오래된 것부터 정렬된 최근 추이 */
  history: IndicatorPoint[];
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
  const rows = (data as Record<string, string | null>[]).filter((r) => r.value);

  // 시계열 — 연체율은 수준보다 추이가 중요하다
  const { data: hist } = await supabase
    .from("indicator_history")
    .select("key,value,as_of")
    .in("key", rows.map((r) => r.key as string))
    .order("as_of", { ascending: true })
    .limit(1200);

  const byKey = new Map<string, IndicatorPoint[]>();
  for (const h of (hist ?? []) as { key: string; value: number; as_of: string }[]) {
    const arr = byKey.get(h.key) ?? [];
    arr.push({ asOf: h.as_of, value: Number(h.value) });
    byKey.set(h.key, arr);
  }

  const indicators: Indicator[] = rows.map((r) => ({
    key: r.key as string,
    label: r.label as string,
    value: r.value,
    unit: r.unit,
    asOf: r.as_of,
    sourceHost: r.source_host,
    sourceLink: r.source_link,
    history: (byKey.get(r.key as string) ?? []).slice(-24),
  }));

  return NextResponse.json(
    { indicators },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
