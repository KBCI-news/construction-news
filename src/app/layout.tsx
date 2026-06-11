import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Header } from "@/components/Header";
import { ScrollToTop } from "@/components/ScrollToTop";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "KBCI 뉴스",
  description: "KB신용정보 사내 뉴스 모니터링",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a href="#main-content" className="skip-link">
          본문 바로가기
        </a>
        <Header />
        <main
          id="main-content"
          className="mx-auto min-h-screen max-w-[1280px] overflow-x-hidden px-4 py-7 sm:px-8 sm:py-10"
        >
          {children}
        </main>
        <ScrollToTop />
      </body>
    </html>
  );
}
