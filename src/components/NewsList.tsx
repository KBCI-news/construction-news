"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { NewsResponseItem } from "@/app/api/news/route";
import type { NaverNewsItem } from "@/app/api/naver-news/route";
import { CATEGORIES, FEATURED_KEYWORDS } from "@/lib/categories";
import { filterFeatured, type TimeRange } from "@/lib/featured";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";

type EnrichedNewsItem = NewsResponseItem;

const ALL_TAB = "__all__";

const relevanceScore = (item: EnrichedNewsItem): number => {
  const text = stripHtml(item.title);
  const featuredBonus = FEATURED_KEYWORDS.some((k) => text.includes(k))
    ? 5
    : 0;
  return item.categories.length * 2 + featuredBonus;
};

const CATEGORY_COLORS: Record<string, string> = {
  "debt-collection": "bg-blue-50 text-blue-700 ring-blue-100",
  "credit-investigation": "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "e-document": "bg-violet-50 text-violet-700 ring-violet-100",
  "finance-law": "bg-amber-50 text-amber-700 ring-amber-100",
  "labor-law": "bg-rose-50 text-rose-700 ring-rose-100",
  kbci: "bg-slate-100 text-slate-700 ring-slate-200",
};

const DOT_COLORS: Record<string, string> = {
  "debt-collection": "bg-blue-500",
  "credit-investigation": "bg-emerald-500",
  "e-document": "bg-violet-500",
  "finance-law": "bg-amber-500",
  "labor-law": "bg-rose-500",
  kbci: "bg-slate-500",
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
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
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
        setData(
          searchQuery
            ? { mode: "search", q: searchQuery, items: json.items ?? [] }
            : { mode: "all", items: json.items ?? [] },
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [searchQuery]);

  const allItems = useMemo(
    () => (data?.mode === "all" ? data.items : []),
    [data],
  );

  const featured = useMemo(
    () => filterFeatured(allItems, featuredRange, 12),
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

  const tabFiltered = useMemo(() => {
    const base =
      activeTab === ALL_TAB
        ? allItems
        : allItems.filter((it) => it.categories.includes(activeTab));
    return base.slice().sort((a, b) => {
      const sa = relevanceScore(a);
      const sb = relevanceScore(b);
      if (sb !== sa) return sb - sa;
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });
  }, [allItems, activeTab]);

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

  const jumpToCategory = (catId: string) => {
    setActiveTab(catId);
    requestAnimationFrame(() => {
      fullFeedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
            <div className="space-y-2">
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
          <FeaturedSection
            items={featured}
            range={featuredRange}
            onRangeChange={setFeaturedRange}
            loading={loading}
          />

          <CategoryHighlights
            tops={categoryTops}
            counts={counts}
            onCategoryClick={jumpToCategory}
            loading={loading}
          />

          <FullFeed
            sectionRef={fullFeedRef}
            counts={counts}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            items={tabFiltered}
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
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
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
        className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 pl-11 pr-20 text-[15px] font-medium text-gray-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-gray-400 focus:border-[#FFB81C] focus:shadow-[0_0_0_4px_rgba(255,184,28,0.15)] sm:py-4 sm:pl-12 sm:pr-32 sm:text-[17px]"
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 sm:px-5 sm:py-2.5 sm:text-base"
      >
        검색
      </button>
    </form>
  );
}

function FeaturedSection({
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCard = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const firstCard = el.children[0] as HTMLElement | undefined;
    const cardWidth = firstCard?.offsetWidth ?? el.clientWidth * 0.85;
    el.scrollBy({ left: dir * (cardWidth + 12), behavior: "smooth" });
  };
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
          <div className="hidden items-center gap-1 md:flex">
            <ArrowButton onClick={() => scrollByCard(-1)} direction="left" />
            <ArrowButton onClick={() => scrollByCard(1)} direction="right" />
          </div>
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => onRangeChange("daily")}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                range === "daily"
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-[#FFB81C]/40"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              일간
            </button>
            <button
              onClick={() => onRangeChange("weekly")}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                range === "weekly"
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-[#FFB81C]/40"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              주간
            </button>
          </div>
          <Link
            href="/featured"
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            + 더보기
          </Link>
        </div>
      </SectionHeader>

      {loading ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <EmptyState
          message={`${range === "daily" ? "오늘" : "이번 주"} 표시할 주요 뉴스가 없습니다.`}
        />
      ) : (
        <div
          ref={scrollRef}
          className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:px-0"
        >
          {items.map((item) => (
            <div
              key={item.link}
              className="w-[85%] shrink-0 snap-start md:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-2.25rem)/4)]"
            >
              <NewsCard item={item} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryHighlights({
  tops,
  counts,
  onCategoryClick,
  loading,
}: {
  tops: Record<string, EnrichedNewsItem[]>;
  counts: Record<string, number>;
  onCategoryClick: (catId: string) => void;
  loading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCard = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const firstCard = el.children[0] as HTMLElement | undefined;
    const cardWidth = firstCard?.offsetWidth ?? el.clientWidth * 0.85;
    el.scrollBy({ left: dir * (cardWidth + 12), behavior: "smooth" });
  };
  return (
    <section>
      <SectionHeader
        title="카테고리별 인사이트"
        subtitle="주제별 최신 뉴스 모음"
      >
        <div className="hidden items-center gap-1 md:flex">
          <ArrowButton onClick={() => scrollByCard(-1)} direction="left" />
          <ArrowButton onClick={() => scrollByCard(1)} direction="right" />
        </div>
      </SectionHeader>
      <div
        ref={scrollRef}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:px-0"
      >
        {CATEGORIES.map((cat) => {
          const items = tops[cat.id] ?? [];
          return (
            <div
              key={cat.id}
              className="flex w-[85%] shrink-0 snap-start flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:border-[#FFB81C]/60 hover:shadow-md md:w-[calc((100%-1.5rem)/3)]"
            >
              <button
                onClick={() => onCategoryClick(cat.id)}
                className="flex w-full items-center justify-between gap-2 text-left"
                title="전체보기"
              >
                <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-gray-900">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      DOT_COLORS[cat.id] ?? "bg-gray-400"
                    }`}
                  />
                  <span className="truncate">{cat.label}</span>
                </h3>
                <span className="shrink-0 whitespace-nowrap text-[12px] text-gray-400">
                  {counts[cat.id] ?? 0}건 →
                </span>
              </button>
              {loading ? (
                <ul className="mt-3 space-y-2.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="animate-pulse">
                      <div className="h-3 w-16 rounded bg-gray-100" />
                      <div className="mt-1 h-3.5 w-full rounded bg-gray-200" />
                    </li>
                  ))}
                </ul>
              ) : items.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400">
                  아직 뉴스가 없습니다.
                </p>
              ) : (
                <ol className="mt-4 space-y-3.5">
                  {items.map((item) => (
                    <li key={item.link}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block"
                      >
                        <div className="text-[12px] text-gray-500">
                          {hostOf(item.originallink)} ·{" "}
                          {formatRelative(item.pubDate)}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[15px] font-medium leading-snug text-gray-800 group-hover:text-gray-600">
                          {stripHtml(item.title)}
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
  counts,
  activeTab,
  onTabChange,
  items,
  loading,
}: {
  sectionRef: React.RefObject<HTMLElement>;
  counts: Record<string, number>;
  activeTab: string;
  onTabChange: (t: string) => void;
  items: AnyItem[];
  loading: boolean;
}) {
  return (
    <section ref={sectionRef} className="scroll-mt-20">
      <SectionHeader
        title="전체 뉴스 피드"
        subtitle="관련도 높은 순으로 정렬"
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <TabButton
          label="전체"
          count={counts[ALL_TAB]}
          active={activeTab === ALL_TAB}
          onClick={() => onTabChange(ALL_TAB)}
        />
        {CATEGORIES.map((c) => (
          <TabButton
            key={c.id}
            label={c.label}
            count={counts[c.id] ?? 0}
            active={activeTab === c.id}
            onClick={() => onTabChange(c.id)}
          />
        ))}
      </div>

      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState message="표시할 뉴스가 없습니다." />
      ) : (
        <div className="space-y-2">
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
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">{title}</h2>
        {subtitle && (
          <p className="text-[13px] text-gray-500 sm:text-sm">{subtitle}</p>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-medium transition-all ${
        active
          ? "bg-[#FFB81C] text-gray-900 shadow-sm"
          : "bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-2 text-[13px] ${active ? "text-gray-700" : "text-gray-400"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ArrowButton({
  onClick,
  direction,
}: {
  onClick: () => void;
  direction: "left" | "right";
}) {
  return (
    <button
      onClick={onClick}
      aria-label={direction === "left" ? "이전" : "다음"}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 ring-1 ring-gray-200 transition-all hover:bg-gray-50 hover:text-gray-900 hover:ring-gray-300 active:scale-95"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={
            direction === "left"
              ? "M15.75 19.5 8.25 12l7.5-7.5"
              : "m8.25 4.5 7.5 7.5-7.5 7.5"
          }
        />
      </svg>
    </button>
  );
}

function NewsCard({ item }: { item: AnyItem }) {
  const categories = "categories" in item ? item.categories : [];
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#FFB81C]/60 hover:shadow-md"
    >
      <div className="flex items-center gap-2 text-[13px] text-gray-500">
        <span className="font-medium text-gray-700">
          {hostOf(item.originallink)}
        </span>
        <span>·</span>
        <span>{formatRelative(item.pubDate)}</span>
      </div>
      <h3 className="mt-3 flex-1 text-[18px] font-semibold leading-snug text-gray-900 group-hover:text-gray-700">
        {stripHtml(item.title)}
      </h3>
      {categories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
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

function SkeletonGrid() {
  return (
    <div className="flex flex-col gap-3 md:flex-row">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5 md:flex-1"
        >
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
          <div className="mt-2 h-4 w-full rounded bg-gray-100" />
          <div className="mt-1.5 h-4 w-2/3 rounded bg-gray-100" />
        </div>
      ))}
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
