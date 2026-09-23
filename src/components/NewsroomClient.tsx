"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FeedItem, FeedResponse } from "@/app/api/feed/route";
import { LEGAL_KINDS } from "@/lib/lexicon";
import { FeedRow } from "@/components/FeedRow";

type SortKey = "score" | "date" | "relevance";
type RangeKey = "24h" | "7d" | "30d" | "all";

// 디폴트는 전체 — 처음 열었을 때 조건 때문에 빈 화면이 나오지 않게 한다
const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "1일",
  "7d": "1주",
  "30d": "1달",
  all: "전체",
};

/**
 * 뉴스 태그 — 담당자가 실제로 나눠 보는 8개 축.
 * 데스크(desk)·법제도 필터(legal)·추가 검색어(q)를 조합해 피드 조건이 된다.
 * 화면 제목도 이 라벨을 그대로 쓴다.
 */
type NewsTag = {
  id: string; // URL의 tag= 값. 빈 문자열 = 전체
  label: string;
  desk?: string;
  legal?: boolean;
  /** 데스크 안에서 제목·요약을 추가로 좁히는 검색어 */
  q?: string;
  hint?: string;
};

const TAGS: NewsTag[] = [
  { id: "", label: "전체" },
  {
    id: "collection",
    label: "채권추심",
    desk: "collection",
    hint: "추심 업무의 법·감독·제재와 실무 동향",
  },
  {
    id: "legal",
    label: "법/정책",
    legal: true,
    hint: "회사와 관련될 법 개정·제재·판결 — 개인채무자보호법·대부업법·노란봉투법, 대부업·추심 특사경 단속 등 포함",
  },
  {
    id: "edoc",
    label: "전자문서",
    desk: "edoc",
    hint: "문서 전자화·스캔·보관, 전자계약·전자결재",
  },
  {
    id: "survey",
    label: "임대차/권리조사",
    desk: "survey",
    hint: "전세사기·보증금·등기·권리관계 조사",
  },
  { id: "kbfg", label: "KB금융", desk: "own", hint: "KB금융그룹 관련 뉴스 전량" },
  {
    id: "kbcard",
    label: "KB국민카드",
    desk: "own",
    q: "국민카드",
    hint: "KB국민카드 관련 뉴스",
  },
  {
    id: "peers",
    label: "신용정보업권",
    desk: "peers",
    hint: "신한·우리·고려신용정보 등 채권추심 회사들의 동향",
  },
];

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
  const tagId = params.get("tag") ?? "";
  const tag = TAGS.find((t) => t.id === tagId) ?? TAGS[0];
  const range = (params.get("range") as RangeKey) || "all";
  // 기본 정렬은 최신순 — 담당자는 "오늘 뭐가 새로 났나"를 먼저 본다
  const sort = (params.get("sort") as SortKey) || (q ? "relevance" : "date");

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
    // 사용자가 검색하면 태그의 내장 검색어(예: KB국민카드)보다 우선한다
    const effectiveQ = q || tag.q || "";
    if (effectiveQ) sp.set("q", effectiveQ);
    if (tag.desk) sp.set("desk", tag.desk);
    if (tag.legal) {
      LEGAL_KINDS.forEach((k) => sp.append("kind", k));
      // 법/정책은 "우리와 관련된" 법 개정·제재·판결만 — 데스크 소속을 요구해
      // 무관한 일반 법조 기사(하도급 과징금, 헌재 각하 등)를 거른다
      sp.set("scope", "curated");
    } else if (!tag.desk && !q) {
      // 전체 = 아래 태그들의 합집합. 태그 체계 밖(정보보호·부실채권 등)만 걸린
      // 기사와 태그 없는 일반 뉴스는 검색으로만 닿는다
      sp.set("scope", "tagged");
    }
    return sp.toString();
  }, [q, tag, range, sort]);

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

  // 화면 제목은 선택한 태그를 그대로 따른다 — 전체면 전체, 채권추심이면 채권추심
  const heading = q ? `"${q}" 검색 결과` : tag.label;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 툴바 — 검색·주제·기간·정렬을 카드 하나에 층으로 쌓는다.
          컨트롤이 카드 세 장으로 흩어져 있던 것이 화면을 번잡하게 했다. */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 p-2 pl-3 sm:gap-3 sm:p-2.5 sm:pl-4">
          <form
            onSubmit={submitSearch}
            className="flex min-w-0 flex-1 items-center rounded-xl pl-2 ring-inset transition-shadow focus-within:ring-2 focus-within:ring-[#FFB81C]"
          >
            <svg
              className="pointer-events-none h-5 w-5 shrink-0 text-gray-400"
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
              className="min-h-[48px] w-full min-w-0 bg-transparent px-2.5 text-[16px] font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 sm:px-3"
            />
            <button
              type="submit"
              className="hidden min-h-[44px] shrink-0 rounded-lg px-3 text-[14px] font-bold text-gray-600 hover:text-[#7A5E08] sm:block"
            >
              검색
            </button>
          </form>
        </div>

        <div className="flex items-start gap-2.5 border-t border-[var(--line)] px-3 py-2.5 sm:px-4">
          {/* 기간·정렬과 같은 문법의 구획 라벨 — 첫 줄 칩(40px)과 세로 중앙 정렬 */}
          <span className="shrink-0 text-[11.5px] font-bold leading-[40px] tracking-wide text-gray-500">
            태그
          </span>
          <div className="min-w-0 flex-1">
            <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
              {TAGS.map((t) => {
                const active = tag.id === t.id;
                return (
                  <li key={t.id || "all"} className="shrink-0">
                    <button
                      onClick={() => setParam({ tag: t.id || null })}
                      aria-pressed={active}
                      className={`chip ${active ? "chip-on" : ""}`}
                    >
                      {t.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            {tag.hint && (
              <p className="mt-1.5 text-[12.5px] text-gray-500">{tag.hint}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] px-3 py-2 sm:gap-x-6 sm:px-4">
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
                ["date", "최신순"],
                ["score", "중요도순"],
                ...(q ? ([["relevance", "관련도순"]] as [SortKey, string][]) : []),
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <Seg key={key} active={sort === key} onClick={() => setParam({ sort: key })}>
                {label}
              </Seg>
            ))}
          </Group>
        </div>
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
              onClick={() => setParam({ tag: null, range: null })}
              className="mt-3 min-h-[44px] rounded-full bg-gray-100 px-5 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-200"
            >
              조건 넓히기 (전체 기간 · 전체 태그)
            </button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--line)]">
              {shown.map((item) => (
                // 태그를 골라 보는 중엔 카드 알약도 그 태그를 따른다 —
                // 법/정책처럼 데스크가 아닌 조건으로 매칭되는 태그에서
                // 기사 원소속(채권추심 등)이 뒤섞여 보이지 않게.
                <FeedRow
                  key={item.link}
                  item={item}
                  pill={!q && tag.id ? tag.label : undefined}
                />
              ))}
            </div>
            {remaining > 0 && (
              <div className="mt-5 text-center">
                <button
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-gray-100 px-6 text-[14px] font-bold text-gray-700 transition-colors hover:bg-gray-200"
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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11.5px] font-bold tracking-wide text-gray-500">
        {label}
      </span>
      <div className="seg-group">{children}</div>
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
      className={`seg ${active ? "seg-on" : ""}`}
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="divide-y divide-[var(--line)]">
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
