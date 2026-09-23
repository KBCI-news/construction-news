"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BidItem, BidsResponse } from "@/app/api/bids/route";
import { BID_AREAS, bidAreaLabel } from "@/lib/bids";
import { formatRelative } from "@/lib/format";

type StatusKey = "open" | "closed" | "all";
type SortKey = "notice" | "close" | "relevance";
type RangeKey = "7d" | "30d" | "90d" | "all";

const STATUS_LABEL: Record<StatusKey, string> = {
  open: "진행중",
  closed: "마감",
  all: "전체",
};

const SORT_LABEL: Record<SortKey, string> = {
  notice: "최신 공고순",
  close: "마감 임박순",
  // 분야 적합도 — 검색 관련도와 헷갈리지 않게
  relevance: "적합도순",
};

// 요약 줄·빈 화면에서 홀로 읽히는 상태 이름 — '전체'만 있으면 무엇의 전체인지 모른다
const STATUS_SUMMARY: Record<StatusKey, string> = {
  open: "진행중",
  closed: "마감됨",
  all: "상태 전체",
};

const RANGE_LABEL: Record<RangeKey, string> = {
  "7d": "1주",
  "30d": "1달",
  "90d": "3달",
  all: "전체",
};

const PAGE = 30;

/** 원 단위 금액을 게시판에 옮겨 적기 좋은 단위로 줄인다 */
function formatMoney(won: number | null): string | null {
  if (!won || won <= 0) return null;
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return `${eok >= 10 ? Math.round(eok) : eok.toFixed(1).replace(/\.0$/, "")}억원`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}

function dday(closeDt: string | null): { text: string; urgent: boolean } | null {
  if (!closeDt) return null;
  const close = new Date(closeDt).getTime();
  if (Number.isNaN(close)) return null;
  const diff = close - Date.now();
  if (diff < 0) return { text: "마감", urgent: false };
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) {
    const hours = Math.max(1, Math.floor(diff / 3_600_000));
    return { text: `${hours}시간 남음`, urgent: true };
  }
  return { text: `D-${days}`, urgent: days <= 3 };
}

