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
      <p className="text-[13px] font-bold tracking-wide text-[#7A5E08]">의견 접수함</p>
      <h1 className="mt-1.5 text-[22px] font-extrabold leading-snug tracking-tight text-gray-900">
        뉴스룸, 쓰시면서 불편한 점이 있으셨나요?
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-gray-700">
        보고 싶은 뉴스 주제나 지표, 잘못 들어온 기사, 화면에서 불편했던 점 — 무엇이든 좋습니다.
        보내주신 의견은 모아서 순서대로 반영하고, 반영 결과는 뉴스룸 안내문으로 알려 드립니다.
      </p>

      <ul className="mt-5 space-y-2 text-[14.5px] text-gray-700">
        <li className="flex gap-2">
          <span className="shrink-0 font-bold text-[#7A5E08]">·</span>
          <span>작성에 1분이면 충분합니다. 이름을 적지 않아도 됩니다.</span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-bold text-[#7A5E08]">·</span>
          <span>네이버폼으로 연결됩니다. 로그인 없이 바로 작성할 수 있습니다.</span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-bold text-[#7A5E08]">·</span>
          <span>급한 오류는 담당자에게 직접 알려 주셔도 됩니다.</span>
        </li>
      </ul>

      <div className="mt-7 flex flex-col gap-2">
        {ready ? (
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-lg btn-lg-kb"
          >
            의견 보내기 (설문 열기)
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
