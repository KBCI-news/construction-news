import { Suspense } from "react";
import NewsroomClient from "@/components/NewsroomClient";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <NewsroomClient />
    </Suspense>
  );
}
