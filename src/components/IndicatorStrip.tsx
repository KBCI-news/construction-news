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

/** 추이 차트 — 최소·최대 눈금과 마지막 점을 표시한다 */
function TrendChart({ points }: { points: IndicatorPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="mt-2 text-[11px] text-gray-500">추이 데이터 수집 중</p>
    );
  }
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const W = 150;
  const H = 44;
  const PAD = 4;

  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (W - PAD * 2) + PAD;
    const y = H - PAD - ((p.value - min) / span) * (H - PAD * 2);
    return { x, y, ...p };
  });
  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${H} L${xy[0].x.toFixed(1)},${H} Z`;
  const last = xy[xy.length - 1];

  return (
    <div className="mt-2">
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
          strokeWidth="1.6"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last.x} cy={last.y} r="2.6" fill="#B98A10" />
      </svg>
      <div className="mt-0.5 flex justify-between text-[10.5px] tabular-nums text-gray-500">
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
    return <span className="text-[11.5px] font-bold text-gray-500">보합</span>;
  }
  const up = diff > 0;
  return (
    <span className={`text-[11.5px] font-bold ${up ? "text-rose-700" : "text-blue-700"}`}>
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
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <li key={it.key} className="shrink-0">
            <a
              href={it.sourceLink ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-[172px] rounded-xl border border-[var(--line)] px-3 py-2.5 transition-colors hover:border-[#FFB81C]"
              title={it.sourceHost ? `출처: ${it.sourceHost}` : undefined}
            >
              <p className="text-[11.5px] font-medium text-gray-600">{it.label}</p>
              <p className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
                <span className="text-[21px] font-extrabold tabular-nums tracking-tight text-gray-900">
                  {it.value}
                </span>
                <span className="text-[12px] font-bold text-gray-600">{it.unit}</span>
                <span className="ml-auto">
                  <Trend points={it.history} />
                </span>
              </p>
              <TrendChart points={it.history} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
