import type { FeedItem } from "@/app/api/feed/route";

// 기사 제목 클릭 시 우리 UI 안의 리더 페이지로 보낸다.
export const readerHref = (link: string): string =>
  `/read?url=${encodeURIComponent(link)}`;

// 리더의 /api/feed 조회는 최근 200건(약 반나절)만 덮는다 — 목록에서 누른 행을 그대로 넘겨 태그·시각·원문 링크를 잃지 않게 한다
const READER_META_KEY = "reader-meta";

export function stashReaderMeta(item: FeedItem, pill?: string): void {
  try {
    sessionStorage.setItem(READER_META_KEY, JSON.stringify({ item, pill }));
  } catch {
    /* 저장 차단(사생활 모드 등) — 리더가 /api/feed로 찾는다 */
  }
}

// 읽고 지우지 않는다 — StrictMode 이중 실행과 새로고침이 다시 읽는다
export function readReaderMeta(
  link: string,
): { item: FeedItem; pill?: string } | null {
  try {
    const raw = sessionStorage.getItem(READER_META_KEY);
    if (!raw) return null;
    const stash = JSON.parse(raw) as { item?: FeedItem; pill?: string } | null;
    if (stash?.item?.link !== link) return null;
    return { item: stash.item, pill: stash.pill ?? undefined };
  } catch {
    return null;
  }
}