/** 예: 10월 26일 (월) 오후 4:00 — 요일까지 보여 달력을 안 봐도 되게 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

// 모르는 값은 API와 같은 기본으로 맞춘다(상태 → 거르지 않음, 기간 → 30일, 정렬 → 최신) —
// 조회 결과는 그대로이고 요약 줄에 빈 라벨이 뜨지 않는다
const isKey = <K extends string>(labels: Record<K, string>, v: string | null): v is K =>
  v !== null && Object.keys(labels).includes(v);
const asStatus = (v: string | null): StatusKey =>
  !v ? "open" : isKey(STATUS_LABEL, v) ? v : "all";
const asRange = (v: string | null): RangeKey => (isKey(RANGE_LABEL, v) ? v : "30d");
const asSort = (v: string | null): SortKey => (isKey(SORT_LABEL, v) ? v : "notice");

export default function BidsClient() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const area = params.get("area") ?? "";
  const status = asStatus(params.get("status"));
  const sort = asSort(params.get("sort"));
  const range = asRange(params.get("range"));

  const [data, setData] = useState<BidsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  const [input, setInput] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);

  useEffect(() => setInput(q), [q]);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      });
      router.push(next.toString() ? `/bids?${next}` : "/bids");
    },
    [params, router],
  );

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("status", status);
    sp.set("sort", sort);
    sp.set("range", range);
    sp.set("limit", "200");
    if (area) sp.set("area", area);
    if (q) sp.set("q", q);
    return sp.toString();
  }, [area, status, sort, range, q]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setVisible(PAGE);

    fetch(`/api/bids?${queryString}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "요청 실패");
        return json as BidsResponse;
      })
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // 서버 문구는 화면에 내지 않는다 — 원인은 콘솔로만
        console.error(err);
        setData(null);
        setError("입찰공고를 불러오지 못했습니다");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [queryString, reload]);

  // 링크로 들어왔을 때 선택된 분야 칩이 가로 스크롤 밖에 숨지 않게 — 세로 스크롤은 건드리지 않는다
  useEffect(() => {
    const ul = chipsRef.current;
    const on = ul?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!ul || !on || ul.scrollWidth <= ul.clientWidth) return;
    const d = on.getBoundingClientRect().left - ul.getBoundingClientRect().left;
    ul.scrollLeft += d - (ul.clientWidth - on.offsetWidth) / 2;
  }, [area]);

  const retry = () => setReload((n) => n + 1);

  const items = data?.items ?? [];
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const areaInfo = BID_AREAS.find((a) => a.id === area);
  // 수집은 약 4시간 간격(최대 6.3시간 관측) — 12시간을 넘으면 멈춘 것으로 본다
  const stale = data?.lastRun
    ? Date.now() - new Date(data.lastRun.ranAt).getTime() > 12 * 3_600_000
    : false;

  return (
    <div className="space-y-3 sm:space-y-4">
      {data && !data.ready && (
        <div role="status" className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4">
          <p className="text-[14px] font-bold text-gray-900">입찰공고 기능을 준비하고 있습니다.</p>
          <p className="mt-1 text-[13.5px] text-gray-700">
            관리자 설정이 끝나면 이 화면에 공고가 표시됩니다.
          </p>
          {/* 요약 줄은 위아래 여백으로 44px 터치 영역 — 아래 여백은 음수 여백으로 상자 패딩과 겹쳐 높이를 늘리지 않는다.
              list-item 표시를 유지해야 안드로이드 크롬이 ▶ 표시를 그린다 */}
          <details className="text-[12.5px] text-gray-600">
            <summary className="-mb-3 cursor-pointer py-3 font-bold">관리자용 안내</summary>
            <p className="mt-1">
              Supabase에 <code>supabase/migrations/0009_bids.sql</code>을 적용한 뒤,
              공공데이터포털 서비스키를 <code>G2B_SERVICE_KEY</code>로 등록하세요.
              자세한 절차는 <code>docs/bids.md</code>에 있습니다.
            </p>
          </details>
        </div>
      )}

      {/* 툴바 — 검색·분야·상태·정렬을 카드 하나에 층으로 쌓는다 */}
      <div className="card overflow-hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: input.trim() || null });
            // 결과 위를 덮은 키보드를 내린다
            inputRef.current?.blur();
          }}
          className="search-box m-2 sm:m-2.5"
        >
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
            aria-label="공고 검색"
            placeholder="공고명·수요기관 검색"
            enterKeyHint="search"
            className="search-input sm:px-3"
          />
          {input && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setInput("");
                if (q) setParam({ q: null });
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

        {/* 뉴스 태그 줄과 같은 한 줄 가로 스크롤 — 카드 오른쪽 끝까지 흘려 다음 칩이
            잘려 보이게 한다(옆으로 넘길 수 있다는 단서). 모바일은 칩 줄을 넓게 쓰려고
            라벨을 뺀다. 위아래 py-1은 포커스 링이 잘리지 않게 */}
        <div className="border-t border-[var(--line)] px-3 py-2.5 sm:flex sm:items-start sm:gap-2.5 sm:px-4">
          <span className="group-label hidden leading-[40px] sm:block">분야</span>
          <div className="min-w-0 flex-1">
            <ul
              ref={chipsRef}
              aria-label="분야"
              className="-my-1 -ml-1 -mr-3 flex gap-1.5 overflow-x-auto py-1 pl-1 pr-3 [scrollbar-width:none] sm:-mr-1 sm:flex-wrap sm:overflow-visible sm:pr-1 [&::-webkit-scrollbar]:hidden"
            >
              {[{ id: "", label: "전체" }, ...BID_AREAS.map((a) => ({ id: a.id, label: a.label }))].map(
                (chip) => {
                  const active = area === chip.id;
                  return (
                    <li key={chip.id || "all"} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setParam({ area: chip.id || null })}
                        aria-pressed={active}
                        className={`chip ${active ? "chip-on" : ""}`}
                      >
                        {chip.label}
                      </button>
                    </li>
                  );
                },
              )}
            </ul>
            {areaInfo && (
              <p className="mt-1.5 text-[13px] leading-snug text-gray-600">{areaInfo.definition}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="bid-filters"
          className="filter-toggle"
        >
          <span className="min-w-0 text-[14px] font-bold text-gray-900">
            {STATUS_SUMMARY[status]} · 공고일 {RANGE_LABEL[range]} · {SORT_LABEL[sort]}
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
          id="bid-filters"
          className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] px-3 py-2 sm:flex sm:gap-x-6 sm:px-4`}
        >
          <Group label="상태">
            {(Object.keys(STATUS_LABEL) as StatusKey[]).map((s) => (
              <Seg key={s} active={status === s} onClick={() => setParam({ status: s })}>
                {STATUS_LABEL[s]}
              </Seg>
            ))}
          </Group>
          <Group label="공고일">
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
              <Seg key={r} active={range === r} onClick={() => setParam({ range: r })}>
                {RANGE_LABEL[r]}
              </Seg>
            ))}
          </Group>
          <Group label="정렬">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
              <Seg key={s} active={sort === s} onClick={() => setParam({ sort: s })}>
                {SORT_LABEL[s]}
              </Seg>
            ))}
          </Group>
        </div>
      </div>

      <section className="card p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            {q ? `“${q}” 검색 결과` : areaInfo ? `입찰공고 · ${areaInfo.label}` : "입찰공고"}
          </h1>
          <p className="text-[13px] text-gray-600" aria-live="polite">
            {loading
              ? "불러오는 중…"
              : error || !data?.ready
                ? ""
                : `${items.length.toLocaleString()}건 · ${SORT_LABEL[sort]}`}
          </p>
          {q && areaInfo && (
            <p className="w-full text-[13px] text-gray-600">
              {areaInfo.label} 분야 안에서 찾은 결과 ·{" "}
              <button
                type="button"
                onClick={() => setParam({ area: null })}
                className="inline-flex min-h-[40px] items-center font-bold text-[#7A5E08] underline underline-offset-2"
              >
                모든 분야에서 찾기
              </button>
            </p>
          )}
        </div>
        {data?.ready && (
          <>
            {data.lastRun && (
              <p
                className="mt-1 flex items-start gap-1.5 text-[13px] font-semibold text-gray-800"
                title={data.lastRun.detail ?? undefined}
              >
                {/* 360px에서 경고 문구가 두 줄이 되어도 점은 첫 줄 옆에 */}
                <span
                  aria-hidden
                  className={`mt-[6px] h-2 w-2 shrink-0 rounded-full ${
                    !data.lastRun.ok ? "bg-rose-600" : stale ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                />
                마지막 확인 {formatRelative(data.lastRun.ranAt)}
                {stale && " — 확인이 늦어지고 있습니다"}
                {!data.lastRun.ok && " — 확인 중 문제가 있었습니다"}
              </p>
            )}
            <p className="mb-3 mt-0.5 text-[13px] leading-relaxed text-gray-600">
              나라장터 공고를 자동으로 확인해 관련 분야만 모읍니다. 응찰 전에는 꼭 원문 공고를
              확인하세요.
            </p>
          </>
        )}

        {loading ? (
          <Skeleton />
        ) : error ? (
          <div role="alert" className="error-box">
            <p className="text-[15px] font-bold text-rose-800">입찰공고를 불러오지 못했습니다</p>
            <p className="mt-1 text-[14px] text-rose-800">
              잠시 후 다시 시도해 주세요. 계속되면 담당자에게 알려 주세요.
            </p>
            <button type="button" onClick={retry} className="btn-retry">
              다시 불러오기
            </button>
          </div>
        ) : !data ? (
          <Skeleton />
        ) : !data.ready ? (
          // 준비 중 안내는 위 노란 상자가 맡는다 — 목록 칸이 제목만 남은 빈 상자로 보이지 않게 한 줄만
          <p className="py-8 text-center text-[14px] text-gray-600">
            설정이 끝나면 이곳에 공고가 표시됩니다
          </p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[15px] font-bold text-gray-900">조건에 맞는 공고가 없습니다</p>
            <p className="mt-1 text-[13.5px] text-gray-600">
              조건: 공고일 {RANGE_LABEL[range]} · {STATUS_SUMMARY[status]}
              {areaInfo && ` · ${areaInfo.label}`}
              {q && ` · “${q}”`}
            </p>
            <p className="mt-1 text-[13px] text-gray-600">
              새 공고가 올라오면 자동으로 여기에 표시됩니다.
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              {!(status === "all" && range === "all") && (
                <button
                  type="button"
                  onClick={() => setParam({ status: "all", range: "all" })}
                  className="btn-soft"
                >
                  기간·상태 전체로 보기
                </button>
              )}
              {area && (
                <button type="button" onClick={() => setParam({ area: null })} className="btn-soft">
                  모든 분야 보기
                </button>
              )}
              {q && (
                <button type="button" onClick={() => setParam({ q: null })} className="btn-soft">
                  검색어 지우기
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[var(--line)]">
              {shown.map((bid) => (
                <BidRow key={bid.bidKey} bid={bid} />
              ))}
            </ul>
            {remaining > 0 && (
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="btn-soft px-6"
                >
                  {Math.min(PAGE, remaining)}건 더 보기
                </button>
              </div>
            )}
            {remaining === 0 && items.length > PAGE && (
              <p className="mt-5 text-center text-[13px] text-gray-600">마지막 공고입니다</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function BidRow({ bid }: { bid: BidItem }) {
  // 취소된 공고는 응찰할 수 없으므로 남은 기간을 세지 않는다
  const cancelled = bid.noticeKind?.includes("취소") ?? false;
  const d = cancelled ? null : dday(bid.closeDt);
  const ended = cancelled || d?.text === "마감";
  const money = formatMoney(bid.budgetAmount ?? bid.presmptPrice);
  const moneyLabel = bid.budgetAmount != null ? "예산" : "추정가격";
  // 나라장터 원값(예: 본사또는참여지사소재지)을 읽히게만 풀어 쓴다 — 지역 제한이라고 단정하지 않는다
  const regionText = !bid.region
    ? null
    : /소재지$/.test(bid.region)
      ? `소재지 기준: ${bid.region.replace(/소재지$/, "").replace(/또는/g, " 또는 ")}`
      : `참가지역 ${bid.region}`;
  // 'DB구축'·'DB 구축'처럼 띄어쓰기만 다른 근거는 하나로 합친다
  const reasons = Array.from(
    new Map(
      bid.matchedTerms.map((t) => [t.replace(/\s+/g, ""), t.replace(/^분류:/, "조달분류 ")]),
    ).values(),
  ).slice(0, 4);
  const linked = Boolean(bid.detailUrl);

  const facts: React.ReactNode[] = [];
  if (money)
    facts.push(
      <>
        {moneyLabel} <b className="font-semibold text-gray-900">{money}</b>
      </>,
    );
  if (bid.contractMethod) facts.push(bid.contractMethod);
  if (bid.workDiv) facts.push(bid.workDiv);
  if (regionText) facts.push(regionText);

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {bid.areas.map((a) => (
          <span key={a} className="pill-tag">
            {bidAreaLabel(a)}
          </span>
        ))}
        {/* 취소·정정은 응찰 가능 여부를 바꾸므로 제목 앞에서 먼저 읽혀야 한다 */}
        {bid.noticeKind && bid.noticeKind !== "등록공고" && (
          <span
            className={`rounded-md px-2 py-[2px] text-[12px] font-bold ${
              cancelled ? "bg-rose-100 text-rose-800" : "border border-gray-300 bg-white text-gray-700"
            }`}
          >
            {bid.noticeKind}
          </span>
        )}
        {linked && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-[#7A5E08]">
            나라장터
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.2}
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25"
              />
            </svg>
          </span>
        )}
      </div>

      <h2
        className={`mt-1.5 text-[17px] font-bold leading-snug tracking-tight decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[20px] ${
          ended ? "text-gray-500" : "text-gray-900"
        }`}
      >
        {bid.title}
        {linked && <span className="sr-only"> (나라장터 원문, 새 창)</span>}
      </h2>

      {bid.demandAgency && (
        <p className="mt-1 text-[14px] font-semibold text-gray-800">{bid.demandAgency}</p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* 800 굵기는 Display 글꼴로 바뀌어 글자가 상자 위로 뜬다 — 700(Text)로 가운데를 맞춘다 */}
        {d && (
          <span
            className={`rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums ${
              d.text === "마감"
                ? "bg-gray-100 text-gray-600"
                : d.urgent
                  ? "bg-rose-50 text-rose-700"
                  : "bg-gray-100 text-gray-800"
            }`}
          >
            {d.text === "마감" ? "마감됨" : d.text}
          </span>
        )}
        {bid.closeDt ? (
          <span
            className={`text-[14px] font-semibold ${ended ? "text-gray-600" : "text-gray-900"}`}
          >
            마감 {formatDateTime(bid.closeDt)}
          </span>
        ) : (
          <span className="text-[14px] font-semibold text-gray-700">마감일 미정 · 원문 확인</span>
        )}
      </p>

      {/* 항목은 한 덩어리로 줄을 바꾼다('소재지 기준: 본사 / 또는 참여지사'로 갈라지지 않게).
          가운뎃점은 리더 메타 줄처럼 항목 앞에 붙이고 한 칸만큼 왼쪽으로 밀어 잘라 낸다 —
          지역 항목이 다음 줄로 넘어가도 윗줄 끝에 점이 홀로 남지 않는다 */}
      {facts.length > 0 && (
        <div className="mt-1 overflow-hidden">
          <p className="-ml-[18px] flex flex-wrap text-[13.5px] text-gray-700">
            {facts.map((f, i) => (
              <span
                key={i}
                className="before:inline-block before:w-[18px] before:text-center before:font-normal before:text-gray-300 before:content-['·']"
              >
                {f}
              </span>
            ))}
          </p>
        </div>
      )}

      <p className="mt-1 text-[12.5px] tabular-nums text-gray-600">
        공고 {formatDay(bid.noticeDt)} · 공고번호 {bid.bidNo}
        {/* 차수는 API가 '000'/'00' 등 자리수를 섞어 준다. 0이면 최초 공고다. */}
        {Number(bid.bidOrd) > 0 ? `-${bid.bidOrd}` : ""}
      </p>

      {reasons.length > 0 && (
        <ul aria-label="분야 판정 근거" className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <li aria-hidden className="reason-label">
            근거
          </li>
          {reasons.map((r) => (
            <li key={r} className="reason-chip">
              {r}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <li>
      {bid.detailUrl ? (
        <a
          href={bid.detailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group -mx-2 block rounded-xl px-2 py-4 active:bg-gray-100"
        >
          {body}
        </a>
      ) : (
        <div className="-mx-2 px-2 py-4">{body}</div>
      )}
    </li>
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

function Skeleton() {
  return (
    <div className="divide-y divide-[var(--line)]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="py-4">
          <div className="h-[22px] w-20 animate-pulse rounded-full bg-gray-200" />
          <div className="mt-2 h-5 w-full animate-pulse rounded bg-gray-200" />
          <div className="mt-1.5 h-5 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-28 animate-pulse rounded bg-gray-200" />
          <div className="mt-2.5 h-4 w-48 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
