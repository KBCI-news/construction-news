"use client";

import { useEffect, useState } from "react";
import type { Indicator, IndicatorPoint } from "@/app/api/indicators/route";

const shortDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
};

/** 추이를 한 눈에 — 값이 2개 이상일 때만 그린다 */
function Sparkline({ points }: { points: IndicatorPoint[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 56;
  const H = 18;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p.value - min) / span) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="mt-1">
      <path d={d} fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Trend({ points }: { points: IndicatorPoint[] }) {
  if (points.length < 2) return null;
  const last = points[points.length - 1].value;
  const prev = points[points.length - 2].value;
  const diff = Number((last - prev).toFixed(2));
  if (diff === 0) {
    return <span className="text-[11.5px] font-bold text-gray-500">보합</span>;
  }
  const up = diff > 0;
  return (
    <span
      className={`text-[11.5px] font-bold ${up ? "text-rose-700" : "text-blue-700"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(diff)}
    </span>
  );
}

/**
 * 경제지표 스트립. 값은 수집된 기사에서 자동 추출되며 출처 기사로 바로 이동할 수 있다.
 * 확인되지 않은 지표는 표시하지 않는다 — 게시판에 틀린 숫자가 붙는 것이 더 나쁘다.
 */
export function IndicatorStrip() {
  const [items, setItems] = useState<Indicator[]>([]);

  useEffect(() => {
    fetch("/api/indicators")
      .then((r) => r.json())
      .then((j) => setItems(j.indicators ?? []))
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="card px-3 py-3 sm:px-4" aria-label="경제지표">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold tracking-wide text-gray-600">경제지표</h2>
        <p className="text-[11px] text-gray-500">기사 자동 추출 · 출처 확인 권장</p>
      </div>
      {/* 모바일에서는 가로 스크롤, 넓은 화면에서는 한 줄에 펼친다 */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <li key={it.key} className="shrink-0">
            <a
              href={it.sourceLink ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-w-[124px] rounded-xl border border-[var(--line)] px-3 py-2 transition-colors hover:border-[#FFB81C]"
              title={it.sourceHost ? `출처: ${it.sourceHost}` : undefined}
            >
              <p className="text-[11.5px] font-medium text-gray-600">{it.label}</p>
              <p className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
                <span className="text-[19px] font-extrabold tabular-nums tracking-tight text-gray-900">
                  {it.value}
                </span>
                <span className="text-[12px] font-bold text-gray-600">{it.unit}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5">
                <Trend points={it.history} />
                {it.asOf && (
                  <span className="text-[11px] text-gray-500">{shortDate(it.asOf)}</span>
                )}
              </p>
              <Sparkline points={it.history} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
