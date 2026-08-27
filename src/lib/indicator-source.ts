import type { SupabaseClient } from "@supabase/supabase-js";

// 기관 원본 통계의 출처 호스트 — source_kind가 조회되지 않을 때의 판별 기준
const OFFICIAL_HOSTS = ["ecos.bok.or.kr", "fisis.fss.or.kr", "kosis.kr"];

/**
 * 공식 통계(한국은행 ECOS 등)로 채워지는 지표 키 목록.
 *
 * 같은 지표를 기관 원본과 기사 추출이 번갈아 덮어쓰면 시계열이 뒤섞인다.
 * 공식값이 있는 지표는 기사 추출 쪽에서 아예 손대지 않는다.
 *
 * source_kind(0007)로 판별하되, PostgREST 복제본의 스키마 캐시가 새 컬럼을
 * 아직 모르는 경우가 실제로 있었다(캐시 미갱신 복제본이 간헐적으로 빈 결과를
 * 반환해 백필이 공식 현재값을 기사값으로 덮었다). 그래서 캐시와 무관한
 * source_host 판별을 항상 함께 쓴다.
 */
export async function officialIndicatorKeys(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const { data } = await supabase
      .from("indicators")
      .select("key")
      .eq("source_kind", "official");
    for (const r of (data ?? []) as { key: string }[]) keys.add(r.key);
  } catch {
    // source_kind를 모르는 스키마 — 아래 호스트 판별만 사용
  }
  try {
    const { data } = await supabase
      .from("indicators")
      .select("key")
      .in("source_host", OFFICIAL_HOSTS);
    for (const r of (data ?? []) as { key: string }[]) keys.add(r.key);
  } catch {
    // 조회 실패 시 남은 판별 결과만 사용
  }
  return keys;
}
