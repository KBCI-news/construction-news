"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 횡스크롤 래퍼 — 더 볼 내용이 있으면 가장자리 페이드 + 화살표를 띄운다.
 * 스크롤바를 숨긴 가로 목록은 "옆으로 넘길 수 있다"는 사실 자체가 보이지
 * 않는다. 화살표는 힌트이자 버튼이다(누르면 한 화면씩 넘어간다) —
 * 스와이프가 익숙하지 않은 사용자를 위해.
 */
export function HScroll({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  // 내용이 비동기로 채워지는 경우(지표 fetch)를 위해 매 렌더 후에도 갱신
  useEffect(update);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {canLeft && (
        <button
          type="button"
          aria-label="왼쪽으로 넘기기"
          onClick={() => nudge(-1)}
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-start bg-gradient-to-r from-white via-white/85 to-transparent"
        >
          <span className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-[15px] font-bold text-gray-600 shadow-sm">
            ‹
          </span>
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="오른쪽으로 넘기기"
          onClick={() => nudge(1)}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-white via-white/85 to-transparent"
        >
          <span className="mr-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-[15px] font-bold text-gray-600 shadow-sm">
            ›
          </span>
        </button>
      )}
    </div>
  );
}
