"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  relevance: "관련도순",
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

const formatDate = (iso: string | null): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function BidsClient() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const area = params.get("area") ?? "";
  const status = (params.get("status") as StatusKey) || "open";
  const sort = (params.get("sort") as SortKey) || "notice";
  const range = (params.get("range") as RangeKey) || "30d";

  const [data, setData] = useState<BidsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [input, setInput] = useState(q);

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
        setError(err instanceof Error ? err.message : "오류가 발생했습니다");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [queryString]);

  const items = data?.items ?? [];
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const areaInfo = BID_AREAS.find((a) => a.id === area);

  return (
    <div className="space-y-3 sm:space-y-4">
      {data && !data.ready && (
        <div role="alert" className="card border-l-4 border-amber-500 p-4">
          <p className="text-[14px] font-bold text-gray-900">
            입찰공고 테이블이 아직 준비되지 않았습니다.
          </p>
          <p className="mt-1 text-[13px] text-gray-700">
            Supabase에 <code>supabase/migrations/0009_bids.sql</code>을 적용한 뒤,
            공공데이터포털 서비스키를 <code>G2B_SERVICE_KEY</code>로 등록하세요.
            자세한 절차는 <code>docs/bids.md</code>에 있습니다.
          </p>
        </div>
      )}

      {/* 툴바 — 검색·분야·상태·정렬을 카드 하나에 층으로 쌓는다 */}
      <div className="card overflow-hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: input.trim() || null });
          }}
          className="flex items-center px-3 sm:px-4"
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
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="공고 검색"
            placeholder="공고명·수요기관 검색"
            className="min-h-[48px] w-full min-w-0 bg-transparent px-2.5 text-[16px] font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 sm:px-3"
          />
          <button
            type="submit"
            className="min-h-[44px] shrink-0 rounded-lg px-3 text-[14px] font-bold text-gray-600 hover:text-[#7A5E08]"
          >
            검색
          </button>
        </form>

        <div className="border-t border-[var(--line)] px-3 py-2.5 sm:px-4">
          <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {[{ id: "", label: "전체" }, ...BID_AREAS.map((a) => ({ id: a.id, label: a.label }))].map(
              (chip) => {
                const active = area === chip.id;
                return (
                  <li key={chip.id || "all"} className="shrink-0">
                    <button
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
            <p className="mt-2 text-[12.5px] text-gray-500">{areaInfo.definition}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] px-3 py-2 sm:gap-x-6 sm:px-4">
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

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-rose-600 bg-rose-50 p-4">
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      <section className="card p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            {areaInfo ? `입찰공고 · ${areaInfo.label}` : "입찰공고"}
          </h1>
          <p className="text-[12.5px] text-gray-500" aria-live="polite">
            {loading ? "불러오는 중…" : `${items.length.toLocaleString()}건 · ${SORT_LABEL[sort]}`}
          </p>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-gray-500">
          나라장터 공고를 1시간마다 확인해 관련 분야만 모읍니다 · 최종 확인은 원문 공고로
          {data?.lastRun && (
            <> · 마지막 확인 {formatRelative(data.lastRun.ranAt)}</>
          )}
          {data?.lastRun && !data.lastRun.ok && (
            <span className="ml-1 text-rose-700">
              — 경고{data.lastRun.detail ? `: ${data.lastRun.detail}` : ""}
            </span>
          )}
        </p>

        {loading ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-[14px] text-gray-600">조건에 맞는 공고가 없습니다.</p>
            <button
              onClick={() => setParam({ area: null, status: "all", range: "all", q: null })}
              className="mt-3 min-h-[44px] rounded-full bg-gray-100 px-5 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-200"
            >
              조건 넓히기 (전체 기간 · 전체 상태)
            </button>
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

function BidRow({ bid }: { bid: BidItem }) {
  const d = dday(bid.closeDt);
  const money = formatMoney(bid.budgetAmount ?? bid.presmptPrice);

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {bid.areas.map((a) => (
          <span
            key={a}
            className="rounded-md bg-[#FFF4D6] px-1.5 py-0.5 text-[11.5px] font-bold text-[#8A6400]"
          >
            {bidAreaLabel(a)}
          </span>
        ))}
        {bid.workDiv && (
          <span className="text-[11.5px] font-medium text-gray-500">{bid.workDiv}</span>
        )}
        {/* 취소·정정은 응찰 가능 여부를 바꾸므로 제목 앞에서 먼저 읽혀야 한다 */}
        {bid.noticeKind && bid.noticeKind !== "등록공고" && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold ${
              bid.noticeKind.includes("취소")
                ? "bg-rose-100 text-rose-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {bid.noticeKind}
          </span>
        )}
        {d && (
          <span
            className={`text-[11.5px] font-bold ${
              d.urgent ? "text-rose-700" : "text-gray-500"
            }`}
          >
            {d.text}
          </span>
        )}
      </div>

      <h3 className="mt-1.5 text-[16.5px] font-bold leading-snug tracking-tight text-gray-900 sm:text-[18px]">
        {bid.detailUrl ? (
          <a
            href={bid.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="decoration-[#FFB81C] decoration-2 underline-offset-2 hover:underline"
          >
            {bid.title}
          </a>
        ) : (
          bid.title
        )}
      </h3>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-600">
        {bid.demandAgency && (
          <span className="font-medium text-gray-700">{bid.demandAgency}</span>
        )}
        {money && <span>{money}</span>}
        {bid.contractMethod && <span>{bid.contractMethod}</span>}
        {bid.region && <span>{bid.region}</span>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
        <span>공고 {formatDate(bid.noticeDt)}</span>
        <span>마감 {formatDate(bid.closeDt)}</span>
        <span className="tabular-nums">
          공고번호 {bid.bidNo}
          {/* 차수는 API가 '000'/'00' 등 자리수를 섞어 준다. 0이면 최초 공고다. */}
          {Number(bid.bidOrd) > 0 ? `-${bid.bidOrd}` : ""}
        </span>
      </div>

      {bid.matchedTerms.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-gray-400">
          매칭 근거: {bid.matchedTerms.slice(0, 4).join(", ")}
        </p>
      )}
    </li>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11.5px] font-bold tracking-wide text-gray-500">{label}</span>
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
        <div key={i} className="py-5">
          <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
          <div className="mt-2.5 h-5 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-52 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
