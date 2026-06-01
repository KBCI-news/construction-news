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
