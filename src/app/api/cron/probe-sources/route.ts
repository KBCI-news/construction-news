import type { NextRequest } from "next/server";
import { probeSources } from "@/lib/source-probe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 기본 지역 함수에서 외부 출처 도달성 진단
export function GET(request: NextRequest) {
  return probeSources(request);
}
