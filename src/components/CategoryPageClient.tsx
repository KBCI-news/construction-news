"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewsResponseItem } from "@/app/api/news/route";
import { CATEGORIES, FEATURED_KEYWORDS } from "@/lib/categories";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { NewsCard } from "@/components/NewsCard";

const CATEGORY_COLORS: Record<string, string> = {
  "debt-collection": "bg-blue-50 text-blue-700 ring-blue-100",
  "credit-investigation": "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "e-document": "bg-violet-50 text-violet-700 ring-violet-100",
  "finance-law": "bg-amber-50 text-amber-700 ring-amber-100",
  "labor-law": "bg-rose-50 text-rose-700 ring-rose-100",
  kbci: "bg-slate-100 text-slate-700 ring-slate-200",
};

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          {categoryLabel}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          관련도 높은 순 ·{" "}
          {loading ? "..." : `총 ${categoryItems.length}건`}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-3 lg:col-span-2">
          {loading ? (
            <SkeletonList />
          ) : categoryItems.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <HeroCard item={categoryItems[0]} />
              <div className="space-y-2">
                {categoryItems.slice(1).map((item) => (
                  <NewsCard key={item.link} item={item} />
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-[160px]">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-bold text-gray-900">
                주요 뉴스 TOP 5
              </h2>
              <p className="mt-1 text-xs text-gray-500">관련도 높은 순</p>
              {loading ? (
                <ul className="mt-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <li key={i} className="animate-pulse">
                      <div className="h-3 w-16 rounded bg-gray-100" />
                      <div className="mt-1.5 h-4 w-full rounded bg-gray-200" />
                    </li>
                  ))}
                </ul>
              ) : (
                <ol className="mt-4 space-y-4">
                  {topRanked.map((item, idx) => (
                    <li key={item.link}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex gap-3"
                      >
                        <span className="shrink-0 text-base font-extrabold text-[#FFB81C]">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-gray-500">
                            {hostOf(item.originallink)} ·{" "}
                            {formatRelative(item.pubDate)}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-gray-800 group-hover:text-gray-600">
                            {stripHtml(item.title)}
                          </p>
                        </div>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function HeroCard({ item }: { item: NewsResponseItem }) {
  const categories = item.categories;
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-2xl border border-gray-200 bg-white p-6 transition-all hover:border-[#FFB81C]/60 hover:shadow-md sm:p-8"
    >
      <div className="text-[13px] text-gray-500">
        <span className="font-medium text-gray-700">
          {hostOf(item.originallink)}
        </span>
        <span className="mx-2">·</span>
        <span>{formatRelative(item.pubDate)}</span>
      </div>
      <h2 className="mt-3 text-xl font-bold leading-snug text-gray-900 group-hover:text-gray-700 sm:text-2xl">
        {stripHtml(item.title)}
      </h2>
      {categories.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {categories.map((id) => (
            <span
              key={id}
              className={`rounded-md px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${
                CATEGORY_COLORS[id] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {labelOf(id)}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5"
        >
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
      이 카테고리의 뉴스가 없습니다.
    </div>
  );
}
