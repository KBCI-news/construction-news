"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClip } from "@/components/ClipProvider";
import { hostOf, stripHtml } from "@/lib/format";
import type { FeedItem } from "@/app/api/feed/route";

// 게시판 부착용 A4 브리핑 조립대.
// 담기 → 순서 조정 → 코멘트 → 인쇄. 최종 산출물(종이 한 장)이 이 화면의 목적이다.

const todayKst = () => {
  const d = new Date(Date.now() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}. ${String(d.getUTCMonth() + 1).padStart(2, "0")}. ${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
};

export default function BriefClient() {
  const { items, remove, move, ready } = useClip();
  const [title, setTitle] = useState("주요 뉴스 브리핑");
  const [editor, setEditor] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, FeedItem>>({});

  // 담은 기사의 요약·출처를 채우기 위해 최근 피드에서 상세를 끌어온다
  useEffect(() => {
    if (!ready || items.length === 0) return;
    const controller = new AbortController();
    fetch("/api/feed?range=30d&limit=200&sort=date", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, FeedItem> = {};
        for (const it of (j.items ?? []) as FeedItem[]) map[it.link] = it;
        setDetails(map);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [ready, items.length]);

  const date = useMemo(todayKst, []);

  if (!ready) return null;

  if (items.length === 0) {
    return (
      <div className="card p-10 text-center">
        <h1 className="text-[20px] font-extrabold text-gray-900">담은 기사가 없습니다</h1>
        <p className="mt-2 text-[14px] text-gray-600">
          뉴스룸에서 게시할 기사를 <strong>담기</strong>로 모은 뒤 이 화면에서 브리핑을
          만드세요.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-5 text-[14px] font-bold text-white"
        >
          뉴스룸으로
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 편집 도구 — 인쇄물에는 나오지 않는다 */}
      <div className="no-print card space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-extrabold tracking-tight text-gray-900">
              브리핑 만들기
            </h1>
            <p className="mt-1 text-[13px] text-gray-600">
              A4 한 장 기준 · 담은 기사 {items.length}건
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-[13px] font-bold text-gray-700"
            >
              기사 더 담기
            </Link>
            <button
              onClick={() => window.print()}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-5 text-[14px] font-bold text-white hover:bg-black"
            >
              인쇄 / PDF 저장
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-bold text-gray-600">제목</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-[15px] font-semibold text-gray-900"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-bold text-gray-600">담당자 (선택)</span>
            <input
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              placeholder="예: 준법지원부 홍길동"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900"
            />
          </label>
        </div>

        <ol className="divide-y divide-gray-200">
          {items.map((a, i) => (
            <li key={a.link} className="flex items-start gap-3 py-3">
              <span className="w-6 shrink-0 pt-2 text-[15px] font-extrabold tabular-nums text-[#7A5E08]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-snug text-gray-900">
                  {a.title}
                </p>
                <p className="mt-0.5 text-[12px] text-gray-600">
                  {a.sourceHost ?? hostOf(a.link)}
                </p>
                <input
                  value={notes[a.link] ?? ""}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [a.link]: e.target.value }))
                  }
                  placeholder="게시용 한 줄 코멘트 (선택) — 왜 중요한지"
                  className="mt-2 min-h-[40px] w-full rounded-lg border border-gray-300 px-2.5 text-[13px] text-gray-900"
                />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => move(a.link, -1)}
                  disabled={i === 0}
                  aria-label={`${a.title} 위로`}
                  className="min-h-[36px] w-9 rounded border border-gray-300 text-gray-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(a.link, 1)}
                  disabled={i === items.length - 1}
                  aria-label={`${a.title} 아래로`}
                  className="min-h-[36px] w-9 rounded border border-gray-300 text-gray-700 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(a.link)}
                  aria-label={`${a.title} 제외`}
                  className="min-h-[36px] w-9 rounded border border-gray-300 text-gray-700"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ===== 인쇄되는 지면 ===== */}
      <div className="sheet card p-6 sm:p-10">
        <header className="sheet-head">
          <p className="text-[11px] font-bold tracking-widest text-[#7A5E08]">
            KBCI NEWS · 사내 게시용
          </p>
          <h2 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-gray-900">
            {title}
          </h2>
          <p className="mt-1.5 text-[12px] text-gray-600">
            {date} 기준 · 총 {items.length}건
            {editor ? ` · 작성 ${editor}` : ""}
          </p>
        </header>

        <ol className="mt-5">
          {items.map((a, i) => {
            const d = details[a.link];
            const summary = d?.description ? stripHtml(d.description) : "";
            const note = (notes[a.link] ?? "").trim();
            return (
              <li key={a.link} className="brief-item">
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-extrabold tabular-nums text-gray-900">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[16.5px] font-bold leading-snug text-gray-900">
                    {a.title}
                  </h3>
                </div>
                {note && (
                  <p className="brief-note mt-1.5 text-[13px] font-semibold text-gray-900">
                    ▸ {note}
                  </p>
                )}
                {summary && (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-700">
                    {summary.slice(0, 180)}
                    {summary.length > 180 ? "…" : ""}
                  </p>
                )}
                <p className="mt-1.5 text-[11.5px] text-gray-600">
                  {a.sourceHost ?? hostOf(a.link)}
                  {d?.reasons?.length
                    ? ` · ${d.reasons.map((r) => r.label).join(" · ")}`
                    : ""}
                </p>
              </li>
            );
          })}
        </ol>

        <footer className="sheet-foot mt-6 text-[11px] text-gray-600">
          KB신용정보 뉴스 모니터링 · 자동 수집·중요도 추정 결과이며 원문 확인이
          필요합니다.
        </footer>
      </div>
    </div>
  );
}
