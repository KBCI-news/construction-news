"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NewsResponseItem } from "@/app/api/news/route";
import type { NaverNewsItem } from "@/app/api/naver-news/route";
import type { TrendingResponse } from "@/app/api/trending/route";
import { CATEGORIES, HOT_KEYWORDS } from "@/lib/categories";
import { filterFeatured, type TimeRange } from "@/lib/featured";
import { formatRelative } from "@/lib/format";
import { readerHref } from "@/lib/links";
import {
  byDate,
  byRelevance,
  countKeywords,
  dedupeArticles,
  hostOf,
  isLegalArticle,
  stripHtml,
  type Article,
} from "@/lib/news";
import { NewsCard } from "@/components/NewsCard";
import { Thumbnail } from "@/components/Thumbnail";
import { PrintLink } from "@/components/PrintLink";

type EnrichedNewsItem = NewsResponseItem;

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

type AnyItem = EnrichedNewsItem | NaverNewsItem;

type State =
  | { mode: "all"; items: EnrichedNewsItem[] }
  | { mode: "search"; q: string; items: NaverNewsItem[] }
  | null;

function logSearch(query: string) {
  // 인기 검색어 집계용 — 실패해도 무시
  fetch("/api/search-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  }).catch(() => {});
}

export default function NewsList() {
  const [data, setData] = useState<State>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [trending, setTrending] = useState<TrendingResponse["searches"]>([]);

  const [featuredRange, setFeaturedRange] = useState<TimeRange>("daily");

  useEffect(() => {
    fetch("/api/trending")
      .then((res) => res.json())
      .then((json: TrendingResponse) => setTrending(json.searches ?? []))
      .catch(() => setTrending([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const url = searchQuery
      ? `/api/naver-news?q=${encodeURIComponent(searchQuery)}&display=100&sort=date`
      : "/api/news";

    setLoading(true);
    setData(null);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "요청 실패");
        return json;
      })
      .then((json) => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const filtered = (json.items ?? []).filter((it: NaverNewsItem) => {
            const title = stripHtml(it.title).toLowerCase();
            const desc = stripHtml(it.description ?? "").toLowerCase();
            return title.includes(q) || desc.includes(q);
          });
          setData({ mode: "search", q: searchQuery, items: filtered });
        } else {
          setData({ mode: "all", items: json.items ?? [] });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [searchQuery]);

  const allItems = useMemo<EnrichedNewsItem[]>(() => {
    if (data?.mode !== "all") return [];
    return dedupeArticles(data.items as Article[]) as EnrichedNewsItem[];
  }, [data]);

  const featured = useMemo(
    () => filterFeatured(allItems, featuredRange, 10),
    [allItems, featuredRange],
  );

  const legalItems = useMemo(
    () => allItems.filter(isLegalArticle).sort(byDate).slice(0, 6),
    [allItems],
  );

  const hotKeywords = useMemo(
    () => countKeywords(allItems, HOT_KEYWORDS, 10),
    [allItems],
  );

  const categoryTops = useMemo(() => {
    const map: Record<string, EnrichedNewsItem[]> = {};
    for (const cat of CATEGORIES) {
      map[cat.id] = allItems
        .filter((it) => it.categories.includes(cat.id))
        .slice(0, 4);
    }
    return map;
  }, [allItems]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      c[cat.id] = allItems.filter((it) =>
        it.categories.includes(cat.id),
      ).length;
    }
    return c;
  }, [allItems]);

  const sortedItems = useMemo(
    () => allItems.slice().sort(byRelevance),
    [allItems],
  );

  const runSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchInput(trimmed);
    setSearchQuery(trimmed);
    logSearch(trimmed);
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery(null);
  };

  return (
    <div className="space-y-6">
      <SearchPanel
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={onSubmitSearch}
        onPick={runSearch}
        searches={trending}
        hotKeywords={hotKeywords}
      />

      {!searchQuery && <StatRow counts={counts} loading={loading} />}

      {error && (
        <div className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {searchQuery ? (
        <section className="card space-y-5 p-5 sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              <span className="text-[#9A7A12]">&quot;{searchQuery}&quot;</span>{" "}
              검색 결과
              {data?.mode === "search" && (
                <span className="ml-2 text-base font-normal text-gray-500">
                  {data.items.length}건
                </span>
              )}
            </h2>
            <button
              onClick={clearSearch}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              ✕ 검색 닫기
            </button>
          </div>
          {loading ? (
            <SkeletonList />
          ) : data?.mode === "search" && data.items.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {data.items.map((item) => (
                <NewsCard key={item.link} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState message="검색 결과가 없습니다." />
          )}
        </section>
      ) : (
        <>
          <HeroSection
            items={featured}
            range={featuredRange}
            onRangeChange={setFeaturedRange}
            loading={loading}
          />

          <LegalSection items={legalItems} loading={loading} />

          <CategoryHighlights
            tops={categoryTops}
            counts={counts}
            loading={loading}
          />

          <FullFeed items={sortedItems} loading={loading} />
        </>
      )}
    </div>
  );
}

function SearchPanel({
  value,
  onChange,
  onSubmit,
  onPick,
  searches,
  hotKeywords,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onPick: (q: string) => void;
  searches: { query: string; count: number }[];
  hotKeywords: { keyword: string; count: number }[];
}) {
  const [focused, setFocused] = useState(false);

  const handlePick = (q: string) => {
    onPick(q);
    setFocused(false);
  };

  return (
    <div
      className="card relative px-4 py-1"
      // 드롭다운 내부 버튼으로 포커스가 이동할 땐 닫지 않는다.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFocused(false);
        }
      }}
    >
      <form
        onSubmit={(e) => {
          onSubmit(e);
          setFocused(false);
        }}
        className="relative"
      >
        <svg
          className="pointer-events-none absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="키워드를 입력해 검색하세요"
          className="w-full bg-transparent py-3 pl-9 pr-16 text-[16px] font-semibold text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 sm:text-[17px]"
        />
        <button
          type="submit"
          className="absolute right-0 top-1/2 -translate-y-1/2 px-2 py-2 text-[14px] font-bold tracking-wider text-gray-500 hover:text-[#9A7A12]"
        >
          검색
        </button>
      </form>

      {focused && (
        <div className="card absolute left-0 right-0 top-full z-30 mt-2 p-5 shadow-xl sm:p-6">
          <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
            <RankBoard
              title="인기 검색어"
              empty="아직 검색 데이터가 없습니다"
              items={searches.map((s) => s.query)}
              onPick={handlePick}
            />
            <RankBoard
              title="핫 키워드"
              empty="집계 중입니다"
              items={hotKeywords.map((k) => k.keyword)}
              onPick={handlePick}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RankBoard({
  title,
  empty,
  items,
  onPick,
}: {
  title: string;
  empty: string;
  items: string[];
  onPick: (q: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between border-b border-gray-200 pb-2">
        <h3 className="text-[13px] font-bold tracking-widest text-gray-900">
          {title}
        </h3>
        <span className="text-[11px] font-bold tracking-wider text-gray-400">
          TOP 10
        </span>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-[13px] text-gray-400">{empty}</p>
      ) : (
        <ol className="space-y-2.5">
          {items.slice(0, 10).map((item, i) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="group flex w-full items-center gap-3 text-left"
              >
                <span
                  className={`w-5 shrink-0 text-[15px] font-extrabold tabular-nums ${
                    i < 3 ? "text-[#FFB81C]" : "text-gray-300"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="truncate text-[14px] font-semibold text-gray-700 group-hover:text-[#9A7A12] group-hover:underline">
                  {item}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HeroSection({
  items,
  range,
  onRangeChange,
  loading,
}: {
  items: EnrichedNewsItem[];
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
  loading: boolean;
}) {
  const main = items[0];
  const subStories = items.slice(1, 5);
  const sideStories = items.slice(5, 10);
  const allLinks = items.map((it) => it.link);

  return (
    <section className="card p-5 sm:p-7">
      <SectionHeader
        title="주요 뉴스"
        subtitle={
          range === "daily"
            ? "지난 24시간 핵심 키워드 이슈"
            : "지난 7일 핵심 키워드 이슈"
        }
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex border border-gray-300 text-[13px]">
            <button
              onClick={() => onRangeChange("daily")}
              className={`px-3 py-1.5 font-bold tracking-wider transition-colors ${
                range === "daily"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              일간
            </button>
            <button
              onClick={() => onRangeChange("weekly")}
              className={`border-l border-gray-300 px-3 py-1.5 font-bold tracking-wider transition-colors ${
                range === "weekly"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              주간
            </button>
          </div>
          {allLinks.length > 0 && (
            <PrintLink
              links={allLinks}
              label="전체 출력"
              className="no-print inline-flex items-center gap-1 border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#9A7A12]"
            />
          )}
          <Link
            href="/featured"
            className="border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#9A7A12]"
          >
            + 더보기
          </Link>
        </div>
      </SectionHeader>

      {loading ? (
        <HeroSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          message={`${range === "daily" ? "오늘" : "이번 주"} 표시할 주요 뉴스가 없습니다.`}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
          <div className="lg:col-span-2">
            <a href={readerHref(main.link)} className="group block">
              <Thumbnail
                src={main.imageUrl}
                label={main.categories[0] ? labelOf(main.categories[0]) : "KBCI"}
                className="aspect-[16/9] w-full rounded-xl"
              />
              {main.categories.length > 0 && (
                <div className="mb-2 mt-4 text-[12px] font-bold tracking-wider text-[#9A7A12]">
                  {main.categories.map((id) => labelOf(id)).join(" · ")}
                </div>
              )}
              <h3 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[34px]">
                {stripHtml(main.title)}
              </h3>
              {main.description && (
                <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-gray-600 sm:text-[16px]">
                  {stripHtml(main.description)}
                </p>
              )}
              <p className="mt-3 text-[13px] text-gray-500">
                <span className="font-medium text-gray-700">
                  {hostOf(main.originallink)}
                </span>
                <span className="mx-1.5">—</span>
                <span>{formatRelative(main.pubDate)}</span>
              </p>
            </a>

            {subStories.length > 0 && (
              <>
                <div className="my-6 border-t border-gray-200" />
                <ul className="divide-y divide-gray-200">
                  {subStories.map((item) => (
                    <li key={item.link}>
                      <a
                        href={readerHref(item.link)}
                        className="group flex items-start gap-4 py-4 transition-colors hover:bg-gray-50/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[17px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                            {stripHtml(item.title)}
                          </p>
                          <p className="mt-1.5 text-[12px] text-gray-500">
                            <span className="font-medium text-gray-700">
                              {hostOf(item.originallink)}
                            </span>
                            <span className="mx-1.5">—</span>
                            {formatRelative(item.pubDate)}
                          </p>
                        </div>
                        <Thumbnail
                          src={item.imageUrl}
                          label={
                            item.categories[0]
                              ? labelOf(item.categories[0])
                              : "KBCI"
                          }
                          className="h-[64px] w-[92px] shrink-0 rounded-lg"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <aside>
            <div className="border-b border-gray-200 pb-2">
              <h3 className="text-[13px] font-bold tracking-widest text-gray-900">
                핫뉴스 TOP 5
              </h3>
            </div>
            {sideStories.length === 0 ? (
              <p className="mt-4 text-sm text-gray-400">
                표시할 뉴스가 없습니다.
              </p>
            ) : (
              <ol className="mt-5 space-y-5">
                {sideStories.map((item, idx) => (
                  <li key={item.link}>
                    <a
                      href={readerHref(item.link)}
                      className="group flex gap-3"
                    >
                      <span className="shrink-0 text-[18px] font-extrabold tabular-nums text-[#FFB81C]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
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
          </aside>
        </div>
      )}
    </section>
  );
}

function LegalSection({
  items,
  loading,
}: {
  items: EnrichedNewsItem[];
  loading: boolean;
}) {
  if (!loading && items.length === 0) return null;
  return (
    <section className="card p-5 sm:p-7">
      <SectionHeader
        title="법·제도 동향"
        subtitle="관련 법령 개정·제재·위반 사례"
      />
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-full rounded bg-gray-200" />
              <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <a
              key={item.link}
              href={readerHref(item.link)}
              className="group flex gap-3 border-l-2 border-[#FFB81C] pl-3"
            >
              <div className="min-w-0">
                <p className="line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                  {stripHtml(item.title)}
                </p>
                <p className="mt-1 text-[12px] text-gray-500">
                  {hostOf(item.originallink)} — {formatRelative(item.pubDate)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function HeroSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
      <div className="lg:col-span-2">
        <div className="aspect-[16/9] w-full animate-pulse rounded-xl bg-gray-200" />
        <div className="mt-4 h-7 w-3/4 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-7 w-1/2 animate-pulse rounded bg-gray-200" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryHighlights({
  tops,
  counts,
  loading,
}: {
  tops: Record<string, EnrichedNewsItem[]>;
  counts: Record<string, number>;
  loading: boolean;
}) {
  return (
    <section className="card p-5 sm:p-7">
      <SectionHeader title="카테고리별 인사이트" subtitle="주제별 최신 뉴스" />
      <div className="grid gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-3">
        {CATEGORIES.map((cat) => {
          const items = tops[cat.id] ?? [];
          return (
            <div key={cat.id}>
              <Link
                href={`/category/${cat.id}`}
                className="group flex w-full items-baseline justify-between gap-2 border-b border-gray-300 pb-2"
                title="전체보기"
              >
                <h3 className="text-[15px] font-bold tracking-widest text-gray-900 group-hover:text-[#9A7A12]">
                  {cat.label}
                </h3>
                <span className="shrink-0 whitespace-nowrap text-[12px] font-medium text-gray-400 group-hover:text-[#9A7A12]">
                  {counts[cat.id] ?? 0}건 →
                </span>
              </Link>
              {loading ? (
                <ul className="mt-4 space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="animate-pulse">
                      <div className="h-4 w-full rounded bg-gray-200" />
                      <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
                    </li>
                  ))}
                </ul>
              ) : items.length === 0 ? (
                <p className="mt-4 text-[14px] text-gray-400">
                  아직 뉴스가 없습니다.
                </p>
              ) : (
                <ol className="mt-4 divide-y divide-gray-200">
                  {items.map((item) => (
                    <li key={item.link}>
                      <a
                        href={readerHref(item.link)}
                        className="group flex items-start gap-3 py-3 transition-colors hover:bg-gray-50/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[15.5px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                            {stripHtml(item.title)}
                          </p>
                          <p className="mt-1 text-[12px] text-gray-500">
                            {hostOf(item.originallink)} —{" "}
                            {formatRelative(item.pubDate)}
                          </p>
                        </div>
                        <Thumbnail
                          src={item.imageUrl}
                          label={cat.label}
                          className="h-[52px] w-[72px] shrink-0 rounded-md"
                        />
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FullFeed({
  items,
  loading,
}: {
  items: AnyItem[];
  loading: boolean;
}) {
  return (
    <section className="card scroll-mt-32 p-5 sm:p-7">
      <SectionHeader
        title="최신 뉴스"
        subtitle={`관련도 높은 순 · 총 ${items.length}건`}
      />

      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState message="표시할 뉴스가 없습니다." />
      ) : (
        <div className="divide-y divide-gray-200">
          {items.map((item) => (
            <NewsCard key={item.link} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 className="accent-bar flex items-center text-[18px] font-extrabold tracking-tight text-gray-900 sm:text-[20px]">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 pl-[14px] text-[12.5px] text-gray-400">
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function StatRow({
  counts,
  loading,
}: {
  counts: Record<string, number>;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6 sm:gap-3">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.id}
          href={`/category/${cat.id}`}
          className="card group px-3.5 py-3 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold tracking-wide text-gray-500 group-hover:text-gray-900">
              {cat.label}
            </span>
            <span className="text-gray-300 transition-colors group-hover:text-[#9A7A12]">
              →
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-[22px] font-extrabold tabular-nums tracking-tight text-gray-900">
              {loading ? "–" : (counts[cat.id] ?? 0).toLocaleString()}
            </span>
            <span className="text-[11px] font-medium text-gray-400">건</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="divide-y divide-gray-200">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 py-6">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
            <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-full animate-pulse rounded bg-gray-100" />
          </div>
          <div className="h-[72px] w-[104px] shrink-0 animate-pulse rounded-lg bg-gray-200 sm:h-[108px] sm:w-[168px]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border-y-2 border-gray-200 py-16 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}
