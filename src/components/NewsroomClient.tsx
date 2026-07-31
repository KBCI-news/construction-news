"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { FeedItem, FeedResponse } from "@/app/api/feed/route";
import { DESKS, LEGAL_KINDS, getDesk } from "@/lib/lexicon";
import { FeedRow } from "@/components/FeedRow";
import { IndicatorStrip } from "@/components/IndicatorStrip";
import { useClip } from "@/components/ClipProvider";

type SortKey = "score" | "date" | "relevance";
type RangeKey = "24h" | "7d" | "30d";

const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "오늘",
  "7d": "1주",
  "30d": "1개월",
};

const PAGE = 30;

function logSearch(query: string) {
  fetch("/api/search-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  }).catch(() => {});
}

export default function NewsroomClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { items: clipped } = useClip();

  const q = params.get("q") ?? "";
  const desk = params.get("desk") ?? "";
  const legal = params.get("legal") === "1";
  const general = params.get("scope") === "general";
  const range = (params.get("range") as RangeKey) || "7d";
  const sort = (params.get("sort") as SortKey) || (q ? "relevance" : "score");

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setInput(q), [q]);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      });
      router.push(next.toString() ? `/?${next}` : "/");
    },
    [params, router],
  );

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("range", range);
    sp.set("sort", sort);
    sp.set("limit", "150");
    if (q) sp.set("q", q);
    if (general) sp.set("scope", "general");
    else if (desk) sp.set("desk", desk);
    if (legal && !general) {
      LEGAL_KINDS.forEach((k) => sp.append("kind", k));
      // 법·제도는 "우리와 관련된" 법 개정·제재·판결만 — 데스크 소속을 요구해
      // 무관한 일반 법조 기사(하도급 과징금, 헌재 각하 등)를 거른다
      sp.set("scope", "curated");
    }
    return sp.toString();
  }, [q, desk, legal, general, range, sort]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setVisible(PAGE);

    fetch(`/api/feed?${queryString}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "요청 실패");
        return json as FeedResponse;
      })
      .then((json) => setItems(json.items ?? []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [queryString]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        (el as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) logSearch(trimmed);
    setParam({ q: trimmed || null, sort: trimmed ? "relevance" : null });
  };

  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const deskInfo = desk && !general ? getDesk(desk) : undefined;

  const heading = q
    ? `"${q}" 검색 결과`
    : general
      ? "일반 뉴스"
      : legal
        ? "법·제도"
        : deskInfo
          ? deskInfo.label
          : "업무 관련 뉴스";

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 검색 + 브리핑 진입 */}
      <div className="flex items-center gap-2 sm:gap-3">
        <form onSubmit={submitSearch} className="card flex min-w-0 flex-1 items-center px-3">
          <svg
            className="pointer-events-none h-5 w-5 shrink-0 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="뉴스 검색"
            placeholder="키워드 검색"
            className="min-h-[48px] w-full min-w-0 bg-transparent px-2.5 text-[16px] font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-500 sm:min-h-[52px] sm:px-3"
          />
          <button
            type="submit"
            className="hidden min-h-[44px] shrink-0 rounded-lg px-3 text-[14px] font-bold text-gray-700 hover:text-[#7A5E08] sm:block"
          >
            검색
          </button>
        </form>

        {/* 브리핑은 이 사이트의 최종 산출물 — 항상 눈에 띄는 자리에 둔다 */}
        <Link
          href="/brief"
          aria-label="브리핑 만들기"
          className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-gray-900 px-3.5 text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-black sm:min-h-[52px] sm:gap-2 sm:rounded-[18px] sm:px-5"
        >
          <span aria-hidden>🖨</span>
          <span className="hidden sm:inline">브리핑 만들기</span>
          {clipped.length > 0 && (
            <span className="rounded-full bg-[#FFB81C] px-1.5 py-0.5 text-[12px] font-extrabold tabular-nums text-gray-900 sm:px-2">
              {clipped.length}
            </span>
          )}
        </Link>
      </div>

      <IndicatorStrip />

      {/* 범위 + 주제를 한 카드로 — 모바일 세로 공간을 아낀다 */}
      <div className="card overflow-hidden">
        <div
          role="tablist"
          aria-label="뉴스 범위"
          className="grid grid-cols-2 gap-1.5 p-1.5"
        >
          <TabButton
            active={!general}
            onClick={() => setParam({ scope: null })}
            label="업무 관련 뉴스"
          />
          <TabButton
            active={general}
            onClick={() => setParam({ scope: "general", desk: null, legal: null })}
            label="일반 뉴스"
          />
        </div>

        {!general && (
          <div className="border-t border-[var(--line)] px-3 py-2.5 sm:px-4">
            <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {[
              { id: "", label: "전체" },
              { id: "__legal__", label: "법·제도" },
              ...DESKS.map((d) => ({ id: d.id, label: d.label })),
            ].map((chip) => {
              const active =
                chip.id === "__legal__" ? legal : !legal && desk === chip.id;
              return (
                <li key={chip.id || "all"} className="shrink-0">
                  <button
                    onClick={() =>
                      chip.id === "__legal__"
                        ? setParam({ legal: legal ? null : "1", desk: null })
                        : setParam({ desk: chip.id || null, legal: null })
                    }
                    aria-pressed={active}
                    className={`inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full border px-3.5 text-[13.5px] font-bold transition-colors ${
                      active
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-300 bg-white text-gray-700 hover:border-[#FFB81C] hover:text-[#7A5E08]"
                    }`}
                  >
                    {chip.label}
                  </button>
                </li>
              );
            })}
            </ul>
            {deskInfo && (
              <p className="mt-2 text-[12.5px] text-gray-600">
                {deskInfo.definition}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3단계: 기간·정렬 */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-2.5 sm:gap-x-6 sm:p-4">
        <Group label="기간">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
            <Seg key={r} active={range === r} onClick={() => setParam({ range: r })}>
              {RANGE_LABEL[r]}
            </Seg>
          ))}
        </Group>
        <Group label="정렬">
          {(
            [
              ["score", "중요도순"],
              ["date", "최신순"],
              ...(q ? ([["relevance", "관련도순"]] as [SortKey, string][]) : []),
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <Seg key={key} active={sort === key} onClick={() => setParam({ sort: key })}>
              {label}
            </Seg>
          ))}
        </Group>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-rose-600 bg-rose-50 p-4">
          <p className="text-sm text-rose-800">{error}</p>
          <button
            onClick={() => setParam({})}
            className="mt-2 min-h-[40px] rounded-lg border border-rose-300 px-3 text-[13px] font-bold text-rose-800"
          >
            다시 시도
          </button>
        </div>
      )}

      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            {heading}
          </h1>
          <p className="text-[12.5px] text-gray-600" aria-live="polite">
            {loading
              ? "불러오는 중…"
              : `${items.length.toLocaleString()}건 · ${
                  sort === "score"
                    ? "중요도 추정순(자동)"
                    : sort === "relevance"
                      ? "관련도순"
                      : "최신순"
                }`}
          </p>
        </div>

        {loading ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-[14px] text-gray-600">조건에 맞는 기사가 없습니다.</p>
            <button
              onClick={() => setParam({ desk: null, legal: null, range: "30d" })}
              className="mt-3 min-h-[44px] rounded-lg border border-gray-300 px-4 text-[13px] font-bold text-gray-700"
            >
              조건 넓히기 (1개월 · 전체 주제)
            </button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-200">
              {shown.map((item) => (
                <FeedRow key={item.link} item={item} />
              ))}
            </div>
            {remaining > 0 && (
              <div className="mt-5 text-center">
                <button
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-gray-300 bg-white px-6 text-[14px] font-bold text-gray-700 hover:border-[#FFB81C] hover:text-[#7A5E08]"
                >
                  더 보기
                  <span className="ml-1.5 text-[12px] text-gray-500">
                    +{Math.min(PAGE, remaining)}
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[13px] px-4 py-3 text-[15px] font-bold transition-colors ${
        active ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11.5px] font-bold tracking-wide text-gray-500">
        {label}
      </span>
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
        {children}
      </div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[40px] border-l border-gray-300 px-3.5 text-[13.5px] font-bold transition-colors first:border-l-0 ${
        active ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-5 sm:gap-5">
          <div className="min-w-0 flex-1">
            <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
            <div className="mt-2.5 h-5 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-40 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="h-[60px] w-[84px] shrink-0 animate-pulse rounded-lg bg-gray-200 sm:h-[84px] sm:w-[124px]" />
        </div>
      ))}
    </div>
  );
}
