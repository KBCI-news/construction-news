"use client";

import Link from "next/link";
import type { FeedItem } from "@/app/api/feed/route";
import { tagLabelOf } from "@/lib/lexicon";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { readerHref, stashReaderMeta } from "@/lib/links";
import { Thumbnail } from "@/components/Thumbnail";

// 검색어 강조 — API가 trim한 검색어 전체를 대소문자 무시 부분 일치(ilike)로 찾으므로 같은 규칙으로 표시만 한다
function highlightParts(text: string, q?: string): React.ReactNode {
  const needle = q?.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "gi")).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-[#FFF4D6] px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function FeedRow({
  item,
  pill,
  highlight,
}: {
  item: FeedItem;
  pill?: string;
  highlight?: string;
}) {
  const title = stripHtml(item.title);
  // 태그를 골라 보는 중엔(태그 안에서 검색할 때 포함) 카드도 그 태그로 표기한다 —
  // 법/정책을 골랐는데 기사 원소속(채권추심 등)이 뜨면 필터가 어긋난 것처럼 읽힌다.
  // 그 밖에는 태그 목록과 같은 이름으로만 표기한다.
  const pillText = pill ?? tagLabelOf(item);

  return (
    <article>
      {/* 행 전체가 탭 영역 — 모바일에서 제목만 노리게 하지 않는다.
          누른 행의 태그·시각은 리더로 넘겨 어느 기사든 같은 알약을 보여 준다 */}
      <Link
        href={readerHref(item.link)}
        onClick={() => stashReaderMeta(item, pillText)}
        className="group -mx-2 flex items-start gap-2.5 rounded-xl px-2 py-3.5 active:bg-gray-100 sm:gap-5 sm:py-5"
      >
        <div className="min-w-0 flex-1 break-words">
          {/* 태그는 알약으로 — 회색 본문 속에서 이 기사가 어느 축인지 먼저 읽힌다 */}
          {pillText && (
            <p className="mb-1.5">
              <span className="pill-tag">{pillText}</span>
            </p>
          )}

          <h2 className="text-[17px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[20px]">
            {highlightParts(title, highlight)}
          </h2>

          {/* 근거 칩 — 점수를 단독으로 표기하지 않는다. 담당자가 오판을 즉시 간파할 수 있어야 한다.
              셋이면 충분하다 — 그 이상은 장식이 된다. */}
          {item.reasons.length > 0 && (
            <ul
              aria-label="선정 근거"
              className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1"
            >
              <li aria-hidden className="reason-label">
                근거
              </li>
              {item.reasons.slice(0, 3).map((r) => (
                <li key={`${r.kind}-${r.label}`} className="reason-chip">
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

        <Thumbnail
          src={item.imageUrl}
          className="h-[54px] w-[74px] shrink-0 rounded-lg sm:h-[84px] sm:w-[124px]"
        />
      </Link>
    </article>
  );
}
