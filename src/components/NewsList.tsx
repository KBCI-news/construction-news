"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EnrichedNewsItem } from "@/app/api/naver-news/all/route";
import type { NaverNewsItem } from "@/app/api/naver-news/route";
import { CATEGORIES } from "@/lib/categories";
import {
  dateGroupOf,
  formatRelative,
  hostOf,
  stripHtml,
} from "@/lib/format";

const ALL_TAB = "__all__";
const GROUP_ORDER = ["오늘", "어제", "이번 주", "이전"];

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

type TimeRange = "daily" | "weekly";
type AnyItem = EnrichedNewsItem | NaverNewsItem;

const inRange = (pubDate: string, range: TimeRange) => {
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return false;
  const ms = range === "daily" ? 86_400_000 : 7 * 86_400_000;
  return Date.now() - t < ms;
};

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
      : "/api/naver-news/all";

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

  const allItems = data?.mode === "all" ? data.items : [];

  const featured = useMemo(() => {
    return allItems
      .filter((it) => inRange(it.pubDate, featuredRange))
      .slice()
      .sort((a, b) => {
        if (b.categories.length !== a.categories.length) {
          return b.categories.length - a.categories.length;
        }
        return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
      })
      .slice(0, 8);
  }, [allItems, featuredRange]);

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
    if (activeTab === ALL_TAB) return allItems;
    return allItems.filter((it) => it.categories.includes(activeTab));
  }, [allItems, activeTab]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AnyItem[]>();
    for (const item of tabFiltered) {
      const g = dateGroupOf(item.pubDate);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(item);
    }
    return GROUP_ORDER.map((g) => ({
      group: g,
      items: groups.get(g) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [tabFiltered]);

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
    <div className="space-y-12">
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
            grouped={grouped}
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
        className="w-full rounded-2xl border border-gray-200 bg-white py-4 pl-12 pr-32 text-base shadow-sm outline-none transition-all placeholder:text-gray-400 focus:border-gray-900 focus:shadow-md"
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700"
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
  return (
    <section>
      <SectionHeader
        title="주요 뉴스"
        subtitle={
          range === "daily"
            ? "지난 24시간 동안 여러 키워드에 걸친 이슈"
            : "이번 주 여러 키워드에 걸친 이슈"
        }
      >
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => onRangeChange("daily")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              range === "daily"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            일간
          </button>
          <button
            onClick={() => onRangeChange("weekly")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              range === "weekly"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            주간
          </button>
        </div>
      </SectionHeader>

      {loading ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <EmptyState
          message={`${range === "daily" ? "오늘" : "이번 주"} 표시할 주요 뉴스가 없습니다.`}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <NewsCard key={item.link} item={item} />
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
  return (
    <section>
      <SectionHeader
        title="카테고리별 인사이트"
        subtitle="주제별 최신 뉴스 모음"
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((cat) => {
          const items = tops[cat.id] ?? [];
          return (
            <div
              key={cat.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      DOT_COLORS[cat.id] ?? "bg-gray-400"
                    }`}
                  />
                  {cat.label}
                </h3>
                <button
                  onClick={() => onCategoryClick(cat.id)}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  전체보기 ({counts[cat.id] ?? 0}) →
                </button>
              </div>
              {loading ? (
                <ul className="mt-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="animate-pulse">
                      <div className="h-3 w-20 rounded bg-gray-100" />
                      <div className="mt-1.5 h-4 w-full rounded bg-gray-200" />
                    </li>
                  ))}
                </ul>
              ) : items.length === 0 ? (
                <p className="mt-4 text-sm text-gray-400">
                  아직 뉴스가 없습니다.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {items.map((item) => (
                    <li key={item.link}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block"
                      >
                        <div className="text-[11px] text-gray-500">
                          {hostOf(item.originallink)} ·{" "}
                          {formatRelative(item.pubDate)}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm font-medium text-gray-800 group-hover:text-gray-600">
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
  grouped,
  loading,
}: {
  sectionRef: React.RefObject<HTMLElement>;
  counts: Record<string, number>;
  activeTab: string;
  onTabChange: (t: string) => void;
  grouped: { group: string; items: AnyItem[] }[];
  loading: boolean;
}) {
  return (
    <section ref={sectionRef} className="scroll-mt-20">
      <SectionHeader
        title="전체 뉴스 피드"
        subtitle="모든 카테고리의 최신 뉴스를 한 번에"
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
      ) : grouped.length === 0 ? (
        <EmptyState message="표시할 뉴스가 없습니다." />
      ) : (
        <div className="space-y-8">
          {grouped.map(({ group, items }) => (
            <div key={group} className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                  {group}
                </h3>
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs text-gray-400">{items.length}건</span>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <NewsCard key={item.link} item={item} />
                ))}
              </div>
            </div>
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
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
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
      className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
        active
          ? "bg-gray-900 text-white shadow-sm"
          : "bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-2 text-xs ${active ? "text-gray-300" : "text-gray-400"}`}
        >
          {count}
        </span>
      )}
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
      className="group block rounded-xl border border-gray-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-700">
          {hostOf(item.originallink)}
        </span>
        <span>·</span>
        <span>{formatRelative(item.pubDate)}</span>
        {categories.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1">
            {categories.map((id) => (
              <span
                key={id}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                  CATEGORY_COLORS[id] ?? "bg-gray-100 text-gray-700"
                }`}
              >
                {labelOf(id)}
              </span>
            ))}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug text-gray-900 group-hover:text-gray-700">
        {stripHtml(item.title)}
      </h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-600">
        {stripHtml(item.description)}
      </p>
    </a>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-gray-200 bg-white p-5"
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
          className="animate-pulse rounded-xl border border-gray-200 bg-white p-5"
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
