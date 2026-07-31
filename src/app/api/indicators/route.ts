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
  /** 'official' = 기관 원본 통계, 'news' = 기사 자동 추출 */
  sourceKind: "official" | "news";
  /** 화면에 그대로 쓰는 출처 표기 */
  sourceLabel: string;
  /** 오래된 것부터 정렬된 최근 추이 */
  history: IndicatorPoint[];
};

type Row = Record<string, string | null>;
type HistRow = { key: string; value: number; as_of: string; source_kind?: string };

const OFFICIAL_HOSTS: Record<string, string> = {
  "ecos.bok.or.kr": "한국은행",
  "fisis.fss.or.kr": "금융감독원",
};

export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ indicators: [] });
  }

  // source_kind는 0007 마이그레이션에서 추가됐다. 아직 적용 전이면 없이 조회한다.
  const COLS = "key,label,value,unit,as_of,source_host,sort_order";
  let rows: Row[] = [];
  {
    const first = await supabase
      .from("indicators")
      .select(`${COLS},source_kind`)
      .order("sort_order", { ascending: true });
    if (first.error) {
      const { data } = await supabase
        .from("indicators")
        .select(COLS)
        .order("sort_order", { ascending: true });
      rows = (data ?? []) as Row[];
    } else {
      rows = (first.data ?? []) as Row[];
    }
  }

  // 값이 없는 지표는 아예 내려보내지 않는다 — 빈 칸을 보여주지 않기 위해
  rows = rows.filter((r) => r.value);
  if (rows.length === 0) return NextResponse.json({ indicators: [] });

  const keys = rows.map((r) => r.key as string);

  // 시계열 — 연체율은 수준보다 추이가 중요하다
  let hist: HistRow[] = [];
  {
    const first = await supabase
      .from("indicator_history")
      .select("key,value,as_of,source_kind")
      .in("key", keys)
      .order("as_of", { ascending: true })
      .limit(1200);
    if (first.error) {
      const { data } = await supabase
        .from("indicator_history")
        .select("key,value,as_of")
        .in("key", keys)
        .order("as_of", { ascending: true })
        .limit(1200);
      hist = (data ?? []) as HistRow[];
    } else {
      hist = (first.data ?? []) as HistRow[];
    }
  }

  const indicators: Indicator[] = rows.map((r) => {
    const key = r.key as string;
    const kind = r.source_kind === "official" ? "official" : "news";
    // 기관 통계로 바뀐 지표는 과거에 쌓인 기사 추출 점을 섞지 않는다.
    // 근거가 다른 값이 한 선 위에 놓이면 추이를 잘못 읽게 된다.
    const points = hist
      .filter((h) => h.key === key)
      .filter((h) => kind !== "official" || h.source_kind === "official")
      .map((h) => ({ asOf: h.as_of, value: Number(h.value) }));

    const host = r.source_host ?? "";
    return {
      key,
      label: r.label as string,
      value: r.value,
      unit: r.unit,
      asOf: r.as_of,
      sourceKind: kind,
      sourceLabel:
        kind === "official" ? (OFFICIAL_HOSTS[host] ?? host ?? "기관 통계") : "기사 추출",
      history: points.slice(-24),
    };
  });

  return NextResponse.json(
    { indicators },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
