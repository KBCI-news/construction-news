import { Suspense } from "react";
import PrintClient from "@/components/PrintClient";

export const metadata = {
  title: "기사 출력 - KBCI 뉴스",
};

export default function PrintPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-sm text-gray-500">
          불러오는 중...
        </div>
      }
    >
      <PrintClient />
    </Suspense>
  );
}
