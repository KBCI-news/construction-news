import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/Header";
import { ScrollToTop } from "@/components/ScrollToTop";

export const metadata: Metadata = {
  title: { default: "KBCI 뉴스룸", template: "%s | KBCI 뉴스룸" },
  description: "KB신용정보 사내 뉴스 모니터링",
  robots: { index: false, follow: false },
  // 언론사 이미지 서버 다수가 외부 Referer를 막는다(핫링크 차단) — 썸네일·리더 본문 이미지 모두.
  // 사내 도구라 원문 링크로 나갈 때 출처를 넘길 이유도 없다.
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <a href="#main-content" className="skip-link">
          본문 바로가기
        </a>
        <Suspense fallback={null}>
          <Header />
        </Suspense>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-h-screen max-w-[1280px] overflow-x-hidden px-3 py-4 pb-16 focus:outline-none sm:px-8 sm:py-9"
        >
          {children}
        </main>
        <ScrollToTop />
      </body>
    </html>
  );
}
