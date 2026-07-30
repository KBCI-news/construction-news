"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FeedItem, FeedResponse } from "@/app/api/feed/route";
import { DESKS, LEGAL_KINDS, getDesk } from "@/lib/lexicon";
import { FeedRow } from "@/components/FeedRow";

type SortKey = "score" | "date" | "relevance";
type RangeKey = "24h" | "7d" | "30d";

const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "24시간",
  "7d": "7일",
  "30d": "30일",
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

  const q = params.get("q") ?? "";
  const desk = params.get("desk") ?? "";
  const legal = params.get("legal") === "1";
  const range = (params.get("range") as RangeKey) || "7d";
  const sort = (params.get("sort") as SortKey) || (q ? "relevance" : "score");
  const minScore = params.get("minScore") ?? "";

  const [items, setItems] = useState<FeedItem[]>([]);
  const [unscored, setUnscored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setInput(q), [q]);

  // 현재 조건을 URL에 반영한다 — 뒤로가기·공유·로고 클릭이 모두 자연스럽게 동작한다
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
    if (desk) sp.set("desk", desk);
    if (minScore) sp.set("minScore", minScore);
    if (legal) LEGAL_KINDS.forEach((k) => sp.append("kind", k));
    return sp.toString();
  }, [q, desk, legal, range, sort, minScore]);

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
      .then((json) => {
        setItems(json.items ?? []);
        setUnscored(Boolean(json.unscored));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [queryString]);

  // "/" 로 검색창 포커스
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
  const deskInfo = desk ? getDesk(desk) : undefined;

  return (
    <div className="space-y-5">
      {/* 검색 */}
      <form onSubmit={submitSearch} className="card flex items-center px-3">
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
          placeholder="키워드 검색  ( / )"
          className="min-h-[52px] w-full bg-transparent px-3 text-[16px] font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-500 sm:text-[17px]"
        />
        <button
          type="submit"
          className="min-h-[44px] shrink-0 rounded-lg px-3 text-[14px] font-bold text-gray-700 hover:text-[#7A5E08]"
        >
          검색
        </button>
      </form>

      {/* 데스크 필터 */}
      <nav aria-label="데스크 필터" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex items-center gap-2">
          {[
            { id: "", label: "전체" },
            { id: "__legal__", label: "법·제도" },
            ...DESKS.map((d) => ({ id: d.id, label: d.label })),
          ].map((chip) => {
            const active =
              chip.id === "__legal__" ? legal : !legal && desk === chip.id;
            return (
              <li key={chip.id || "all"}>
                <button
                  onClick={() =>
                    chip.id === "__legal__"
                      ? setParam({ legal: legal ? null : "1", desk: null })
                      : setParam({ desk: chip.id || null, legal: null })
                  }
                  aria-pressed={active}
                  className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[13.5px] font-bold transition-colors ${
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
      </nav>

      {/* 정렬·기간·등급 */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Control label="정렬">
          {(
            [
              ["score", "중요도"],
              ["date", "최신"],
              ...(q ? ([["relevance", "관련도"]] as [SortKey, string][]) : []),
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <Toggle
              key={key}
              active={sort === key}
              onClick={() => setParam({ sort: key })}
            >
              {label}
            </Toggle>
          ))}
        </Control>
        <Control label="기간">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
            <Toggle key={r} active={range === r} onClick={() => setParam({ range: r })}>
              {RANGE_LABEL[r]}
            </Toggle>
          ))}
        </Control>
        <Control label="등급">
          <Toggle active={!minScore} onClick={() => setParam({ minScore: null })}>
            전체
          </Toggle>
          <Toggle active={minScore === "55"} onClick={() => setParam({ minScore: "55" })}>
            중요 이상
          </Toggle>
          <Toggle active={minScore === "72"} onClick={() => setParam({ minScore: "72" })}>
            필수확인
          </Toggle>
        </Control>
      </div>

      {deskInfo && (
        <p className="px-1 text-[13px] text-gray-600">
          <span className="font-bold text-gray-900">{deskInfo.label}</span> —{" "}
          {deskInfo.definition}
        </p>
      )}

      {unscored && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          아직 중요도 채점이 실행되지 않아 최신순으로 표시합니다. 수집 주기가
          한 번 돌면 등급과 근거가 표시됩니다.
        </p>
      )}

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

      {/* 피드 — 홈의 유일한 목록. 같은 기사가 여러 섹션에 중복 노출되지 않는다. */}
      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            {q ? `"${q}" 검색 결과` : desk ? getDesk(desk)?.label : legal ? "법·제도" : "뉴스룸"}
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
            <p className="text-[14px] text-gray-600">
              조건에 맞는 기사가 없습니다.
            </p>
            <button
              onClick={() => setParam({ desk: null, legal: null, minScore: null, range: "30d" })}
              className="mt-3 min-h-[44px] rounded-lg border border-gray-300 px-4 text-[13px] font-bold text-gray-700"
            >
              조건 넓히기 (30일·전체)
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
                  더 보기 <span className="ml-1.5 text-[12px] text-gray-500">+{Math.min(PAGE, remaining)}</span>
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-bold tracking-wide text-gray-500">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Toggle({
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
      className={`min-h-[36px] rounded-md px-2.5 text-[13px] font-bold transition-colors ${
        active ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
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
