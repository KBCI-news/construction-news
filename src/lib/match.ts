import { stripHtml } from "@/lib/format";

// 사전과 기사 텍스트 양쪽에 동일하게 적용하는 정규화.
// 공백/구두점을 제거해 "채권 추심" ↔ "채권추심", "NPL매각" ↔ "NPL 매각" 같은
// 표기 변형을 모두 같은 키로 취급한다. (기존 매칭은 제목만 원문 비교해 변형을 놓쳤다)
export const nfm = (s: string): string =>
  stripHtml(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// 위치별 신뢰 가중 — 제목에 있으면 강한 신호, 본문 깊은 곳이면 약한 신호
export const FIELD_WEIGHT = {
  title: 1.0,
  description: 0.85,
  body: 0.6,
} as const;

export type MatchField = keyof typeof FIELD_WEIGHT;

export type Haystack = {
  title: string;
  description: string;
  body?: string | null;
};

// 정규화된 검색 대상. 사전 매칭을 반복 호출하므로 한 번만 만들어 재사용한다.
export type NormalizedHaystack = {
  title: string;
  description: string;
  body: string;
};

export function normalizeHaystack(h: Haystack): NormalizedHaystack {
  return {
    title: nfm(h.title),
    description: nfm(h.description ?? ""),
    // 본문은 앞부분만 — 뒤로 갈수록 관련 없는 문구(제휴/저작권)가 섞인다
    body: nfm((h.body ?? "").slice(0, 1500)),
  };
}

// term이 어느 필드에서 발견됐는지와 그 위치 가중을 반환. 없으면 null.
export function findTerm(
  hay: NormalizedHaystack,
  normalizedTerm: string,
): { field: MatchField; weight: number } | null {
  if (!normalizedTerm) return null;
  if (hay.title.includes(normalizedTerm)) {
    return { field: "title", weight: FIELD_WEIGHT.title };
  }
  if (hay.description.includes(normalizedTerm)) {
    return { field: "description", weight: FIELD_WEIGHT.description };
  }
  if (hay.body.includes(normalizedTerm)) {
    return { field: "body", weight: FIELD_WEIGHT.body };
  }
  return null;
}

export function countTerm(hay: NormalizedHaystack, normalizedTerm: string): number {
  if (!normalizedTerm) return 0;
  const all = `${hay.title} ${hay.description} ${hay.body}`;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = all.indexOf(normalizedTerm, from);
    if (idx < 0) break;
    count += 1;
    from = idx + normalizedTerm.length;
  }
  return count;
}

// 사전 문자열 배열 중 하나라도 걸리면 true
export function matchesAny(hay: NormalizedHaystack, normalizedTerms: string[]): boolean {
  return normalizedTerms.some((t) => findTerm(hay, t) !== null);
}
