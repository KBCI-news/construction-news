// 기사 제목 클릭 시 우리 UI 안의 리더 페이지로 보낸다.
export const readerHref = (link: string): string =>
  `/read?url=${encodeURIComponent(link)}`;
