"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KbThinkMark } from "./KbThinkMark";

// public/kb-logo.png(KB 별 마크)가 있으면 그 로고를, 없으면 KB 옐로우 타일로 폴백
function BrandLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#FFB81C] text-[12px] font-extrabold tracking-tight text-gray-900">
        KB
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kb-logo.png"
      alt=""
      width={36}
      height={26}
      className="h-[26px] w-auto"
      onError={() => setFailed(true)}
    />
  );
}

// 'KB의 생각' 로고처럼 마크와 이름을 한 줄 워드마크로 묶는다 — 글자는 한 색(먹색)
function BrandWordmark() {
  return (
    <span className="whitespace-nowrap text-[20px] font-black leading-none tracking-[-0.02em] text-gray-900 sm:text-[21px]">
      KBCI 뉴스룸
    </span>
  );
}

function BubbleIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  );
}

// 새 창으로 나가는 링크 표시(↗) — 탭 글자와 같은 먹색이라 눈에 띈다
function ExternalIcon() {
  return (
    <svg className="h-[14px] w-[14px] shrink-0 text-gray-900" fill="none" viewBox="0 0 24 24" strokeWidth={2.8} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

// GNB는 최상위 섹션 셋 + 'KB의 생각'(외부). 뉴스 주제·범위는 뉴스 화면 안의 칩이 담당한다.
const SECTIONS = [
  { href: "/", label: "뉴스" },
  { href: "/indicators", label: "경제지표" },
  { href: "/bids", label: "입찰공고" },
];

export function Header() {
  const pathname = usePathname();

  return (
    // backdrop-blur는 모바일 스크롤 프레임을 깎아 먹는다 — 불투명 배경으로 충분
    // 3px 띠 + 64px 브랜드 줄(=67px)은 스크롤로 사라지고 GNB 줄만 붙는다 — 전체를 붙이면 폰 화면의 14%를 먹는다
    <header className="no-print sticky top-[-67px] z-30 border-b border-[var(--line)] bg-white shadow-[0_2px_20px_-12px_rgba(16,24,40,0.18)]">
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FFB81C] to-[#FFD37A]" />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex h-[64px] items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2" aria-label="KBCI 뉴스룸 홈">
            <BrandLogo />
            <BrandWordmark />
          </Link>
          {/* 의견 접수는 섹션이 아니라 행동이라 GNB 탭 대신 버튼 */}
          <Link
            href="/feedback"
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border border-gray-300 px-3.5 text-[13.5px] font-bold text-gray-800 transition-colors hover:border-[#FFB81C] hover:text-[#7A5E08] active:bg-gray-100"
          >
            <BubbleIcon />
            의견
          </Link>
        </div>

        {/* 폰에서는 네 칸 균등 그리드 — KB의 생각도 탭과 같은 폭. 넓은 화면은 탭을 왼쪽에, KB의 생각을 오른쪽 끝에 */}
        <nav aria-label="주요 섹션" className="grid grid-cols-4 pb-px sm:flex sm:gap-1">
          {SECTIONS.map((item) => {
            // 기사 읽기는 뉴스의 하위 화면
            const active =
              item.href === "/"
                ? pathname === "/" || pathname.startsWith("/read")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[48px] items-center justify-center px-2 text-[15px] font-bold tracking-tight transition-colors active:bg-gray-50 sm:justify-start sm:px-3 sm:text-[14px] ${
                  active ? "text-gray-900" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-4 -bottom-px h-[3px] rounded-full bg-[#FFB81C] sm:inset-x-2.5" />
                )}
              </Link>
            );
          })}
          {/* KB금융 리서치 포털 'KB의 생각' — 외부 사이트라 새 창. 마크 높이는 탭 글자(15px)와 비슷하게 */}
          <a
            href="https://kbthink.com/main.html"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="KB의 생각 (새 창)"
            className="flex min-h-[48px] items-center justify-center gap-0.5 px-0 text-gray-900 transition-opacity hover:opacity-70 active:bg-gray-50 sm:ml-auto sm:px-3"
          >
            {/* 360px 폰의 칸(82px)에 마크 폭(63.6px)+화살표가 꽉 차므로 shrink-0 — 줄어들면 마크가 작아지고 중심도 어긋난다.
                마크 박스는 '생' 위의 점까지 포함해 글자 본체가 박스 중심보다 아래 — 2px 올려 탭 글자와 중심을 맞춘다 */}
            <KbThinkMark className="relative -top-[2px] h-[20px] w-auto shrink-0 max-[339px]:h-[17px]" />
            <ExternalIcon />
          </a>
        </nav>
      </div>
    </header>
  );
}
