import Link from "next/link";

export const metadata = { title: "페이지를 찾을 수 없습니다" };

export default function NotFound() {
  return (
    <section className="card mx-auto mt-4 max-w-[480px] px-5 py-10 text-center">
      <p className="text-[13px] font-bold text-[#7A5E08]">404</p>
      <h1 className="mt-2 text-[20px] font-extrabold tracking-tight text-gray-900">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
        주소가 바뀌었거나 없어진 화면입니다.
        <br />
        즐겨찾기로 들어오셨다면 아래에서 다시 찾아 저장해 주세요.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/" className="btn-lg btn-lg-kb">
          뉴스 첫 화면으로
        </Link>
        <Link href="/indicators" className="btn-lg btn-lg-gray">
          경제지표
        </Link>
        <Link href="/bids" className="btn-lg btn-lg-gray">
          입찰공고
        </Link>
      </div>
    </section>
  );
}
