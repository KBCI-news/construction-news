"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// public/kb-logo.png가 있으면 그 로고를, 없으면 KB 옐로우 타일로 폴백
function BrandLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFB81C] text-[15px] font-extrabold tracking-tight text-gray-900">
        KB
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kb-logo.png"
      alt="KB"
      className="h-9 w-auto"
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
    <header className="no-print sticky top-0 z-30 border-b border-[var(--line)] bg-white/90 shadow-[0_2px_20px_-12px_rgba(16,24,40,0.18)] backdrop-blur-md">
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FFB81C] to-[#FFD37A]" />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLogo />
            <div className="leading-tight">
              <p className="text-[17px] font-extrabold tracking-tight text-gray-900">
                KBCI 뉴스룸
              </p>
              <p className="text-[11px] text-gray-600">
                KB신용정보 뉴스 모니터링
              </p>
            </div>
          </Link>
          <Link
            href="/brief"
            className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 px-3 text-[13px] font-bold text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#7A5E08]"
          >
            🖨 브리핑
          </Link>
        </div>

        <nav aria-label="주요 섹션" className="flex gap-1 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 px-3 py-2.5 text-[14px] font-bold tracking-tight transition-colors ${
                  active ? "text-gray-900" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-2.5 -bottom-px h-[3px] rounded-full bg-[#FFB81C]" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
