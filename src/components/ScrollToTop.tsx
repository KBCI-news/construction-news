"use client";

import { useEffect, useState } from "react";

export function ScrollToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // 내려 읽는 동안엔 숨겨 표·숫자를 가리지 않는다 — 위로 되돌아갈 때만 나타난다
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 700) setShow(false);
      else if (y < lastY - 4) setShow(true);
      else if (y > lastY + 4) setShow(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="맨 위로 이동"
      className="no-print fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 shadow-lg active:bg-gray-100"
    >
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.2}
        stroke="currentColor"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    </button>
  );
}
