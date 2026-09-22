"use client";

import Link from "next/link";
import type { FeedItem } from "@/app/api/feed/route";
import { deskLabel } from "@/lib/lexicon";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { readerHref } from "@/lib/links";
import { Thumbnail } from "@/components/Thumbnail";

export function FeedRow({ item, pill }: { item: FeedItem; pill?: string }) {
  const title = stripHtml(item.title);
  // 정보보호(creditinfo)는 태그 체계에서 빠졌다 — 카드에도 표기하지 않는다
  const desk = item.desks.find((d) => d !== "creditinfo");
  // 태그를 골라 보는 중엔 카드도 그 태그로 표기한다 — 법/정책을 골랐는데
  // 기사 원소속(채권추심 등)이 뜨면 필터가 어긋난 것처럼 읽힌다.
  const pillText = pill ?? (desk ? deskLabel(desk) : undefined);

  return (
    <article className="flex items-start gap-2.5 overflow-hidden py-3.5 sm:gap-5 sm:py-5">
      <div className="min-w-0 flex-1 break-words">
        {/* 태그는 알약으로 — 회색 본문 속에서 이 기사가 어느 축인지 먼저 읽힌다 */}
        {pillText && (
          <p className="mb-1.5">
            <span className="inline-flex items-center rounded-full bg-[#FFF4D6] px-2.5 py-[3px] text-[11.5px] font-bold text-[#8A6400]">
              {pillText}
            </span>
          </p>
        )}

        <Link href={readerHref(item.link)} className="group block">
          <h3 className="text-[17px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[20px]">
            {title}
          </h3>
        </Link>

        {/* 근거 칩 — 점수를 단독으로 표기하지 않는다. 담당자가 오판을 즉시 간파할 수 있어야 한다.
            셋이면 충분하다 — 그 이상은 장식이 된다. */}
        {item.reasons.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-1">
            {item.reasons.slice(0, 3).map((r) => (
              <li
                key={`${r.kind}-${r.label}`}
                className="rounded-md bg-gray-50 px-1.5 py-0.5 text-[11.5px] font-medium text-gray-500"
              >
                {r.label}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 text-[12.5px] text-gray-500">
          <span className="font-medium text-gray-600">
            {item.sourceHost ?? hostOf(item.originallink)}
          </span>
          <span className="mx-1.5 text-gray-300">·</span>
          <span>{formatRelative(item.pubDate)}</span>
        </div>
      </div>

      <Link
        href={readerHref(item.link)}
        className="block shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Thumbnail
          src={item.imageUrl}
          label={pillText ?? "KBCI"}
          className="h-[54px] w-[74px] rounded-lg sm:h-[84px] sm:w-[124px]"
        />
      </Link>
    </article>
  );
}
