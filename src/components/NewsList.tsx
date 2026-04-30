"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { NewsResponseItem } from "@/app/api/news/route";
import type { NaverNewsItem } from "@/app/api/naver-news/route";
import { CATEGORIES, FEATURED_KEYWORDS } from "@/lib/categories";
import { filterFeatured, type TimeRange } from "@/lib/featured";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { NewsCard } from "@/components/NewsCard";

type EnrichedNewsItem = NewsResponseItem;

const ALL_TAB = "__all__";

const relevanceScore = (item: EnrichedNewsItem): number => {
  const text = stripHtml(item.title);
  const featuredBonus = FEATURED_KEYWORDS.some((k) => text.includes(k))
    ? 5
    : 0;
  return item.categories.length * 2 + featuredBonus;
};

const normalizeTitle = (title: string): string => {
  return stripHtml(title)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 40);
};

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

type AnyItem = EnrichedNewsItem | NaverNewsItem;

type State =
  | { mode: "all"; items: EnrichedNewsItem[] }
  | { mode: "search"; q: string; items: NaverNewsItem[] }
  | null;

export default function NewsList() {
  const [data, setData] = useState<State>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);

  const [featuredRange, setFeaturedRange] = useState<TimeRange>("daily");
  const fullFeedRef = useRef<HTMLElement>(null);

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
    const map = new Map<string, EnrichedNewsItem>();
    for (const item of data.items) {
      const norm = normalizeTitle(item.title);
      const key = norm || item.link;
      const existing = map.get(key);
      if (existing) {
        const merged = new Set([...existing.categories, ...item.categories]);
        existing.categories = Array.from(merged);
      } else {
        map.set(key, { ...item, categories: [...item.categories] });
      }
    }
    return Array.from(map.values());
  }, [data]);

  const featured = useMemo(
    () => filterFeatured(allItems, featuredRange, 10),
    [allItems, featuredRange],
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
    const c: Record<string, number> = { [ALL_TAB]: allItems.length };
    for (const cat of CATEGORIES) {
      c[cat.id] = allItems.filter((it) =>
        it.categories.includes(cat.id),
      ).length;
    }
    return c;
  }, [allItems]);

  const sortedItems = useMemo(() => {
    return allItems.slice().sort((a, b) => {
      const sa = relevanceScore(a);
      const sb = relevanceScore(b);
      if (sb !== sa) return sb - sa;
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });
  }, [allItems]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSearchQuery(q);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery(null);
  };

  return (
    <div className="space-y-8 sm:space-y-12">
      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={onSubmitSearch}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {searchQuery ? (
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              <span className="text-blue-600">&quot;{searchQuery}&quot;</span>{" "}
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

          <CategoryHighlights
            tops={categoryTops}
            counts={counts}
            loading={loading}
          />

          <RankedLists
            allItems={allItems}
            sortedItems={sortedItems}
            loading={loading}
          />

          <FullFeed
            sectionRef={fullFeedRef}
            items={sortedItems}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="relative">
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
        placeholder="키워드를 입력해 검색하세요"
        className="w-full border-b-2 border-gray-300 bg-white py-3 pl-9 pr-20 text-[16px] font-semibold text-gray-900 outline-none transition-colors placeholder:font-normal placeholder:text-gray-400 focus:border-[#FFB81C] sm:text-[18px]"
      />
      <button
        type="submit"
        className="absolute right-0 top-1/2 -translate-y-1/2 px-3 py-2 text-[13px] font-bold tracking-wider text-gray-900 hover:text-[#FFB81C] sm:text-[14px]"
      >
        검색
      </button>
    </form>
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

  return (
    <section>
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
          <Link
            href="/featured"
            className="border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#FFB81C]"
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
            <a
              href={main.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              {main.categories.length > 0 && (
                <div className="mb-3 text-[11px] font-bold tracking-wider text-[#FFB81C]">
                  {main.categories.map((id) => labelOf(id)).join(" · ")}
                </div>
              )}
              <h3 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[32px]">
                {stripHtml(main.title)}
              </h3>
              <p className="mt-3 text-[12px] text-gray-500 sm:text-[13px]">
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
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block py-4 transition-colors hover:bg-gray-50/40"
                      >
                        <p className="text-[16px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                          {stripHtml(item.title)}
                        </p>
                        <p className="mt-1.5 text-[11px] text-gray-500">
                          <span className="font-medium text-gray-700">
                            {hostOf(item.originallink)}
                          </span>
                          <span className="mx-1.5">—</span>
                          {formatRelative(item.pubDate)}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <aside>
            <div className="border-b-2 border-gray-900 pb-2">
              <h3 className="text-[12px] font-bold tracking-widest text-gray-900">
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
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-3"
                    >
                      <span className="shrink-0 text-[18px] font-extrabold tabular-nums text-[#FFB81C]">
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
          </aside>
        </div>
      )}
    </section>
  );
}

function RankedLists({
  allItems,
  sortedItems,
  loading,
}: {
  allItems: EnrichedNewsItem[];
  sortedItems: EnrichedNewsItem[];
  loading: boolean;
}) {
  const byRelevance = sortedItems.slice(0, 5);
  const byDate = useMemo(
    () =>
      allItems
        .slice()
        .sort(
          (a, b) =>
            new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
        )
        .slice(0, 5),
    [allItems],
  );
  const topPerCategory = useMemo(() => {
    const out: EnrichedNewsItem[] = [];
    for (const cat of CATEGORIES) {
      const found = sortedItems.find((it) => it.categories.includes(cat.id));
      if (found && !out.find((o) => o.link === found.link)) out.push(found);
      if (out.length >= 5) break;
    }
    return out;
  }, [sortedItems]);

  return (
    <section>
      <SectionHeader title="뉴스 랭킹" subtitle="다양한 기준으로 보기" />
      <div className="grid gap-8 md:grid-cols-3 md:gap-10">
        <RankedColumn
          title="주요 뉴스"
          subtitle="관련도순"
          items={byRelevance}
          loading={loading}
        />
        <RankedColumn
          title="최신 뉴스"
          subtitle="시간순"
          items={byDate}
          loading={loading}
        />
        <RankedColumn
          title="카테고리 핵심"
          subtitle="카테고리별"
          items={topPerCategory}
          loading={loading}
        />
      </div>
    </section>
  );
}

function RankedColumn({
  title,
  subtitle,
  items,
  loading,
}: {
  title: string;
  subtitle: string;
  items: EnrichedNewsItem[];
  loading: boolean;
}) {
  return (
    <div>
      <div className="border-b-2 border-gray-900 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-bold tracking-widest text-gray-900">
            {title}
          </h3>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
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
      ) : items.length === 0 ? (
        <p className="mt-5 text-sm text-gray-400">뉴스가 없습니다.</p>
      ) : (
        <ol className="mt-5 space-y-5">
          {items.map((item, idx) => (
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
  );
}

function HeroSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
      <div className="space-y-3 lg:col-span-2">
        <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-4 h-6 w-3/4 rounded bg-gray-200" />
          <div className="mt-2 h-6 w-1/2 rounded bg-gray-200" />
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse border-b border-gray-200 px-5 py-4 last:border-b-0">
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-32 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
      <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
        <div className="h-4 w-20 rounded bg-gray-200" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <div className="h-4 w-full rounded bg-gray-200" />
              <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
            </div>
          ))}
        </div>
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
    <section>
      <SectionHeader
        title="카테고리별 인사이트"
        subtitle="주제별 최신 뉴스"
      />
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
                <h3 className="text-[14px] font-bold tracking-widest text-gray-900 group-hover:text-[#FFB81C]">
                  {cat.label}
                </h3>
                <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-gray-400 group-hover:text-[#FFB81C]">
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
                <p className="mt-4 text-[13px] text-gray-400">
                  아직 뉴스가 없습니다.
                </p>
              ) : (
                <ol className="mt-4 divide-y divide-gray-200">
                  {items.map((item) => (
                    <li key={item.link}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block py-3 transition-colors hover:bg-gray-50/40"
                      >
                        <p className="line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline">
                          {stripHtml(item.title)}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {hostOf(item.originallink)} —{" "}
                          {formatRelative(item.pubDate)}
                        </p>
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
  sectionRef,
  items,
  loading,
}: {
  sectionRef: React.RefObject<HTMLElement>;
  items: AnyItem[];
  loading: boolean;
}) {
  return (
    <section ref={sectionRef} className="scroll-mt-32">
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
    <div className="mb-5 border-b-2 border-gray-900 pb-2 sm:mb-6 sm:pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h2 className="text-[22px] font-extrabold tracking-tight text-gray-900 sm:text-[26px]">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[12px] text-gray-500 sm:text-[13px]">
              {subtitle}
            </p>
          )}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
          <div className="mt-2 h-4 w-full rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}
