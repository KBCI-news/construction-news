import { redirect } from "next/navigation";

export default function FeaturedRedirect() {
  redirect("/?sort=score"); // 구 '주요 기사' — 점수 하한 필터는 없어져 중요도순이 가장 가깝다
}
