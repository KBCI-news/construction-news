"use client";

import { useState } from "react";

// 원문 og:image가 실제로 있고 불러와질 때만 보여준다 — 없으면 아무것도 그리지 않는다.
export function Thumbnail({
  src,
  className,
}: {
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // 이미지가 없거나 깨지면 자리를 비운다 — 회색 대체 상자는 정보 없이 제목만 3줄로 밀어냈다
  if (!src || failed) return null;

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className ?? ""}`}>
      {/* 뉴스 원문 이미지는 임의 도메인이라 next/image 대신 일반 img 사용 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        // 언론사 이미지 서버 다수가 외부 사이트 Referer를 막는다(핫링크 차단) — 보내지 않으면 통과한다
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    </div>
  );
}
