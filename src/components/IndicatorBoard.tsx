"use client";

import { useEffect, useState } from "react";
import type { Indicator, IndicatorPoint } from "@/app/api/indicators/route";

const shortDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${String(k.getUTCFullYear()).slice(2)}.${k.getUTCMonth() + 1}`;
};

const asOfLabel = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(
    k.getUTCDate(),
  ).padStart(2, "0")} 기준`;
};

/** 추이 차트 — 최소·최대 눈금과 마지막 점을 표시한다 */
function TrendChart({ points }: { points: IndicatorPoint[] }) {
  if (points.length < 2) {
    return <p className="mt-3 text-[12px] text-gray-500">추이 데이터 수집 중</p>;
  }
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const W = 260;
  const H = 72;
  const PAD = 5;

  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (W - PAD * 2) + PAD;
    const y = H - PAD - ((p.value - min) / span) * (H - PAD * 2);
    return { x, y, ...p };
  });
  const line = xy
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${H} L${xy[0].x.toFixed(1)},${H} Z`;
  const last = xy[xy.length - 1];

  return (
    <div className="mt-3">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`최근 ${points.length}개 시점 추이, 최저 ${min}, 최고 ${max}`}
      >
        <path d={area} fill="rgba(255,184,28,0.16)" />
        <path
          d={line}
          fill="none"
          stroke="#B98A10"
          strokeWidth="1.8"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last.x} cy={last.y} r="3" fill="#B98A10" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-gray-500">
        <span>{shortDate(points[0].asOf)}</span>
        <span>
          {min} ~ {max}
        </span>
        <span>{shortDate(points[points.length - 1].asOf)}</span>
      </div>
    </div>
  );
}

function Trend({ points }: { points: IndicatorPoint[] }) {
  if (points.length < 2) return null;
  const last = points[points.length - 1].value;
  const prev = points[points.length - 2].value;
  const diff = Number((last - prev).toFixed(2));
  if (diff === 0) {
    return <span className="text-[12.5px] font-bold text-gray-500">보합</span>;
  }
  const up = diff > 0;
  return (
    <span className={`text-[12.5px] font-bold ${up ? "text-rose-700" : "text-blue-700"}`}>
      {up ? "▲" : "▼"} {Math.abs(diff)}
    </span>
  );
}

/**
 * 경제지표 보드. 값은 한국은행 등 기관 원본 통계나 수집 기사에서 자동으로
 * 채워진다. 확인되지 않은 지표는 표시하지 않는다 — 게시판에 틀린 숫자가
 * 붙는 것이 더 나쁘다.
 */
export function IndicatorBoard() {
  const [items, setItems] = useState<Indicator[] | null>(null);

  useEffect(() => {
    fetch("/api/indicators")
      .then((r) => r.json())
      .then((j) => setItems(j.indicators ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="card p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
            경제지표
          </h1>
          <p className="text-[12px] text-gray-500">자동 수집 · 카드의 출처·기준일 확인</p>
        </div>

        {items === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[176px] animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-gray-600">
            확인된 지표가 아직 없습니다.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <li key={it.key} className="rounded-xl border border-[var(--line)] px-4 py-3.5">
                <p className="flex items-center justify-between gap-1">
                  <span className="text-[13px] font-bold text-gray-700">{it.label}</span>
                  <span
                    className={`rounded px-1.5 py-px text-[10.5px] font-bold ${
                      it.sourceKind === "official"
                        ? "bg-[#FFF4D6] text-[#8A6400]"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {it.sourceLabel}
                  </span>
                </p>
                <p className="mt-1.5 flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="text-[26px] font-extrabold tabular-nums tracking-tight text-gray-900">
                    {it.value}
                  </span>
                  <span className="text-[13px] font-bold text-gray-600">{it.unit}</span>
                  <span className="ml-auto">
                    <Trend points={it.history} />
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-gray-500">
                  {asOfLabel(it.asOf)}
                </p>
                <TrendChart points={it.history} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
