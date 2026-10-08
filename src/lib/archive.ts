// 보관함 규칙 — DB의 purge_old_articles() 와 짝이다.
// 태그 없는 일반 기사 30일, 태그 기사 1년, 아래 검색어로 수집된 기사는 5년 보관한다.

/** 30일·1년 정리에서 빼고 5년 보관하는 검색어 — 그 검색어로 수집된 기사는 keep=true */
export const KEEP_TERMS = new Set(["KB신용정보"]);
export const KEEP_YEARS = 5;
export const TAGGED_RETENTION_DAYS = 365;

export const isKeepTerm = (term: string): boolean => KEEP_TERMS.has(term);

// 네이버 검색은 "KB신용정보"를 느슨하게 맞춘다(KB + 신용정보) — 1,000건이 7주치였고
// 대부분 무관한 기사였다. 제목·요약에 회사명이 실제로 있는 기사만 보관한다.
const KEEP_PHRASES = ["kb신용정보", "케이비신용정보"];
const squash = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase().replace(/<[^>]+>/g, "").replace(/\s+/g, "");

/** 보관 검색어로 가져온 기사 중 실제로 그 회사를 말하는 기사인지 */
export function keepMatches(title: string, description: string | null | undefined): boolean {
  const hay = squash(title) + " " + squash(description);
  return KEEP_PHRASES.some((p) => hay.includes(p));
}

/** 검색어별 수집 하한 시각 — 이보다 오래된 기사는 저장하지 않는다 */
export function retentionCutoff(term: string, nowMs: number): Date {
  const days = isKeepTerm(term) ? KEEP_YEARS * 365 : TAGGED_RETENTION_DAYS;
  return new Date(nowMs - days * 86_400_000);
}
