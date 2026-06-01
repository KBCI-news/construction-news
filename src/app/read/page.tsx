import { Suspense } from "react";
import ReadClient from "@/components/ReadClient";

export const metadata = {
  title: "기사 읽기 - KBCI 뉴스",
};

export default function ReadPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-sm text-gray-500">
          불러오는 중...
        </div>
      }
    >
      <ReadClient />
    </Suspense>
  );
}
