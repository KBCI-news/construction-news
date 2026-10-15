import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimCron, type CronKey } from "@/lib/cron-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 화면이 열릴 때 호출되는 자가 치유 틱. GitHub Actions 스케줄(30분)이 실제로는 3~7시간에
// 한 번만 울려 수집·묶음·썸네일이 멈춰 있었다. 가장 오래 밀린 단계 하나를 점유해 돌린다 —
// 호출마다 한 단계만, 점유는 원자적(update … where ran_at < 기준)이라 동시 호출이 겹치지 않는다.
// 비밀 없이 열려 있지만 할 수 있는 일은 "원래 30분마다 돌 크론을 지금 돌리기"뿐이다.
const STALE_MS: Record<CronKey, number> = {
  collect: 25 * 60_000,
  score: 25 * 60_000,
  images: 25 * 60_000,
};
// 기본 순서(상태를 못 읽었을 때): 수집 → 채점·묶음 → 썸네일
const ORDER: CronKey[] = ["collect", "score", "images"];

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

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // 같은 배포의 크론 경로를 부른다 — CRON_URL 이 있으면 그걸, 없으면 이 요청의 origin
  const base = process.env.CRON_URL || new URL(request.url).origin;
  if (!secret) return NextResponse.json({ ok: false, skipped: "not configured" });

  const supabase = getSupabaseAdmin();
  for (const key of await staleFirst(supabase)) {
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
