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
      <div className="flex h-[24px] w-[24px] items-center justify-center rounded-md bg-[#FFB81C] text-[11px] font-extrabold tracking-tight text-gray-900">
        KB
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kb-logo.png"
      alt=""
      width={34}
      height={24}
      className="h-[24px] w-auto"
      onError={() => setFailed(true)}
    />
  );
}

// 'KB의 생각' 로고처럼 마크와 이름을 한 줄 워드마크로 묶는다 — 글자는 한 색(먹색)
// 360px 폰에서 오른쪽 버튼 둘(KB의 생각·의견)과 한 줄에 여유 있게 들어가야 해서 18px, 넓은 화면은 20px
function BrandWordmark() {
  return (
    <span className="whitespace-nowrap text-[18px] font-black leading-none tracking-[-0.02em] text-gray-900 sm:text-[20px]">
      KBCI 뉴스룸
    </span>
  );
}

// 헤더 오른쪽 알약 버튼 공통 모양 — KB의 생각·의견이 같은 버튼으로 보이게.
// 64px 줄 안에서 44px 알약은 꽉 차 보여 40px로 — 줄 자체가 64px라 터치 빗나감은 없다
const PILL =
  "inline-flex min-h-[40px] items-center rounded-full border border-gray-300 px-3.5 text-[13.5px] font-bold text-gray-800 transition-colors hover:border-[#FFB81C] hover:text-[#7A5E08] active:bg-gray-100";

// GNB는 최상위 섹션 셋만 둔다. 뉴스 주제·범위는 뉴스 화면 안의 칩이 담당한다.
const SECTIONS = [
  { href: "/", label: "뉴스" },
  { href: "/indicators", label: "경제지표" },
  { href: "/bids", label: "입찰공고" },
];

export function Header() {
  const pathname = usePathname();

  return (
    // backdrop-blur는 모바일 스크롤 프레임을 깎아 먹는다 — 불투명 배경으로 충분
    // 3px 띠 + 64px 로고 줄(=67px)은 스크롤로 사라지고 GNB 줄만 붙는다 — 전체를 붙이면 폰 화면의 14%를 먹는다
    <header className="no-print sticky top-[-67px] z-30 border-b border-[var(--line)] bg-white shadow-[0_2px_20px_-12px_rgba(16,24,40,0.18)]">
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FFB81C] to-[#FFD37A]" />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex h-[64px] items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2" aria-label="KBCI 뉴스룸 홈">
            <BrandLogo />
            <BrandWordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {/* KB금융 리서치 포털 'KB의 생각' — 외부 사이트라 새 창. 의견과 같은 알약 모양이라 눌리는 버튼으로 읽힌다 */}
            <a
              href="https://kbthink.com/main.html"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="KB의 생각 (새 창)"
              className={`${PILL} text-gray-900`}
            >
              <KbThinkMark className="h-[15px] w-auto" />
            </a>
            {/* 의견 접수는 섹션이 아니라 행동이라 GNB 탭 대신 버튼 — 4번째 탭은 360px에서 탭 글자를 좁힌다.
                말풍선 아이콘은 뺐다 — 옆의 KB의 생각 알약엔 아이콘이 없어 짝이 안 맞고, 360px에서 숨 쉴 폭을 먹는다 */}
            <Link href="/feedback" className={PILL}>
              의견
            </Link>
          </div>
        </div>

        <nav aria-label="주요 섹션" className="grid grid-cols-3 pb-px sm:flex sm:gap-1">
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
                className={`relative flex min-h-[48px] items-center justify-center px-3 text-[15px] font-bold tracking-tight transition-colors active:bg-gray-50 sm:justify-start sm:text-[14px] ${
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
        </nav>
      </div>
    </header>
  );
}
