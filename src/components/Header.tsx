"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// public/kb-logo.png가 있으면 그 로고를, 없으면 KB 옐로우 타일로 폴백
function BrandLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-[#FFB81C] text-[15px] font-extrabold tracking-tight text-gray-900">
        KB
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kb-logo.png"
      alt=""
      width={48}
      height={34}
      className="h-[34px] w-auto"
      onError={() => setFailed(true)}
    />
  );
}

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
    // 3px 띠 + 56px 로고 줄(=59px)은 스크롤로 사라지고 GNB 줄만 붙는다 — 112px 전체를 붙이면 폰 화면의 13%를 먹는다
    <header className="no-print sticky top-[-59px] z-30 border-b border-[var(--line)] bg-white shadow-[0_2px_20px_-12px_rgba(16,24,40,0.18)]">
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FFB81C] to-[#FFD37A]" />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex h-[56px] items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLogo />
            <div className="leading-tight">
              <p className="text-[17px] font-extrabold tracking-tight text-gray-900">
                KBCI 뉴스룸
              </p>
              <p className="text-[12px] text-gray-600">
                KB신용정보 뉴스 모니터링
              </p>
            </div>
          </Link>
          {/* 의견 접수는 섹션이 아니라 행동이라 GNB 탭 대신 버튼 — 4번째 탭은 360px에서 탭 글자를 좁힌다 */}
          <Link
            href="/feedback"
            className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-gray-300 px-3.5 text-[13.5px] font-bold text-gray-800 transition-colors hover:border-[#FFB81C] hover:text-[#7A5E08] active:bg-gray-100"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
            의견 보내기
          </Link>
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
