import { Suspense } from "react";
import NewsList from "@/components/NewsList";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <NewsList />
    </Suspense>
  );
}
