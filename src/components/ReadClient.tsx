"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArticleContent } from "@/app/api/article/route";
import type { NewsResponseItem } from "@/app/api/news/route";
import { CATEGORIES } from "@/lib/categories";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { buildPrintHref } from "@/components/PrintLink";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export default function ReadClient() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url") ?? "";

  const [article, setArticle] = useState<ArticleContent | null>(null);
  const [meta, setMeta] = useState<NewsResponseItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setArticle(null);

    // 본문 추출 + DB 메타데이터(카테고리/날짜)를 함께 가져온다.
    Promise.all([
      fetch(`/api/article?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json() as Promise<ArticleContent>)
        .catch(() => null),
      fetch("/api/news", { signal: controller.signal })
        .then((r) => r.json())
        .then((j) => (j.items ?? []) as NewsResponseItem[])
        .catch(() => [] as NewsResponseItem[]),
    ])
      .then(([art, items]) => {
        setArticle(art);
        setMeta(items.find((it) => it.link === url) ?? null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [url]);

  const title = useMemo(() => {
    const t = article?.title || meta?.title || "";
    return stripHtml(t);
  }, [article, meta]);

  const source = article?.host || (url ? hostOf(url) : "");
  const categories = meta?.categories ?? [];
  const leadImage = article?.leadImage || meta?.imageUrl || null;

  if (!url) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        잘못된 접근입니다.
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-[760px]">
      {/* 상단 바 (인쇄 시 숨김) */}
      <div className="no-print mb-6 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-[13px] font-bold tracking-wider text-gray-500 hover:text-[#9A7A12]"
        >
          ← 목록으로
        </button>
        <div className="flex items-center gap-2">
          <Link
            href={buildPrintHref([url])}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#9A7A12]"
          >
            🖨 PDF 출력
          </Link>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 border border-gray-300 px-3 py-1.5 text-[13px] font-bold tracking-wider text-gray-700 transition-colors hover:border-[#FFB81C] hover:text-[#9A7A12]"
          >
            원문 보기 ↗
          </a>
        </div>
      </div>

      {/* 헤더 */}
      <header className="border-b border-gray-200 pb-5">
        {categories.length > 0 && (
          <div className="mb-3 text-[12px] font-bold tracking-wider text-[#9A7A12]">
            {categories.map((id) => labelOf(id)).join(" · ")}
          </div>
        )}
        {loading && !title ? (
          <div className="space-y-3">
            <div className="h-8 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="h-8 w-1/2 animate-pulse rounded bg-gray-200" />
          </div>
        ) : (
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-gray-900 sm:text-[34px]">
            {title || "제목을 불러올 수 없습니다"}
          </h1>
        )}
        <p className="mt-4 text-[13px] text-gray-500">
          <span className="font-medium text-gray-700">{source}</span>
          {article?.byline && <span className="mx-1.5">·</span>}
          {article?.byline && <span>{stripHtml(article.byline)}</span>}
          {meta?.pubDate && (
            <>
              <span className="mx-1.5">—</span>
              <span>{formatRelative(meta.pubDate)}</span>
            </>
          )}
        </p>
      </header>

      {/* 본문 */}
      {loading ? (
        <div className="mt-8 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-4 w-full animate-pulse rounded bg-gray-100"
            />
          ))}
        </div>
      ) : article?.ok && article.contentHtml ? (
        <>
          {leadImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={leadImage}
              alt=""
              className="mt-7 w-full rounded-xl object-cover"
            />
          )}
          <div
            className="article-body mt-7"
            dangerouslySetInnerHTML={{ __html: article.contentHtml }}
          />
          <p className="no-print mt-10 border-t border-gray-200 pt-5 text-[13px] text-gray-400">
            본문은 원문에서 자동 추출되어 일부 서식이 다를 수 있습니다.{" "}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-gray-600 underline hover:text-[#9A7A12]"
            >
              원문에서 정확히 보기 ↗
            </a>
          </p>
        </>
      ) : (
        // 추출 실패 폴백
        <div className="mt-8">
          {leadImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={leadImage}
              alt=""
              className="mb-6 w-full rounded-xl object-cover"
            />
          )}
          {meta?.description && (
            <p className="text-[16px] leading-loose text-gray-800">
              {stripHtml(meta.description)}
            </p>
          )}
          <div className="mt-8 border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
            <p className="text-[14px] text-gray-600">
              이 기사는 본문을 자동으로 불러오지 못했습니다.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 bg-gray-900 px-5 py-2.5 text-[14px] font-bold tracking-wider text-white hover:bg-black"
            >
              원문에서 보기 ↗
            </a>
          </div>
        </div>
      )}
    </article>
  );
}
