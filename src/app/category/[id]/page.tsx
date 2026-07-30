import { redirect } from "next/navigation";

// 구 카테고리(6분류) → 신 데스크 매핑. 기존 링크·북마크를 살린다.
const MAP: Record<string, string> = {
  finance: "collection",
  economy: "macro",
  industry: "edoc",
  society: "debtor",
  law: "__legal__",
  it: "edoc",
};

export default function CategoryRedirect({ params }: { params: { id: string } }) {
  const target = MAP[params.id];
  if (target === "__legal__") redirect("/?legal=1");
  redirect(target ? `/?desk=${target}` : "/");
}
