"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArticleContent } from "@/app/api/article/route";
import type { FeedItem } from "@/app/api/feed/route";
import { tagLabelOf } from "@/lib/lexicon";
import { formatDateTime, formatRelative, hostOf, stripHtml } from "@/lib/format";
import { readReaderMeta } from "@/lib/links";

// 글자 크기는 정해진 단계로만 — 누를 때마다 눈에 띄게 달라지고, 끝 단계에서 버튼이 잠긴다
const STEPS = [0.85, 1, 1.15, 1.3, 1.45, 1.6];
const nearest = (s: number) =>
  STEPS.reduce((b, v, i) => (Math.abs(v - s) < Math.abs(STEPS[b] - s) ? i : b), 0);

const IconChevronLeft = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
  </svg>
);

const IconExternal = () => (
  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
    />
  </svg>
);

const IconShare = () => (
  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
    />
  </svg>
);

const IconPrinter = () => (
  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z"
    />
  </svg>
);

const metaItem =
  "before:inline-block before:w-[18px] before:text-center before:font-normal before:text-gray-300 before:content-['·']";

const toolBtn =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-gray-100 text-[14px] font-bold text-gray-800 active:bg-gray-200";

export default function ReadClient() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url") ?? "";

  const [article, setArticle] = useState<ArticleContent | null>(null);
  const [meta, setMeta] = useState<FeedItem | null>(null);
  const [pill, setPill] = useState<string | undefined>();
  const [cameFromList, setCameFromList] = useState(false);
  const [loading, setLoading] = useState(true);
  const [leadFailed, setLeadFailed] = useState(false);

  const [fontScale, setFontScale] = useState(1);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 글자 크기 설정 복원 (고령 사용자 가독성) — 예전 0.1 단위 값은 가까운 단계로 맞춘다
  useEffect(() => {
    try {
      const s = Number(localStorage.getItem("reader-font-scale"));
      if (s >= 0.85 && s <= 1.6) setFontScale(STEPS[nearest(s)]);
    } catch {
      /* 저장소 차단 — 기본 크기 */
    }
  }, []);

  const idx = nearest(fontScale);
  const atMin = idx === 0;
  const atMax = idx === STEPS.length - 1;
  const changeScale = (dir: 1 | -1) => {
    const n = STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + dir))];
    setFontScale(n);
    try {
      localStorage.setItem("reader-font-scale", String(n));
    } catch {
      /* 저장 차단 — 이번 화면에만 적용 */
    }
  };

  // 읽기 진행률
  useEffect(() => {
    const onScroll = () => {
      const el = bodyRef.current;
      if (!el) return setProgress(0);
      const seen = window.scrollY + window.innerHeight - el.offsetTop;
      setProgress(Math.max(0, Math.min(1, seen / el.offsetHeight)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [article]);

  // 모바일이면 OS 공유 시트를, 데스크톱이면 링크 복사를 — 이름은 하나로 "공유"
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 사용자가 공유 시트를 닫은 경우 등 — 무시 */
    }
  };

  // 링크로 바로 들어온 경우 back은 사이트 밖으로 나간다
  const goBack = () =>
    cameFromList && window.history.length > 1 ? router.back() : router.push("/");

  const readMinutes = useMemo(() => {
    const text = article?.contentHtml
      ? stripHtml(article.contentHtml)
      : (meta?.description ?? "");
    const chars = text.replace(/\s/g, "").length;
    return Math.max(1, Math.round(chars / 500));
  }, [article, meta]);

  // 목록을 내려 둔 채 기사를 누르면 로딩 화면이 짧아 Next가 맨 위로 올리지 않고,
  // 본문이 붙으면 브라우저가 목록의 스크롤 위치를 되살려 기사 중간에서 열린다 — 새 기사는 맨 위에서 시작한다
  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
  }, [url]);

  useEffect(() => {
    setLeadFailed(false);
    if (!url) {
      setLoading(false);
      return;
    }
    const stashed = readReaderMeta(url);
    setCameFromList(Boolean(stashed));
    const controller = new AbortController();
    setLoading(true);
    setArticle(null);
    setMeta(stashed?.item ?? null);
    setPill(stashed?.pill);

    (async () => {
      // 1) 메타데이터(태그/날짜/원문링크) — 목록에서 누른 행이 있으면 그대로 쓰고,
      //    링크로 바로 들어온 경우에만 최근 목록에서 찾는다
      let found: FeedItem | null = stashed?.item ?? null;
      if (!stashed) {
        const items = await fetch("/api/feed?range=30d&limit=200&sort=date", { signal: controller.signal })
          .then((r) => r.json())
          .then((j) => (j.items ?? []) as FeedItem[])
          .catch(() => [] as FeedItem[]);
        if (controller.signal.aborted) return;
        found = items.find((it) => it.link === url) ?? null;
        setMeta(found);
      }

      // 2) 본문 추출 — 실패 시 원문(언론사) 링크로 재시도
      const qs = new URLSearchParams({ url });
      if (found?.originallink && found.originallink !== url) {
        qs.set("fallback", found.originallink);
      }
      const art = await fetch(`/api/article?${qs.toString()}`, {
        signal: controller.signal,
      })
        .then((r) => r.json() as Promise<ArticleContent>)
        .catch(() => null);
      if (controller.signal.aborted) return;
      setArticle(art);
    })().finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [url]);

  const title = useMemo(() => {
    const t = article?.title || meta?.title || "";
    return stripHtml(t);
  }, [article, meta]);

  // 크롬은 저장하는 PDF 파일 이름을 문서 제목으로 짓는다
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    const mine = `${title} | KBCI 뉴스룸`;
    document.title = mine;
    // 떠날 때 다음 화면이 이미 제목을 바꿨으면 건드리지 않는다
    return () => {
      if (document.title === mine) document.title = prev;
    };
  }, [title]);

  const pillText = pill ?? (meta ? tagLabelOf(meta) : undefined);
  const source = meta?.sourceHost ?? article?.host ?? (url ? hostOf(url) : "");
  const leadImage = article?.leadImage || meta?.imageUrl || null;
  const hasBody = Boolean(article?.ok && article.contentHtml);

  if (!url) {
    return (
      <section className="card mx-auto mt-4 max-w-[480px] px-5 py-10 text-center">
        <h1 className="text-[20px] font-extrabold tracking-tight text-gray-900">기사 주소가 없습니다</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
          뉴스 목록에서 기사를 눌러 들어와 주세요.
        </p>
        <Link href="/" className="btn-lg btn-lg-kb mt-6 w-full">
          뉴스 첫 화면으로
        </Link>
      </section>
    );
  }

  const sourceLine = (
    <p className="mt-6 hidden break-all border-t border-gray-300 pt-2 text-[9pt] text-gray-600 print:block">
      원문 {article?.url ?? url}
    </p>
  );

  return (
    <article
      style={{ "--reader-scale": fontScale } as React.CSSProperties}
      className="-mx-3 -mt-4 bg-white px-4 pb-10 pt-4 sm:mx-auto sm:mt-0 sm:max-w-[760px] sm:rounded-[18px] sm:border sm:border-[var(--line)] sm:px-8 sm:py-8 sm:shadow-sm print:m-0 print:border-0 print:p-0 print:shadow-none"
    >
      {/* 읽기 진행바 — 회색 트랙 위 노란 채움이라 헤더의 노란 띠 위에서도 보인다. 따라갈 본문이 있을 때만 */}
      {hasBody && (
        <div aria-hidden className="no-print fixed inset-x-0 top-0 z-50 h-[3px] bg-gray-200">
          <div
            className="h-full bg-[#FFB81C] transition-[width] duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {/* 상단 도구 (인쇄 시 숨김) */}
      <div className="no-print mb-6 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={goBack}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[15px] font-bold text-gray-800 active:bg-gray-100"
          >
            <IconChevronLeft />
            목록으로
          </button>
          <div role="group" aria-label="글자 크기" className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-gray-600">글자 크기</span>
            <div className="seg-group">
              <button
                type="button"
                onClick={() => changeScale(-1)}
                disabled={atMin}
                aria-label="글자 작게"
                className="seg px-3 text-[14px] text-gray-800 enabled:active:bg-white disabled:text-gray-300"
              >
                가−
              </button>
              <button
                type="button"
                onClick={() => changeScale(1)}
                disabled={atMax}
                aria-label="글자 크게"
                className="seg px-3 text-[17px] text-gray-800 enabled:active:bg-white disabled:text-gray-300"
              >
                가+
              </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={share} className={toolBtn}>
            <IconShare />
            공유
          </button>
          <button type="button" onClick={() => window.print()} className={toolBtn}>
            <IconPrinter />
            인쇄·PDF
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className={toolBtn}>
            <IconExternal />
            원문 보기
          </a>
        </div>
      </div>

      {/* 헤더 */}
      <header className="border-b border-gray-200 pb-5">
        {pillText && (
          <p className="mb-2.5">
            <span className="pill-tag">{pillText}</span>
          </p>
        )}
        {loading && !title ? (
          <div className="space-y-3">
            <div className="h-8 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="h-8 w-1/2 animate-pulse rounded bg-gray-200" />
          </div>
        ) : title ? (
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-gray-900 sm:text-[34px]">
            {title}
          </h1>
        ) : (
          <h1 className="text-[20px] font-bold text-gray-500">기사 제목 정보를 찾지 못했습니다</h1>
        )}
        {/* 가운뎃점은 항목 앞에 붙이고 한 칸만큼 왼쪽으로 밀어 잘라 낸다 —
            줄이 바뀌어도 줄 끝·줄 머리에 점이 홀로 남지 않는다 */}
        <div className="mt-3 overflow-hidden">
          <p className="-ml-[18px] flex flex-wrap items-center gap-y-0.5 text-[14px] text-gray-600">
            <span className={`${metaItem} font-semibold text-gray-800`}>{source}</span>
            {article?.byline && <span className={metaItem}>{stripHtml(article.byline)}</span>}
            {meta?.pubDate && (
              <>
                <span className={`${metaItem} whitespace-nowrap print:hidden`}>
                  {formatRelative(meta.pubDate)}
                </span>
                <span className={`${metaItem} hidden whitespace-nowrap print:inline`}>
                  {formatDateTime(meta.pubDate)}
                </span>
              </>
            )}
            {article?.ok && (
              <span className={`${metaItem} whitespace-nowrap`}>읽는 시간 약 {readMinutes}분</span>
            )}
          </p>
        </div>
      </header>

      {/* 본문 */}
      {loading ? (
        <div className="mt-8" aria-busy="true">
          <p role="status" className="mb-4 text-[14px] text-gray-600">
            본문을 불러오는 중입니다… 길게는 10초 넘게 걸릴 수 있습니다.
          </p>
          <div className="space-y-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-200" />
            ))}
          </div>
        </div>
      ) : article?.ok && article.contentHtml ? (
        <>
          {/* 본문에 이미지가 없을 때만 대표 이미지를 보여줘 중복 노출을 막는다 */}
          {leadImage && !leadFailed && !/<img/i.test(article.contentHtml) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={leadImage}
              alt=""
              onError={() => setLeadFailed(true)}
              className="mt-6 max-h-[56vh] w-full rounded-xl object-cover"
            />
          )}
          <div
            ref={bodyRef}
            className="article-body mt-7"
            dangerouslySetInnerHTML={{ __html: article.contentHtml }}
          />
          {sourceLine}
          <footer className="no-print mt-10 border-t border-gray-200 pt-5">
            <p className="text-[14px] leading-relaxed text-gray-600">
              본문은 원문에서 자동 추출되어 일부 서식이 다를 수 있습니다.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={goBack} className="btn-lg btn-lg-gray">
                <IconChevronLeft />
                목록으로
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-lg btn-lg-dark">
                원문 보기
                <IconExternal />
              </a>
            </div>
          </footer>
        </>
      ) : (
        // 추출 실패 폴백 — 안내를 첫 화면에, 요약·대표 이미지는 그 아래
        <>
          <div className="no-print mt-6 rounded-xl border border-[var(--line)] bg-gray-50 p-4">
            <p className="text-[15px] font-bold text-gray-900">본문을 자동으로 불러오지 못했습니다</p>
            <p className="mt-1 text-[14px] text-gray-600">
              {meta?.description
                ? "아래는 기사 요약입니다. 전체 내용은 원문에서 확인해 주세요."
                : "기사 내용은 원문에서 확인해 주세요."}
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-lg btn-lg-dark mt-3 w-full"
            >
              원문 기사 보기
              <IconExternal />
            </a>
          </div>
          {meta?.description && (
            <section className="mt-6">
              <h2 className="text-[12px] font-bold text-gray-500">기사 요약</h2>
              <div className="article-body mt-1.5">
                <p>{stripHtml(meta.description)}</p>
              </div>
            </section>
          )}
          {leadImage && !leadFailed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={leadImage}
              alt=""
              onError={() => setLeadFailed(true)}
              className="mt-6 max-h-[40vh] w-full rounded-xl object-cover"
            />
          )}
          {sourceLine}
        </>
      )}

      {/* 복사 알림 — 라이브 영역은 늘 두고 내용만 바꿔 화면낭독기가 읽게 한다 */}
      <div role="status" className="no-print">
        {copied && (
          <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-max rounded-full bg-gray-900 px-4 py-2.5 text-[14px] font-bold text-white shadow-lg">
            링크를 복사했습니다
          </div>
        )}
      </div>
    </article>
  );
}
