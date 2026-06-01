import { FEATURED_KEYWORDS, LEGAL_ACTION_KEYWORDS } from "@/lib/categories";
import { hostOf, stripHtml } from "@/lib/format";

export type Article = {
  link: string;
  originallink: string;
  title: string;
  description: string;
  pubDate: string;
  categories: string[];
  imageUrl?: string | null;
};

// 언론사 표기, 말머리([속보]/[단독]), 괄호 보충설명, 공백/특수문자를 모두 제거해
// "사실상 같은 제목"을 한 키로 모은다. 기존보다 정규화를 공격적으로 적용해
// 매체별 미세한 제목 차이로 중복 노출되던 문제를 줄인다.
export const normalizeTitle = (title: string): string =>
  stripHtml(title)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "") // [단독] [속보] 등 말머리 제거
    .replace(/\([^)]*\)/g, "") // (종합) (영상) 등 보충 제거
    .replace(/["'“”‘’…·\-—~|]/g, "") // 따옴표/구두점 제거
    .replace(/[^\p{L}\p{N}]/gu, "") // 공백 포함 비문자/숫자 제거
    .slice(0, 28);

// 제목이 비어 키를 만들 수 없을 때만 link로 폴백한다.
const dedupeKey = (item: Article): string => normalizeTitle(item.title) || item.link;

// 같은 제목 묶음에서는 카테고리를 합치고, 이미지가 있는 기사를 대표로 남긴다.
export function dedupeArticles(items: Article[]): Article[] {
  const map = new Map<string, Article>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = map.get(key);
    if (existing) {
      const merged = new Set([...existing.categories, ...item.categories]);
      existing.categories = Array.from(merged);
      // 대표 기사에 이미지가 없고 새 기사에 있으면 이미지를 채운다.
      if (!existing.imageUrl && item.imageUrl) existing.imageUrl = item.imageUrl;
    } else {
      map.set(key, { ...item, categories: [...item.categories] });
    }
  }
  return Array.from(map.values());
}

export const relevanceScore = (item: Article): number => {
  const text = stripHtml(item.title);
  const featuredBonus = FEATURED_KEYWORDS.some((k) => text.includes(k)) ? 5 : 0;
  return item.categories.length * 2 + featuredBonus;
};

export const byRelevance = (a: Article, b: Article): number => {
  const diff = relevanceScore(b) - relevanceScore(a);
  if (diff !== 0) return diff;
  return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
};

export const byDate = (a: Article, b: Article): number =>
  new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();

// 여러 매체가 같은 사안을 각자 다른 제목으로 보도해 생기는 "유사 중복"을 묶는다.
// 제목의 의미 토큰(2자 이상)을 비교해, 같은 날 + 공통 토큰 3개 이상 + 자카드 0.3 이상이면
// 같은 사안으로 보고 한 건만 남긴다.
const SIM_THRESHOLD = 0.35;

// 제목을 글자 단위 bigram 집합으로 만든다. 단어 토큰 방식과 달리 한국어 형태
// 변형(봉사/봉사활동, 15년째/14년째 등)에도 유사도가 견고하게 잡힌다.
function titleBigrams(title: string): Set<string> {
  const s = stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function dayKey(pubDate: string): string {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "_";
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export function clusterArticles(items: Article[]): Article[] {
  const n = items.length;
  if (n < 2) return items;

  const parent = items.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const grams = items.map((it) => titleBigrams(it.title));

  // 같은 날짜끼리만 비교 (성능 + 오병합 방지)
  const buckets = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = dayKey(it.pubDate);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  });

  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const i = idxs[a];
        const j = idxs[b];
        // 너무 짧은 제목은 비교 제외 (불안정)
        if (grams[i].size < 6 || grams[j].size < 6) continue;
        if (diceSimilarity(grams[i], grams[j]) >= SIM_THRESHOLD) union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  });

  const result: Article[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length === 1) {
      result.push(items[idxs[0]]);
      continue;
    }
    const members = idxs.map((i) => items[i]);
    const rep = { ...members.slice().sort(byRelevance)[0] };
    const cats = new Set<string>();
    members.forEach((m) => m.categories.forEach((c) => cats.add(c)));
    rep.categories = Array.from(cats);
    if (!rep.imageUrl) {
      const withImg = members.find((m) => m.imageUrl);
      if (withImg) rep.imageUrl = withImg.imageUrl;
    }
    result.push(rep);
  }

  return result.sort(byDate);
}

export const isLegalArticle = (item: Article): boolean => {
  const text = stripHtml(item.title);
  const legalRelevant =
    item.categories.includes("law") || item.categories.includes("society");
  return legalRelevant && LEGAL_ACTION_KEYWORDS.some((k) => text.includes(k));
};

// HOT_KEYWORDS 각각이 기사 제목에 몇 번 등장하는지 집계해 상위 N개를 반환.
export function countKeywords(
  items: Article[],
  keywords: string[],
  limit = 10,
): { keyword: string; count: number }[] {
  return keywords
    .map((keyword) => ({
      keyword,
      count: items.filter((it) => stripHtml(it.title).includes(keyword)).length,
    }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export { hostOf, stripHtml };
