import { Suspense } from "react";
import BidsClient from "@/components/BidsClient";

export const metadata = {
  title: "입찰공고 | KBCI 뉴스룸",
  description: "문서 전자화·전자문서 보관·임대차조사·권리조사 입찰공고 모니터링",
};

export default function BidsPage() {
  return (
    <Suspense fallback={null}>
      <BidsClient />
    </Suspense>
  );
}
