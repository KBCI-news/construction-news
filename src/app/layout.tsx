import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/Header";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ClipProvider } from "@/components/ClipProvider";

export const metadata: Metadata = {
  title: "KBCI 뉴스룸",
  description: "KB신용정보 사내 뉴스 모니터링 · 게시용 브리핑",
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
        <ClipProvider>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <main
            id="main-content"
            className="mx-auto min-h-screen max-w-[1280px] overflow-x-hidden px-4 py-6 pb-24 sm:px-8 sm:py-9"
          >
            {children}
          </main>
          <ScrollToTop />
        </ClipProvider>
      </body>
    </html>
  );
}
