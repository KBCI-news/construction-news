import type { getSupabaseAdmin } from "@/lib/supabase";

type Admin = ReturnType<typeof getSupabaseAdmin>;
export type CronKey = "collect" | "score" | "images";

/** 단계가 끝났을 때 — ran_at 을 지금으로, 점유 해제 */
export async function markCronDone(supabase: Admin, key: CronKey, note?: string): Promise<void> {
  await supabase
    .from("cron_state")
    .upsert({ key, ran_at: new Date().toISOString(), claimed_at: null, note: note ?? null });
}

/**
 * 단계 점유 — ran_at 이 staleMs 보다 오래됐고 다른 호출이 점유 중이 아닐 때만 성공한다.
 * (점유가 claimTtlMs 를 넘기면 죽은 것으로 보고 다시 준다)
 */
export async function claimCron(
  supabase: Admin,
  key: CronKey,
  staleMs: number,
  claimTtlMs = 90_000,
): Promise<boolean> {
  const now = Date.now();
  const { data, error } = await supabase
    .from("cron_state")
    .update({ claimed_at: new Date(now).toISOString() })
    .eq("key", key)
    .lt("ran_at", new Date(now - staleMs).toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${new Date(now - claimTtlMs).toISOString()}`)
    .select("key");
  if (error) return false;
  return (data ?? []).length > 0;
}
