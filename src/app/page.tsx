import { Suspense } from "react";
import NewsroomClient from "@/components/NewsroomClient";
import { ListSkeleton } from "@/components/ListSkeleton";

export default function Home() {
  return (
    // 폴백 툴바 높이 = 기본 태그(채권추심, 안내 1줄)의 실제 툴바 카드 높이(360~430px에서 201.5px).
    // 기본 태그나 그 안내 문구가 바뀌면 다시 재서 맞춘다 — 어긋나면 수화 때 목록이 위아래로 튄다
    <Suspense fallback={<ListSkeleton toolbarHeight={202} />}>
      <NewsroomClient />
    </Suspense>
  );
}
