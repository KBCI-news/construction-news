import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimCron, type CronKey } from "@/lib/cron-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 화면이 열릴 때 호출되는 자가 치유 틱. GitHub Actions 스케줄(30분)이 실제로는 3~7시간에
// 한 번만 울려 수집·묶음·썸네일이 멈춰 있었다. 가장 오래 밀린 단계 하나를 점유해 돌린다 —
// 점유는 원자적(update … where ran_at < 기준)이라 동시 호출이 겹치지 않는다.
// 비밀 없이 열려 있지만 할 수 있는 일은 "원래 30분마다 돌 크론을 지금 돌리기"뿐이다.
//
// 점유하면 곧바로 응답하고, 단계 실행은 waitUntil 로 서버가 끝까지 붙잡는다. 예전엔 응답을
// 단계가 끝날 때까지 미뤘는데, 방문자가 페이지를 금방 닫으면 연결이 끊기며 단계도 중간에
// 죽었다(10/15 썸네일 46초에 끊김, 수집·채점은 점유만 하고 시작도 못 함).
// 단계가 끝나면 같은 방식으로 다음 틱을 불러, 한 방문으로 수집 → 채점 → 썸네일까지 잇는다.
const STALE_MS: Record<CronKey, number> = {
  collect: 25 * 60_000,
  score: 25 * 60_000,
  images: 25 * 60_000,
};
// 기본 순서(상태를 못 읽었을 때): 수집 → 채점·묶음 → 썸네일
const ORDER: CronKey[] = ["collect", "score", "images"];
// 한 방문이 잇는 단계 수 — 세 단계를 한 바퀴
const MAX_HOPS = 3;
// 이 호출의 시간 한도(60초) 안에서 다음 틱을 부를 여유
const NEXT_HOP_BEFORE_MS = 50_000;

/**
 * 밀린 단계를 가장 오래 밀린 것부터 — 고정 순서면 방문이 25분 넘게 끊길 때마다 수집이 다시 밀려
 * 그것만 돌고, 채점(중복 묶기)·썸네일은 몇 시간씩 굶었다(10/15 점심: 채점 1시간 52분, 썸네일 2시간 9분).
 * ran_at 이 오래된 순으로 세우면 세 단계가 번갈아 돈다.
 */
async function staleFirst(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<CronKey[]> {
  const { data, error } = await supabase.from("cron_state").select("key,ran_at");
  if (error || !data) return ORDER;
  const ranAt = new Map<string, number>(
    data.map((r: { key: string; ran_at: string | null }) => [r.key, r.ran_at ? Date.parse(r.ran_at) : 0]),
  );
  // 상태 행이 없는 단계는 한 번도 안 돈 것 — 가장 오래된 것으로 친다
  return [...ORDER].sort((a, b) => (ranAt.get(a) ?? 0) - (ranAt.get(b) ?? 0));
}

async function runStep(base: string, secret: string, key: CronKey, hop: number, started: number) {
  try {
    await fetch(`${base}/api/cron/${key}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    // 응답 본문은 버린다 — 각 단계가 끝나며 cron_state 를 스스로 갱신한다
  } catch {
    /* 실패한 단계는 점유가 90초 뒤 풀려 다음 틱이 다시 잡는다 */
  }
  if (hop + 1 >= MAX_HOPS || Date.now() - started > NEXT_HOP_BEFORE_MS) return;
  try {
    // 다음 틱은 점유만 하고 곧바로 응답한다 — 그 단계는 그 호출의 waitUntil 이 붙잡는다
    await fetch(`${base}/api/cron/tick?hop=${hop + 1}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* 다음 방문이 이어 받는다 */
  }
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  // 같은 배포의 크론 경로를 부른다 — CRON_URL 이 있으면 그걸, 없으면 이 요청의 origin
  const base = process.env.CRON_URL || new URL(request.url).origin;
  if (!secret) return NextResponse.json({ ok: false, skipped: "not configured" });
  const hop = Math.min(Math.max(Number(request.nextUrl.searchParams.get("hop")) || 0, 0), MAX_HOPS);

  const supabase = getSupabaseAdmin();
  for (const key of await staleFirst(supabase)) {
    if (!(await claimCron(supabase, key, STALE_MS[key]))) continue;
    waitUntil(runStep(base, secret, key, hop, started));
    return NextResponse.json({ ok: true, ran: key, hop }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, ran: null, hop }, { headers: { "Cache-Control": "no-store" } });
}
