"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="card mx-auto mt-4 max-w-[480px] px-5 py-10 text-center">
      <h1 className="text-[20px] font-extrabold tracking-tight text-gray-900">
        화면을 표시하지 못했습니다
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
        잠시 후 다시 시도해 주세요. 계속되면 뉴스 첫 화면에서 다시 들어와 주세요.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={reset} className="btn-lg btn-lg-kb">
          다시 불러오기
        </button>
        <Link href="/" className="btn-lg btn-lg-gray">
          뉴스 첫 화면으로
        </Link>
      </div>
    </section>
  );
}
