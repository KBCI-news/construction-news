"use client";

import { useEffect, useState } from "react";
import type { Indicator } from "@/app/api/indicators/route";

const shortDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
};

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
    <section className="card px-4 py-3" aria-label="경제지표">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold tracking-wide text-gray-600">
          경제지표
        </h2>
        <p className="text-[11px] text-gray-500">기사에서 자동 추출 · 출처 확인 권장</p>
      </div>
      <ul className="flex gap-x-5 gap-y-2 overflow-x-auto pb-1">
        {items.map((it) => (
          <li key={it.key} className="shrink-0">
            <a
              href={it.sourceLink ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
              title={it.sourceHost ? `출처: ${it.sourceHost}` : undefined}
            >
              <p className="text-[11.5px] font-medium text-gray-600 group-hover:text-[#7A5E08]">
                {it.label}
              </p>
              <p className="mt-0.5 whitespace-nowrap">
                <span className="text-[19px] font-extrabold tabular-nums tracking-tight text-gray-900">
                  {it.value}
                </span>
                <span className="ml-0.5 text-[12px] font-bold text-gray-600">
                  {it.unit}
                </span>
                {it.asOf && (
                  <span className="ml-1.5 text-[11px] text-gray-500">
                    {shortDate(it.asOf)}
                  </span>
                )}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
