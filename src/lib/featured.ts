import { FEATURED_KEYWORDS } from "@/lib/categories";
import { stripHtml } from "@/lib/format";

export type TimeRange = "daily" | "weekly";

const inRange = (pubDate: string, range: TimeRange) => {
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return false;
  const ms = range === "daily" ? 86_400_000 : 7 * 86_400_000;
  return Date.now() - t < ms;
};

// featured 후보의 중요도 점수: 매칭된 카테고리 수 + 핵심 키워드 보너스
const score = (title: string, categories?: string[]): number => {
  const text = stripHtml(title);
  const bonus = FEATURED_KEYWORDS.some((k) => text.includes(k)) ? 5 : 0;
  return (categories?.length ?? 0) * 2 + bonus;
};

export function filterFeatured<
  T extends { title: string; pubDate: string; categories?: string[] },
>(items: T[], range: TimeRange, limit = 50): T[] {
  const filtered = items
    .filter((it) => inRange(it.pubDate, range))
    .filter((it) => {
      const text = stripHtml(it.title);
      return FEATURED_KEYWORDS.some((k) => text.includes(k));
    });

  const byDateDesc = (a: T, b: T) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();

  // 일간: 지난 24시간 최신순 / 주간: 지난 7일 중요도(관련도)순
  // → 두 탭이 의미 있게 다른 결과를 보여준다.
  const sorted =
    range === "weekly"
      ? filtered.slice().sort((a, b) => {
          const d = score(b.title, b.categories) - score(a.title, a.categories);
          return d !== 0 ? d : byDateDesc(a, b);
        })
      : filtered.slice().sort(byDateDesc);

  return sorted.slice(0, limit);
}
