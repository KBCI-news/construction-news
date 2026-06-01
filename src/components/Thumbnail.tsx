"use client";

import { useState } from "react";

// 원문 og:image를 보여주되, 없거나 로드 실패 시 브랜드 placeholder로 대체한다.
export function Thumbnail({
  src,
  label,
  className,
}: {
  src?: string | null;
  label?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className ?? ""}`}>
      {show ? (
        // 뉴스 원문 이미지는 임의 도메인이라 next/image 대신 일반 img 사용
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
          <span className="px-2 text-center text-[11px] font-bold tracking-widest text-gray-400">
            {label ?? "KBCI"}
          </span>
        </div>
      )}
    </div>
  );
}
