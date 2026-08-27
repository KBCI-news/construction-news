"use client";

import { useEffect, useRef, useState } from "react";
import type { Indicator, IndicatorPoint } from "@/app/api/indicators/route";

// ---------------------------------------------------------------------------
// 값·날짜 표기
// ---------------------------------------------------------------------------

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000);

const fmtValue = (v: number): string =>
  Math.abs(v) >= 1000
    ? Math.round(v).toLocaleString("ko-KR")
    : String(Number(v.toFixed(2)));

/** 축·툴팁용 날짜 — 월 단위 계열은 yy.M, 일 단위 계열은 M/D */
const fmtTime = (iso: string, daily: boolean): string => {
  const k = kst(iso);
  return daily
    ? `${k.getUTCMonth() + 1}/${k.getUTCDate()}`
    : `${String(k.getUTCFullYear()).slice(2)}.${k.getUTCMonth() + 1}`;
};

const asOfLabel = (iso: string | null): string => {
  if (!iso) return "";
  const k = kst(iso);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(
    k.getUTCDate(),
  ).padStart(2, "0")} 기준`;
};

/** 보기 좋은 눈금 간격 (1·2·2.5·5 × 10^n) */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

// ---------------------------------------------------------------------------
// 추이 차트 — 격자·눈금·끝점 라벨·호버 십자선을 갖춘 소형 라인 차트
// ---------------------------------------------------------------------------

const W = 300;
const H = 116;
const PAD_L = 8;
const PAD_R = 14; // 끝점 도트·라벨 여유
const PAD_T = 18; // 끝점 값 라벨 여유
const PAD_B = 6;

function TrendChart({ points, unit }: { points: IndicatorPoint[]; unit: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <p className="mt-3 text-[12px] text-gray-500">추이 데이터 수집 중</p>;
  }

  const vals = points.map((p) => p.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  // 도메인을 살짝 벌려 선이 위아래에 붙지 않게 한다. 변동이 없으면 값 크기 기준.
  const padV = (rawMax - rawMin || Math.abs(rawMax) * 0.06 || 1) * 0.12;
  const min = rawMin - padV;
  const max = rawMax + padV;

  // 격자: 도메인 안의 "깔끔한 수" 2~3개 — 좁은 도메인에서 1개로 줄면 간격을 반으로
  let step = niceStep((max - min) / 3);
  let ticks: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
      ticks.push(Number(t.toFixed(6)));
    }
    if (ticks.length >= 2) break;
    step /= 2;
  }

  const x = (i: number) => (i / (points.length - 1)) * (W - PAD_L - PAD_R) + PAD_L;
  const y = (v: number) => H - PAD_B - ((v - min) / (max - min)) * (H - PAD_T - PAD_B);

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD_B} L${x(0).toFixed(1)},${H - PAD_B} Z`;

  const lastI = points.length - 1;
  const last = points[lastI];
  // 계열 주기 추정 — 축·툴팁 날짜 표기에 쓴다
  const daily =
    (new Date(last.asOf).getTime() - new Date(points[0].asOf).getTime()) /
      (points.length - 1) <
    5 * 86_400_000;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - PAD_L) / (W - PAD_L - PAD_R)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hv = hover !== null ? points[hover] : null;
  // 끝점 값 라벨이 오른쪽 밖으로 나가지 않게 안쪽 정렬
  const lastLabelX = Math.min(x(lastI), W - 6);

  return (
    <div className="relative mt-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-none select-none"
        role="img"
        aria-label={`최근 ${points.length}개 시점 추이, 최저 ${fmtValue(rawMin)}, 최고 ${fmtValue(rawMax)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 격자 — 표면에서 한 단계만 어두운 헤어라인 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - 4}
              y1={y(t)}
              y2={y(t)}
              stroke="#EEF0F3"
              strokeWidth="1"
            />
            <text
              x={PAD_L}
              y={y(t) - 3}
              fontSize="9.5"
              fill="#9CA3AF"
              className="tabular-nums"
            >
              {fmtValue(t)}
            </text>
          </g>
        ))}

        {/* 면은 옅은 물감, 선은 2px */}
        <path d={area} fill="rgba(185,138,16,0.10)" />
        <path
          d={line}
          fill="none"
          stroke="#B98A10"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 호버 십자선 + 점 */}
        {hover !== null && hv && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T - 6}
              y2={H - PAD_B}
              stroke="#D1D5DB"
              strokeWidth="1"
            />
            <circle cx={x(hover)} cy={y(hv.value)} r="4.5" fill="#fff" />
            <circle cx={x(hover)} cy={y(hv.value)} r="3" fill="#B98A10" />
          </g>
        )}

        {/* 끝점 — 흰 링을 두른 도트와 직접 라벨 (이 계열의 헤드라인 값) */}
        <circle cx={x(lastI)} cy={y(last.value)} r="5.5" fill="#fff" />
        <circle cx={x(lastI)} cy={y(last.value)} r="3.5" fill="#B98A10" />
        <text
          x={lastLabelX}
          y={Math.max(10, y(last.value) - 9)}
          fontSize="11"
          fontWeight="700"
          fill="#374151"
          textAnchor="end"
          className="tabular-nums"
        >
          {fmtValue(last.value)}
        </text>
      </svg>

      {/* 호버 툴팁 — 값이 먼저, 시점이 다음 */}
      {hover !== null && hv && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-bold tabular-nums text-white shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          {fmtValue(hv.value)}
          {unit ?? ""}
          <span className="ml-1.5 font-medium text-gray-300">{fmtTime(hv.asOf, daily)}</span>
        </div>
      )}

      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-gray-400">
        <span>{fmtTime(points[0].asOf, daily)}</span>
        <span>{fmtTime(points[Math.floor(points.length / 2)].asOf, daily)}</span>
        <span>{fmtTime(last.asOf, daily)}</span>
      </div>
    </div>
  );
}

function Trend({ points, unit }: { points: IndicatorPoint[]; unit: string | null }) {
  if (points.length < 2) return null;
  const last = points[points.length - 1].value;
  const prev = points[points.length - 2].value;
  const diff = Number((last - prev).toFixed(2));
  if (diff === 0) {
    return <span className="text-[12.5px] font-bold text-gray-500">보합</span>;
  }
  const up = diff > 0;
  return (
    <span
      className={`text-[12.5px] font-bold tabular-nums ${up ? "text-rose-700" : "text-blue-700"}`}
      title={`직전 대비 ${up ? "+" : "-"}${fmtValue(Math.abs(diff))}${unit ?? ""}`}
    >
      {up ? "▲" : "▼"} {fmtValue(Math.abs(diff))}
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
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[210px] animate-pulse rounded-xl bg-gray-100" />
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
                  <span className="text-[26px] font-extrabold tracking-tight text-gray-900">
                    {it.value}
                  </span>
                  <span className="text-[13px] font-bold text-gray-600">{it.unit}</span>
                  <span className="ml-auto">
                    <Trend points={it.history} unit={it.unit} />
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-gray-500">
                  {asOfLabel(it.asOf)}
                </p>
                <TrendChart points={it.history} unit={it.unit} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
