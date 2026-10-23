import type { NextRequest } from "next/server";
import { probeSources } from "@/lib/source-probe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
// 서울 지역에서 같은 진단 — 국회·금융위는 해외 데이터센터 IP에서 끊긴다는 보고가 있다
export const preferredRegion = "icn1";

export function GET(request: NextRequest) {
  return probeSources(request);
}
