import { redirect } from "next/navigation";

// 구 카테고리(6분류) → 지금의 뉴스 태그. 맞는 태그가 없는 분류(economy·society)는 전체로
const MAP: Record<string, string> = {
  finance: "collection",
  law: "legal",
  industry: "edoc",
  it: "edoc",
};

export default function CategoryRedirect({ params }: { params: { id: string } }) {
  const tag = MAP[params.id];
  // "/"는 이제 기본 태그(채권추심)로 열리므로 전체는 tag=all로 명시한다
  redirect(tag ? `/?tag=${tag}` : "/?tag=all");
}
