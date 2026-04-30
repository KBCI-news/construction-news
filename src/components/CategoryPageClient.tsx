"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewsResponseItem } from "@/app/api/news/route";
import { CATEGORIES, FEATURED_KEYWORDS } from "@/lib/categories";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { NewsCard } from "@/components/NewsCard";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

const normalizeTitle = (title: string): string =>
  stripHtml(title)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 40);

const relevance = (item: NewsResponseItem): number => {
  const text = stripHtml(item.title);
  const featuredBonus = FEATURED_KEYWORDS.some((k) => text.includes(k))
    ? 5
    : 0;
  return item.categories.length * 2 + featuredBonus;
};

const sortByRelevance = (a: NewsResponseItem, b: NewsResponseItem) => {
  const ra = relevance(a);
  const rb = relevance(b);
  if (rb !== ra) return rb - ra;
  return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
};

export default function CategoryPageClient({
  categoryId,
  categoryLabel,
}: {
  categoryId: string;
  categoryLabel: string;
}) {
  const [items, setItems] = useState<NewsResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/news", { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "요청 실패");
        return json;
      })
      .then((json) => setItems(json.items ?? []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const dedupedAll = useMemo(() => {
    const map = new Map<string, NewsResponseItem>();
    for (const item of items) {
      const key = normalizeTitle(item.title) || item.link;
      const existing = map.get(key);
      if (existing) {
        const merged = new Set([...existing.categories, ...item.categories]);
        existing.categories = Array.from(merged);
      } else {
        map.set(key, { ...item, categories: [...item.categories] });
      }
    }
    return Array.from(map.values());
  }, [items]);

  const categoryItems = useMemo(() => {
    return dedupedAll
      .filter((it) => it.categories.includes(categoryId))
      .slice()
      .sort(sortByRelevance);
  }, [dedupedAll, categoryId]);

  const topRanked = useMemo(
    () => dedupedAll.slice().sort(sortByRelevance).slice(0, 5),
    [dedupedAll],
  );

  return (
    <div className="space-y-8">
      <div className="border-b-2 border-gray-900 pb-3">
        <p className="text-[11px] font-bold tracking-widest text-[#FFB81C]">
          KBCI NEWS · {categoryLabel.toUpperCase()}
        </p>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-tight text-gray-900 sm:text-[36px]">
          {categoryLabel}
        </h1>
        <p className="mt-1 text-[12px] text-gray-500 sm:text-[13px]">
          관련도 높은 순 ·{" "}
          {loading ? "..." : `총 ${categoryItems.length}건`}
        </p>
      </div>

      {error && (
        <div className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-12">
        <div className="lg:col-span-2">
          {loading ? (
            <SkeletonList />
          ) : categoryItems.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <HeroArticle item={categoryItems[0]} />
              {categoryItems.length > 1 && (
                <div className="mt-6 border-t border-gray-200" />
              )}
              <div className="divide-y divide-gray-200">
                {categoryItems.slice(1).map((item) => (
                  <NewsCard key={item.link} item={item} />
                ))}
              </div>
            </>
          )}
        </div>

        <aside>
          <div className="lg:sticky lg:top-[140px]">
            <div className="border-b-2 border-gray-900 pb-2">
              <h2 className="text-[12px] font-bold tracking-widest text-gray-900">
                주요 뉴스 TOP 5
              </h2>
            </div>
            {loading ? (
              <ul className="mt-5 space-y-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="animate-pulse">
                    <div className="h-4 w-full rounded bg-gray-200" />
                    <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
                  </li>
                ))}
              </ul>
            ) : (
              <ol className="mt-5 space-y-5">
                {topRanked.map((item, idx) => (
                  <li key={item.link}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-3"
                    >
                      <span className="shrink-0 text-[16px] font-extrabold tabular-nums text-[#FFB81C]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                          {stripHtml(item.title)}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {hostOf(item.originallink)} —{" "}
                          {formatRelative(item.pubDate)}
                        </p>
                      </div>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function HeroArticle({ item }: { item: NewsResponseItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block"
    >
      {item.categories.length > 0 && (
        <div className="mb-3 text-[11px] font-bold tracking-wider text-[#FFB81C]">
          {item.categories.map((id) => labelOf(id)).join(" · ")}
        </div>
      )}
      <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[32px]">
        {stripHtml(item.title)}
      </h2>
      <p className="mt-3 text-[12px] text-gray-500 sm:text-[13px]">
        <span className="font-medium text-gray-700">
          {hostOf(item.originallink)}
        </span>
        <span className="mx-1.5">—</span>
        <span>{formatRelative(item.pubDate)}</span>
      </p>
    </a>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse border-b border-gray-200 pb-6">
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-32 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-y-2 border-gray-200 py-16 text-center text-sm text-gray-500">
      이 카테고리의 뉴스가 없습니다.
    </div>
  );
}
