// 보관함 규칙 — DB의 purge_old_articles() 와 짝이다.
// 태그 없는 일반 기사 30일, 태그 기사 1년, 아래 검색어로 수집된 기사는 5년 보관한다.

/** 30일·1년 정리에서 빼고 5년 보관하는 검색어 — 그 검색어로 수집된 기사는 keep=true */
export const KEEP_TERMS = new Set(["KB신용정보"]);
export const KEEP_YEARS = 5;
export const TAGGED_RETENTION_DAYS = 365;

export const isKeepTerm = (term: string): boolean => KEEP_TERMS.has(term);

/** 검색어별 수집 하한 시각 — 이보다 오래된 기사는 저장하지 않는다 */
export function retentionCutoff(term: string, nowMs: number): Date {
  const days = isKeepTerm(term) ? KEEP_YEARS * 365 : TAGGED_RETENTION_DAYS;
  return new Date(nowMs - days * 86_400_000);
}
