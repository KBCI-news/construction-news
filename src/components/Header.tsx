"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";

export function Header() {
  const pathname = usePathname();
  const navItems = [
    { href: "/", label: "전체" },
    ...CATEGORIES.map((c) => ({
      href: `/category/${c.id}`,
      label: c.label,
    })),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/95 backdrop-blur-md">
      <div className="h-0.5 w-full bg-[#FFB81C]" />
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3.5 sm:px-8 sm:py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFB81C] text-base font-extrabold tracking-tight text-gray-900">
            KB
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
              KBCI 뉴스
            </h1>
            <p className="text-[12px] text-gray-500 sm:text-[13px]">
              KB신용정보 사내 뉴스 모니터링
            </p>
          </div>
        </Link>
      </div>
      <div className="border-t border-gray-100">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-2">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href) ?? false;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative shrink-0 px-3 py-3 text-[15px] font-medium transition-colors sm:px-4 ${
                    active
                      ? "text-gray-900"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 bg-[#FFB81C] sm:inset-x-4" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
