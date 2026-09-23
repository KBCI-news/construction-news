import { Suspense } from "react";
import NewsroomClient from "@/components/NewsroomClient";
import { ListSkeleton } from "@/components/ListSkeleton";

export default function Home() {
  return (
    <Suspense fallback={<ListSkeleton toolbarHeight={219} />}>
      <NewsroomClient />
    </Suspense>
  );
}
