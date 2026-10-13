import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimCron, type CronKey } from "@/lib/cron-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 화면이 열릴 때 호출되는 자가 치유 틱. GitHub Actions 스케줄(30분)이 실제로는 3~7시간에
// 한 번만 울려 수집·묶음·썸네일이 멈춰 있었다. 오래된 단계 하나를 점유해 돌린다 —
// 호출마다 한 단계만, 점유는 원자적(update … where ran_at < 기준)이라 동시 호출이 겹치지 않는다.
// 비밀 없이 열려 있지만 할 수 있는 일은 "원래 30분마다 돌 크론을 지금 돌리기"뿐이다.
const STALE_MS: Record<CronKey, number> = {
  collect: 25 * 60_000,
  score: 25 * 60_000,
  images: 25 * 60_000,
};
// 우선순위: 수집 → 채점·묶음 → 썸네일
const ORDER: CronKey[] = ["collect", "score", "images"];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // 같은 배포의 크론 경로를 부른다 — CRON_URL 이 있으면 그걸, 없으면 이 요청의 origin
  const base = process.env.CRON_URL || new URL(request.url).origin;
  if (!secret) return NextResponse.json({ ok: false, skipped: "not configured" });

  const supabase = getSupabaseAdmin();
  for (const key of ORDER) {
    if (!(await claimCron(supabase, key, STALE_MS[key]))) continue;
    const started = Date.now();
    let status = 0;
    try {
      const res = await fetch(`${base}/api/cron/${key}`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      status = res.status;
      // 응답 본문은 버린다 — 각 단계가 끝나며 cron_state 를 스스로 갱신한다
    } catch {
      status = -1;
    }
    return NextResponse.json(
      { ok: status >= 200 && status < 300, ran: key, status, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ ok: true, ran: null }, { headers: { "Cache-Control": "no-store" } });
}
