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
const RANGE_KEYS = Object.keys(RANGE_LABEL) as RangeKey[];

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
  {
    id: "",
    label: "전체",
    hint: "태그가 붙은 기사를 모두 모았습니다 · 태그 밖 기사는 검색으로 찾으세요",
  },
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
    hint: "회사와 관련된 법 개정·제재·판결 (개인채무자보호법·대부업법·노란봉투법, 대부업·불법추심 특사경 단속 포함)",
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

// 9/22 태그 개편 전 URL(?desk=·?legal=1) 북마크를 지금의 태그로 옮긴다
const LEGACY_TAG: Record<string, string> = {
  collection: "collection",
  survey: "survey",
  edoc: "edoc",
  peers: "peers",
  own: "kbfg",
};

function legacyTagOf(params: { get(name: string): string | null }): string | undefined {
  const id = params.get("legal") === "1" ? "legal" : LEGACY_TAG[params.get("desk") ?? ""];
  // desk=constructor 같은 값이 객체 기본 속성을 집어 오지 않게 실제 태그 id만 받는다
  return TAGS.some((t) => t.id && t.id === id) ? id : undefined;
}

const PAGE = 30;
const LIMIT = 150;

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
  // 옛 북마크는 주소를 바꾸기 전 첫 화면부터 옮겨 갈 태그로 그린다 — 전체 목록이 한 번 번쩍이지 않게
  const tagId = params.get("tag") || legacyTagOf(params) || "";
  const tag = TAGS.find((t) => t.id === tagId) ?? TAGS[0];
  const rangeParam = params.get("range") as RangeKey;
  // 모르는 값은 API도 전체로 처리한다 — 요약 줄이 빈 라벨을 보이지 않게 여기서 맞춘다
  const range: RangeKey = RANGE_KEYS.includes(rangeParam) ? rangeParam : "all";
  // 기본 정렬은 최신순 — 담당자는 "오늘 뭐가 새로 났나"를 먼저 본다
  const sort = (params.get("sort") as SortKey) || (q ? "relevance" : "date");

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  const [input, setInput] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    if (params.get("tag")) return;
    const legacy = legacyTagOf(params);
    if (!legacy) return;
    const next = new URLSearchParams(params.toString());
    next.delete("desk");
    next.delete("legal");
    next.set("tag", legacy);
    router.replace(`/?${next}`);
  }, [params, router]);

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
    sp.set("limit", String(LIMIT));
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
        // 서버 문구는 화면에 내지 않는다 — 원인은 콘솔로만
        console.error(err);
        setItems([]);
        setError("기사를 불러오지 못했습니다");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [queryString, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);

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

  // scrollIntoView는 창 세로 스크롤까지 움직여 리더에서 돌아온 목록 위치를 잃는다 — 가로만 맞춘다
  useEffect(() => {
    const ul = chipsRef.current;
    const on = ul?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!ul || !on || ul.scrollWidth <= ul.clientWidth) return;
    const d = on.getBoundingClientRect().left - ul.getBoundingClientRect().left;
    ul.scrollLeft += d - (ul.clientWidth - on.offsetWidth) / 2;
  }, [tag.id]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) logSearch(trimmed);
    setParam({ q: trimmed || null, sort: trimmed ? "relevance" : null });
    // 결과 위를 덮은 키보드를 내린다
    inputRef.current?.blur();
  };

  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  // API가 LIMIT건에서 자르므로 LIMIT건이면 "그 이상"일 수 있다
  const capped = items.length >= LIMIT;
  const narrowed = Boolean(tag.id) || range !== "all";
  const sortLabel =
    sort === "score" ? "중요도순" : sort === "relevance" ? "관련도순" : "최신순";

  // 화면 제목은 선택한 태그를 그대로 따른다 — 전체면 전체, 채권추심이면 채권추심
  const heading = q ? `“${q}” 검색 결과` : tag.label;
  // 사용자 검색어는 태그의 내장 검색어(국민카드)를 대신한다 — 그때 실제 범위는 같은 데스크의 상위 태그(KB금융)
  const scope = q && tag.q ? (TAGS.find((t) => t.desk === tag.desk && !t.q) ?? tag) : tag;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 툴바 — 검색·주제·기간·정렬을 카드 하나에 층으로 쌓는다.
          컨트롤이 카드 세 장으로 흩어져 있던 것이 화면을 번잡하게 했다. */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 p-2 sm:gap-3 sm:p-2.5">
          <form onSubmit={submitSearch} className="search-box flex-1">
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
              enterKeyHint="search"
              aria-label="뉴스 검색"
              placeholder="키워드 검색"
              className="search-input sm:px-3"
            />
            {input && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => {
                  setInput("");
                  if (q) setParam({ q: null, sort: null });
                  else inputRef.current?.focus();
                }}
                className="search-clear"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button type="submit" className="search-btn">
              검색
            </button>
          </form>
        </div>

        <div className="border-t border-[var(--line)] px-3 py-2.5 sm:flex sm:items-start sm:gap-2.5 sm:px-4">
          {/* 기간·정렬과 같은 문법의 구획 라벨 — 첫 줄 칩(40px)과 세로 중앙 정렬.
              모바일은 칩 줄을 넓게 쓰려고 라벨을 뺀다 */}
          <span className="group-label hidden leading-[40px] sm:block">태그</span>
          <div className="min-w-0 flex-1">
            {/* 카드 오른쪽 끝까지 흘려 다음 칩이 잘려 보이게 한다 — 옆으로 넘길 수 있다는 단서.
                위아래 py-1은 포커스 링이 잘리지 않게 */}
            <ul
              ref={chipsRef}
              aria-label="태그"
              className="-my-1 -ml-1 -mr-3 flex gap-1.5 overflow-x-auto py-1 pl-1 pr-3 [scrollbar-width:none] sm:-mr-1 sm:flex-wrap sm:overflow-visible sm:pr-1 [&::-webkit-scrollbar]:hidden"
            >
              {TAGS.map((t) => {
                const active = tag.id === t.id;
                return (
                  <li key={t.id || "all"} className="shrink-0">
                    <button
                      type="button"
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
              <p className="mt-1.5 text-[13px] leading-snug text-gray-600">{tag.hint}</p>
            )}
          </div>
        </div>

        {/* 모바일은 기간·정렬을 한 줄 요약으로 접는다 — 목록이 첫 화면에 더 보이게 */}
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="news-filters"
          className="filter-toggle"
        >
          <span className="min-w-0 text-[14px] font-bold text-gray-900">
            기간 {RANGE_LABEL[range]} · {sortLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[14px] font-bold text-[#7A5E08]">
            {filtersOpen ? "접기" : "조건 변경"}
            <svg
              className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.2}
              stroke="currentColor"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>

        <div
          id="news-filters"
          className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] px-3 py-2 sm:flex sm:gap-x-6 sm:px-4`}
        >
          <Group label="기간">
            {RANGE_KEYS.map((r) => (
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

      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            {heading}
          </h1>
          <p className="text-[13px] text-gray-600" aria-live="polite">
            {loading
              ? "불러오는 중…"
              : error
                ? ""
                : `${capped ? `${LIMIT}건 이상` : `${items.length.toLocaleString()}건`} · ${
                    sort === "score"
                      ? "중요도 추정순(자동)"
                      : sort === "relevance"
                        ? "관련도순"
                        : "최신순"
                  }`}
          </p>
          {q && scope.id && (
            <p className="w-full text-[13px] text-gray-600">
              {scope.label} 태그 안에서 찾은 결과 ·{" "}
              <button
                type="button"
                onClick={() => setParam({ tag: null })}
                className="inline-flex min-h-[40px] items-center font-bold text-[#7A5E08] underline underline-offset-2"
              >
                전체에서 찾기
              </button>
            </p>
          )}
        </div>

        {loading ? (
          <Skeleton />
        ) : error ? (
          <div role="alert" className="error-box">
            <p className="text-[15px] font-bold text-rose-800">기사를 불러오지 못했습니다</p>
            <p className="mt-1 text-[14px] text-rose-800">
              잠시 후 다시 시도해 주세요. 계속되면 담당자에게 알려 주세요.
            </p>
            <button type="button" onClick={retry} className="btn-retry">
              다시 불러오기
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[15px] font-bold text-gray-900">
              {q ? `“${q}”(으)로 찾은 기사가 없습니다` : "조건에 맞는 기사가 없습니다"}
            </p>
            {q && (
              <p className="mt-1 text-[13.5px] text-gray-600">
                검색은 최근 30일 보관 기사에서 찾습니다
              </p>
            )}
            {!q && !narrowed && (
              <p className="mt-1 text-[13.5px] text-gray-600">
                새 기사가 수집되면 여기에 표시됩니다.
              </p>
            )}
            {/* 누르면 실제로 무언가 바뀌는 버튼만 — 무엇을 되돌리는지 글자로 밝힌다 */}
            <div className="mt-4 flex flex-col items-center gap-2">
              {q && (
                <button
                  type="button"
                  onClick={() => setParam({ q: null, sort: null })}
                  className="btn-soft"
                >
                  검색어 지우기
                </button>
              )}
              {narrowed && (
                <button
                  type="button"
                  onClick={() => setParam({ tag: null, range: null })}
                  className="btn-soft"
                >
                  전체 기간 · 전체 태그로 보기
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--line)]">
              {shown.map((item) => (
                // 태그를 골라 보는 중엔(그 태그 안에서 검색할 때도) 카드 알약도 그 태그를 따른다 —
                // 법/정책처럼 데스크가 아닌 조건으로 매칭되는 태그에서
                // 기사 원소속(채권추심 등)이 뒤섞여 보이지 않게.
                <FeedRow
                  key={item.link}
                  item={item}
                  pill={scope.id ? scope.label : undefined}
                  highlight={q || undefined}
                />
              ))}
            </div>
            {remaining > 0 ? (
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="btn-soft px-6"
                >
                  {Math.min(PAGE, remaining)}건 더 보기
                </button>
              </div>
            ) : capped ? (
              <p className="mt-5 text-center text-[13px] text-gray-600">
                최대 {LIMIT}건까지 보여 드립니다 · 기간이나 태그를 좁혀 보세요
              </p>
            ) : (
              <p className="mt-5 text-center text-[13px] text-gray-600">마지막 기사입니다</p>
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
      <span className="group-label">{label}</span>
      <div role="group" aria-label={label} className="seg-group">
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`seg ${active ? "seg-on" : ""}`}
    >
      {children}
    </button>
  );
}

// 썸네일은 실제 이미지가 있을 때만 붙으므로 대기 화면도 글줄만 그린다
function Skeleton() {
  return (
    <div className="divide-y divide-[var(--line)]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="py-3.5 sm:py-5">
          <div className="h-[22px] w-16 animate-pulse rounded-full bg-gray-200" />
          <div className="mt-2 h-5 w-full animate-pulse rounded bg-gray-200" />
          <div className="mt-1.5 h-5 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="mt-2.5 h-4 w-32 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
