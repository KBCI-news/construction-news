"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { NewsResponseItem } from "@/app/api/news/route";
import type { ArticleContent } from "@/app/api/article/route";
import { CATEGORIES } from "@/lib/categories";
import { hostOf, stripHtml } from "@/lib/format";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

const formatDate = (pubDate: string): string => {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return pubDate;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

type PrintItem = {
  link: string;
  meta: NewsResponseItem | null;
  article: ArticleContent | null;
};

export default function PrintClient() {
  const params = useSearchParams();
  const wanted = useMemo(() => {
    const raw = params.get("links");
    if (!raw) return [] as string[];
    return raw.split(",").map((s) => decodeURIComponent(s)).filter(Boolean);
  }, [params]);

  const [items, setItems] = useState<PrintItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (wanted.length === 0) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    const metaPromise = fetch("/api/news", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => (j.items ?? []) as NewsResponseItem[])
      .catch(() => [] as NewsResponseItem[]);

    metaPromise
      .then(async (allMeta) => {
        const byLink = new Map(allMeta.map((it) => [it.link, it]));
        // 각 기사 본문을 병렬로 추출
        const articles = await Promise.all(
          wanted.map((link) => {
            const qs = new URLSearchParams({ url: link });
            const orig = byLink.get(link)?.originallink;
            if (orig && orig !== link) qs.set("fallback", orig);
            return fetch(`/api/article?${qs.toString()}`, {
              signal: controller.signal,
            })
              .then((r) => r.json() as Promise<ArticleContent>)
              .catch(() => null);
          }),
        );
        const result: PrintItem[] = wanted.map((link, i) => ({
          link,
          meta: byLink.get(link) ?? null,
          article: articles[i],
        }));
        setItems(result);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [wanted]);

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        출력할 기사를 불러오는 중... (본문 추출에 잠시 걸릴 수 있습니다)
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        출력할 기사를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="print-root mx-auto max-w-[800px]">
      <div className="no-print mb-8 flex items-center justify-between border-b-2 border-gray-900 pb-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest text-[#9A7A12]">
            KBCI NEWS · 인쇄
          </p>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-gray-900">
            기사 출력 ({items.length}건)
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            아래 버튼을 누른 뒤 대상에서 &quot;PDF로 저장&quot;을 선택하세요.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-5 py-2.5 text-[14px] font-bold tracking-wider text-white transition-colors hover:bg-black"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <div className="space-y-12">
        {items.map(({ link, meta, article }, idx) => {
          const title = stripHtml(article?.title || meta?.title || "");
          const categories = meta?.categories ?? [];
          const leadImage = article?.leadImage || meta?.imageUrl || null;
          const host = article?.host || hostOf(link);
          const hasBody = article?.ok && article.contentHtml;

          return (
            <article key={link} className="print-article">
              {categories.length > 0 && (
                <div className="mb-2 text-[12px] font-bold tracking-wider text-[#9A7A12]">
                  {categories.map((id) => labelOf(id)).join(" · ")}
                </div>
              )}
              <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900">
                {title || "(제목 없음)"}
              </h2>
              <p className="mt-2 text-[13px] text-gray-500">
                {host}
                {meta?.pubDate && ` · ${formatDate(meta.pubDate)}`}
              </p>

              {leadImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={leadImage}
                  alt=""
                  className="mt-5 max-h-[420px] w-full rounded-lg object-cover"
                />
              )}

              {hasBody ? (
                <div
                  className="article-body mt-5"
                  dangerouslySetInnerHTML={{ __html: article!.contentHtml! }}
                />
              ) : meta?.description ? (
                <p className="mt-5 whitespace-pre-line text-[16px] leading-loose text-gray-800">
                  {stripHtml(meta.description)}
                </p>
              ) : (
                <p className="mt-5 text-[14px] text-gray-400">
                  본문을 불러오지 못했습니다.
                </p>
              )}

              <p className="mt-5 break-all text-[12px] text-gray-400">
                원문: {link}
              </p>

              {idx < items.length - 1 && (
                <div className="mt-12 border-t border-gray-200" />
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
