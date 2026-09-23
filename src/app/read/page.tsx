import { Suspense } from "react";
import ReadClient from "@/components/ReadClient";

export const metadata = {
  title: "기사 읽기",
};

export default function ReadPage() {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          className="-mx-3 -mt-4 bg-white px-4 pb-10 pt-4 sm:mx-auto sm:mt-0 sm:max-w-[760px] sm:rounded-[18px] sm:border sm:border-[var(--line)] sm:px-8 sm:py-8"
        >
          <p className="sr-only">불러오는 중…</p>
          <div className="h-11 w-full animate-pulse rounded-xl bg-gray-100" />
          <div className="mt-2 h-11 w-full animate-pulse rounded-xl bg-gray-100" />
          <div className="mt-6 space-y-3">
            <div className="h-8 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="h-8 w-1/2 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="mt-8 space-y-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-200" />
            ))}
          </div>
        </div>
      }
    >
      <ReadClient />
    </Suspense>
  );
}
