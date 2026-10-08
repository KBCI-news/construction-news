import Link from "next/link";
import { FEEDBACK_FORM_URL, hasFeedbackForm } from "@/lib/feedback";

export const metadata = {
  title: "의견 보내기",
  description: "KBCI 뉴스룸 이용 의견 접수",
};

export default function FeedbackPage() {
  const ready = hasFeedbackForm();

  return (
    <section className="card mx-auto max-w-[560px] px-5 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[22px] font-extrabold leading-snug tracking-tight text-gray-900">
        의견 접수함
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-gray-700">
        뉴스룸 관련 건의사항, 불편사항 등을 하단 설문 링크 통해 남겨주시면 참고하여 개선하도록
        하겠습니다.
      </p>

      <div className="mt-7 flex flex-col gap-2">
        {ready ? (
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-lg btn-lg-kb"
          >
            설문 링크 열기
            <span aria-hidden className="ml-0.5 text-[15px]">
              ↗
            </span>
          </a>
        ) : (
          <button type="button" disabled className="btn-lg btn-lg-gray cursor-not-allowed opacity-70">
            설문 링크 준비 중
          </button>
        )}
        <Link href="/" className="btn-lg btn-lg-gray">
          뉴스로 돌아가기
        </Link>
      </div>
    </section>
  );
}
