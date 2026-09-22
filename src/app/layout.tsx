import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/Header";
import { ScrollToTop } from "@/components/ScrollToTop";

export const metadata: Metadata = {
  title: "KBCI 뉴스룸",
  description: "KB신용정보 사내 뉴스 모니터링",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
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
          className="mx-auto min-h-screen max-w-[1280px] overflow-x-hidden px-3 py-4 pb-16 sm:px-8 sm:py-9"
        >
          {children}
        </main>
        <ScrollToTop />
      </body>
    </html>
  );
}
