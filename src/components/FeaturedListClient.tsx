"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NewsResponseItem } from "@/app/api/news/route";
import { filterFeatured, type TimeRange } from "@/lib/featured";
import { NewsCard } from "@/components/NewsCard";

export default function FeaturedListClient() {
  const [items, setItems] = useState<NewsResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>("daily");

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

  const featured = useMemo(
    () => filterFeatured(items, range, 50),
    [items, range],
  );

  return (
    <div className="space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-[12px] font-bold tracking-wider text-gray-500 hover:text-[#FFB81C]"
      >
        ← 메인으로
      </Link>

      <div className="border-b-2 border-gray-900 pb-3">
        <p className="text-[11px] font-bold tracking-widest text-[#FFB81C]">
          KBCI NEWS · FEATURED
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 sm:text-[36px]">
              주요 뉴스
            </h1>
            <p className="mt-1 text-[12px] text-gray-500 sm:text-[13px]">
              {range === "daily" ? "지난 24시간" : "지난 7일"} 핵심 키워드
              이슈 (최대 50건)
            </p>
          </div>
          <div className="inline-flex border border-gray-300 text-[13px]">
            <button
              onClick={() => setRange("daily")}
              className={`px-4 py-1.5 font-bold tracking-wider transition-colors ${
                range === "daily"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              일간
            </button>
            <button
              onClick={() => setRange("weekly")}
              className={`border-l border-gray-300 px-4 py-1.5 font-bold tracking-wider transition-colors ${
                range === "weekly"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              주간
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse border-b border-gray-200 pb-6"
            >
              <div className="h-3 w-32 rounded bg-gray-200" />
              <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : featured.length === 0 ? (
        <div className="border-y-2 border-gray-200 py-16 text-center text-sm text-gray-500">
          표시할 주요 뉴스가 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {featured.map((item) => (
            <NewsCard key={item.link} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
