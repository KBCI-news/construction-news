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
    <header className="no-print sticky top-0 z-30 border-b border-[var(--line)] bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFB81C] text-[15px] font-extrabold tracking-tight text-gray-900">
              KB
            </div>
            <div className="leading-tight">
              <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900">
                KBCI 뉴스
              </h1>
              <p className="text-[11px] text-gray-400">
                KB신용정보 뉴스 모니터링
              </p>
            </div>
          </Link>
          <span className="hidden items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-bold tracking-wider text-gray-500 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            실시간 수집
          </span>
        </div>

        <nav className="flex gap-1 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(item.href) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative shrink-0 px-3 py-2.5 text-[14px] font-bold tracking-tight transition-colors ${
                  active
                    ? "text-gray-900"
                    : "text-gray-400 hover:text-gray-700"
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
