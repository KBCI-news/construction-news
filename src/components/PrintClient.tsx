"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { NewsResponseItem } from "@/app/api/news/route";
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

export default function PrintClient() {
  const params = useSearchParams();
  const wanted = useMemo(() => {
    const raw = params.get("links");
    if (!raw) return [] as string[];
    return raw.split(",").map((s) => decodeURIComponent(s)).filter(Boolean);
  }, [params]);

  const [items, setItems] = useState<NewsResponseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/news", { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => setItems(json.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // 요청한 link 순서를 유지해 정렬
  const selected = useMemo(() => {
    const byLink = new Map(items.map((it) => [it.link, it]));
    return wanted
      .map((l) => byLink.get(l))
      .filter((x): x is NewsResponseItem => Boolean(x));
  }, [items, wanted]);

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        출력할 기사를 불러오는 중...
      </div>
    );
  }

  if (selected.length === 0) {
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
            기사 출력 ({selected.length}건)
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
        {selected.map((item, idx) => (
          <article key={item.link} className="print-article">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-bold tracking-wider text-[#9A7A12]">
              {item.categories.length > 0 && (
                <span>
                  {item.categories.map((id) => labelOf(id)).join(" · ")}
                </span>
              )}
            </div>
            <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900">
              {stripHtml(item.title)}
            </h2>
            <p className="mt-2 text-[13px] text-gray-500">
              {hostOf(item.originallink)} · {formatDate(item.pubDate)}
            </p>

            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                className="mt-5 max-h-[420px] w-full rounded-lg object-cover"
              />
            )}

            {item.description && (
              <p className="mt-5 whitespace-pre-line text-[16px] leading-loose text-gray-800">
                {stripHtml(item.description)}
              </p>
            )}

            <p className="mt-5 break-all text-[12px] text-gray-400">
              원문: {item.link}
            </p>

            {idx < selected.length - 1 && (
              <div className="mt-12 border-t border-gray-200" />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
