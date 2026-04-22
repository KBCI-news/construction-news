"use client";

import { useEffect, useState } from "react";
import type { NaverNewsItem } from "@/app/api/naver-news/route";
import { CATEGORIES } from "@/lib/categories";

type Mode =
  | { type: "category"; id: string }
  | { type: "search"; q: string };

const stripHtml = (text: string) =>
  text
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const formatDate = (pubDate: string) => {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return pubDate;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function NewsList() {
  const [mode, setMode] = useState<Mode>({
    type: "category",
    id: CATEGORIES[0].id,
  });
  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<NaverNewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ display: "30" });
    if (mode.type === "category") params.set("category", mode.id);
    else params.set("q", mode.q);

    setLoading(true);
    setError(null);

    fetch(`/api/naver-news?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "요청 실패");
        return data;
      })
      .then((data) => setItems(data.items ?? []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
        setItems([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [mode]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setMode({ type: "search", q });
  };

  const headerLabel =
    mode.type === "category"
      ? CATEGORIES.find((c) => c.id === mode.id)?.label
      : `"${mode.q}" 검색 결과`;

  return (
    <div className="space-y-6">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="키워드를 입력해 검색하세요"
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-gray-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          검색
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = mode.type === "category" && mode.id === c.id;
          return (
            <button
              key={c.id}
              onClick={() => {
                setSearchInput("");
                setMode({ type: "category", id: c.id });
              }}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{headerLabel}</h2>
        <span className="text-sm text-gray-500">
          {loading ? "불러오는 중…" : `총 ${items.length}건`}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          결과가 없습니다.
        </div>
      )}

      <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {items.map((item) => (
          <li key={item.link} className="p-4 hover:bg-gray-50">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block space-y-1.5"
            >
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{hostOf(item.originallink)}</span>
                <span>·</span>
                <span>{formatDate(item.pubDate)}</span>
              </div>
              <h3 className="text-base font-semibold leading-snug text-gray-900">
                {stripHtml(item.title)}
              </h3>
              <p className="line-clamp-2 text-sm text-gray-600">
                {stripHtml(item.description)}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
