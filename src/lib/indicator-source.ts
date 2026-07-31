import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 공식 통계(한국은행 ECOS 등)로 채워지는 지표 키 목록.
 *
 * 같은 지표를 기관 원본과 기사 추출이 번갈아 덮어쓰면 시계열이 뒤섞인다.
 * 공식값이 있는 지표는 기사 추출 쪽에서 아예 손대지 않는다.
 * 0007 마이그레이션 이전 스키마에서는 빈 집합을 돌려주어 기존 동작을 유지한다.
 */
export async function officialIndicatorKeys(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("indicators")
      .select("key")
      .eq("source_kind", "official");
    if (error || !data) return new Set();
    return new Set((data as { key: string }[]).map((r) => r.key));
  } catch {
    return new Set();
  }
}
