"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewsResponseItem } from "@/app/api/news/route";
import { CATEGORIES } from "@/lib/categories";
import { formatRelative } from "@/lib/format";
import { readerHref } from "@/lib/links";
import {
  byRelevance,
  clusterArticles,
  dedupeArticles,
  hostOf,
  primaryCategory,
  stripHtml,
  type Article,
} from "@/lib/news";
import { NewsCard } from "@/components/NewsCard";
import { Thumbnail } from "@/components/Thumbnail";
import { PrintLink } from "@/components/PrintLink";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

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

  const dedupedAll = useMemo(
    () =>
      clusterArticles(dedupeArticles(items as Article[])) as NewsResponseItem[],
    [items],
  );

  const categoryItems = useMemo(
    () =>
      dedupedAll
        .filter((it) => primaryCategory(it) === categoryId)
        .sort(byRelevance),
    [dedupedAll, categoryId],
  );

  const topRanked = useMemo(() => categoryItems.slice(0, 5), [categoryItems]);

  return (
    <div className="space-y-6">
      {/* 카테고리 헤더 */}
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-white to-[#FFF7E4] px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="accent-bar flex items-center text-[12px] font-bold tracking-widest text-[#9A7A12]">
                KBCI NEWS · {categoryLabel.toUpperCase()}
              </p>
              <h1 className="mt-2 text-[28px] font-extrabold tracking-tight text-gray-900 sm:text-[34px]">
                {categoryLabel}
              </h1>
              <p className="mt-1 text-[13px] text-gray-500">
                관련도 높은 순 ·{" "}
                <span className="font-bold tabular-nums text-gray-700">
                  {loading ? "..." : categoryItems.length.toLocaleString()}
                </span>
                건
              </p>
            </div>
            {categoryItems.length > 0 && (
              <PrintLink
                links={categoryItems.slice(0, 20).map((it) => it.link)}
                label="상위 20건 출력"
                className="no-print inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#9A7A12]"
              />
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {loading ? (
            <div className="card p-5 sm:p-7">
              <SkeletonList />
            </div>
          ) : categoryItems.length === 0 ? (
            <div className="card p-5 sm:p-7">
              <EmptyState />
            </div>
          ) : (
            <>
              <div className="card overflow-hidden p-5 sm:p-7">
                <HeroArticle item={categoryItems[0]} />
              </div>
              {categoryItems.length > 1 && (
                <div className="card p-5 sm:p-7">
                  <h2 className="accent-bar mb-2 flex items-center text-[18px] font-extrabold tracking-tight text-gray-900 sm:text-[20px]">
                    전체 기사
                  </h2>
                  <div className="divide-y divide-gray-200">
                    {categoryItems.slice(1).map((item) => (
                      <NewsCard key={item.link} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="min-w-0">
          <div className="card p-5 sm:p-6 lg:sticky lg:top-[120px]">
            <h2 className="accent-bar mb-4 flex items-center text-[13px] font-bold tracking-widest text-gray-900">
              주요 뉴스 TOP 5
            </h2>
            {loading ? (
              <ul className="space-y-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="animate-pulse">
                    <div className="h-4 w-full rounded bg-gray-200" />
                    <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
                  </li>
                ))}
              </ul>
            ) : topRanked.length === 0 ? (
              <p className="text-[13px] text-gray-400">표시할 뉴스가 없습니다.</p>
            ) : (
              <ol className="space-y-4">
                {topRanked.map((item, idx) => (
                  <li key={item.link}>
                    <a
                      href={readerHref(item.link)}
                      className="group flex gap-3 overflow-hidden"
                    >
                      <span className="shrink-0 text-[16px] font-extrabold tabular-nums text-[#FFB81C]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14.5px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                          {stripHtml(item.title)}
                        </p>
                        <p className="mt-1 text-[12px] text-gray-500">
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
    <a href={readerHref(item.link)} className="group block">
      <Thumbnail
        src={item.imageUrl}
        label={item.categories[0] ? labelOf(item.categories[0]) : "KBCI"}
        className="aspect-[16/9] w-full rounded-xl"
      />
      {primaryCategory(item) && (
        <div className="mb-2 mt-4 text-[12px] font-bold tracking-wider text-[#9A7A12]">
          {labelOf(primaryCategory(item)!)}
        </div>
      )}
      <h2 className="text-[24px] font-extrabold leading-tight tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[30px]">
        {stripHtml(item.title)}
      </h2>
      {item.description && (
        <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-gray-600 sm:text-[16px]">
          {stripHtml(item.description)}
        </p>
      )}
      <p className="mt-3 text-[13px] text-gray-500">
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
    <div className="py-16 text-center text-sm text-gray-500">
      이 카테고리의 뉴스가 없습니다.
    </div>
  );
}
