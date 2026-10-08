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
  // 여러 매체가 다룬 기사만 — 점수 없이 "큰 기사"임을 알리는 유일한 단서
  const outlets = item.clusterHosts >= 3 ? `${item.clusterHosts}개 매체 보도` : null;
  // 메타 조각: 앞에 '·'를 ::before로 그리고, 바깥 overflow-hidden + 안쪽 -ml-[18px]로
  // 첫 조각/줄머리 조각의 점만 잘려 나간다 → 줄바꿈돼도 '·'로 시작하는 줄이 없다
  const piece =
    "relative whitespace-nowrap pl-[18px] before:absolute before:left-0 before:w-[18px] before:text-center before:text-gray-300 before:content-['·']";

  return (
    <article>
      {/* 행 전체가 탭 영역 — 모바일에서 제목만 노리게 하지 않는다.
          누른 행의 태그·시각은 리더로 넘겨 어느 기사든 같은 알약을 보여 준다.
          포털(네이버·다음) 목록 문법 그대로 — 왼쪽 글, 오른쪽 큰 썸네일, 행마다 같은 모양 */}
      <Link
        href={readerHref(item.link)}
        onClick={() => stashReaderMeta(item, pillText)}
        className="group -mx-2 flex items-start gap-3 rounded-xl px-2 py-[18px] active:bg-gray-100 min-[375px]:gap-3.5 sm:gap-5 sm:py-5"
      >
        {/* keep-all(전역)은 그대로 두고, 폭보다 긴 토큰(URL·영문 합성어)만 강제로 끊는다 */}
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {/* 태그는 알약으로 — 회색 본문 속에서 이 기사가 어느 축인지 먼저 읽힌다 */}
          {pillText && (
            <p className="mb-2 leading-none">
              <span className="pill-tag">{pillText}</span>
            </p>
          )}

          {/* 제목 최대 3줄 — 행 모양이 늘 비슷해야 20~40건을 훑기 쉽다.
              썸네일이 있으면 글 칸이 190~210px로 좁아 keep-all(단어 단위)로는 한 줄에 한 단어만 남고
              3줄 안에 제목이 다 안 들어온다 — 포털 목록처럼 글자 단위로 끊어 칸을 채운다 */}
          <h2
            className={`line-clamp-3 text-[17px] font-bold leading-[1.42] tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline min-[375px]:text-[18px] sm:text-[20px] ${
              item.imageUrl ? "[word-break:normal]" : ""
            }`}
          >
            {highlightParts(title, highlight)}
          </h2>

          {/* 출처 · 시각 (· N개 매체 보도) — 조각 단위로 통째로 줄바꿈되고 줄머리에 점이 남지 않는다 */}
          <div className="mt-[9px] overflow-hidden text-[13px] leading-[1.45] text-gray-500">
            <div className="-ml-[18px] flex flex-wrap">
              <span className={`${piece} font-medium text-gray-600`}>
                {item.sourceHost ?? hostOf(item.originallink)}
              </span>
              <span className={piece}>{formatRelative(item.pubDate)}</span>
              {outlets && <span className={piece}>{outlets}</span>}
            </div>
          </div>
        </div>

        {/* 4:3 큰 썸네일 — 없으면 Thumbnail이 null을 돌려 본문이 전폭을 쓴다 */}
        <Thumbnail
          src={item.imageUrl}
          className="h-[78px] w-[104px] shrink-0 rounded-xl min-[375px]:h-[84px] min-[375px]:w-[112px] sm:h-[96px] sm:w-[128px]"
        />
      </Link>
    </article>
  );
}
