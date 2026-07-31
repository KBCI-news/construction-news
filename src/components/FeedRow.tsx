"use client";

import Link from "next/link";
import type { FeedItem } from "@/app/api/feed/route";
import { deskLabel } from "@/lib/lexicon";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { readerHref } from "@/lib/links";
import { Thumbnail } from "@/components/Thumbnail";
import { useClip } from "@/components/ClipProvider";

export function FeedRow({ item }: { item: FeedItem }) {
  const { has, toggle } = useClip();
  const clipped = has(item.link);
  const title = stripHtml(item.title);
  const desk = item.desks[0];

  return (
    <article className="flex items-start gap-2.5 overflow-hidden py-3.5 sm:gap-5 sm:py-5">
      <div className="min-w-0 flex-1 break-words">
        {desk && (
          <p className="mb-1.5 text-[12px] font-bold tracking-wide text-[#7A5E08]">
            {deskLabel(desk)}
          </p>
        )}

        <Link href={readerHref(item.link)} className="group block">
          <h3 className="text-[17px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[20px]">
            {title}
          </h3>
        </Link>

        {/* 근거 칩 — 점수를 단독으로 표기하지 않는다. 담당자가 오판을 즉시 간파할 수 있어야 한다. */}
        {item.reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1">
            {item.reasons.map((r) => (
              <li
                key={`${r.kind}-${r.label}`}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-[11.5px] font-medium text-gray-700"
              >
                {r.label}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-600">
          <span>
            <span className="font-medium text-gray-700">
              {item.sourceHost ?? hostOf(item.originallink)}
            </span>
            <span className="mx-1.5">·</span>
            <span>{formatRelative(item.pubDate)}</span>
          </span>
          <button
            type="button"
            onClick={() =>
              toggle({
                link: item.link,
                title,
                summary: stripHtml(item.description ?? "").slice(0, 220),
                sourceHost: item.sourceHost,
                pubDate: item.pubDate,
              })
            }
            aria-pressed={clipped}
            aria-label={`${title} ${clipped ? "담기 해제" : "브리핑에 담기"}`}
            className={`inline-flex min-h-[44px] items-center gap-1 rounded-lg border px-3 text-[13px] font-bold transition-colors ${
              clipped
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:border-[#FFB81C] hover:text-[#7A5E08]"
            }`}
          >
            {clipped ? "✓ 담김" : "+ 담기"}
          </button>
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
          label={desk ? deskLabel(desk) : "KBCI"}
          className="h-[54px] w-[74px] rounded-lg sm:h-[84px] sm:w-[124px]"
        />
      </Link>
    </article>
  );
}
