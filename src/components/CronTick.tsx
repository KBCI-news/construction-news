"use client";

import { useEffect } from "react";

// 화면을 열 때 크론 틱을 뒤에서 건드린다 — 화면은 응답을 기다리지 않는다.
// (GitHub Actions 스케줄이 늦어도 직원이 쓰는 동안은 수집·묶음·썸네일이 돈다)
//
// 틱 한 번은 밀린 단계 하나만 돈다(함수 시간 한도 60초). 방문이 뜸하면 한 방문에 수집만 돌고
// 다음 방문까지 새 기사가 묶이지 않은 채 보였다 — 틱이 무언가 돌렸으면 이어서 다시 불러
// 한 방문으로 수집 → 채점(중복 묶기) → 썸네일까지 따라잡는다. 돌릴 게 없으면 바로 멈춘다.
const MAX_STEPS = 3;

async function runTicks() {
  for (let i = 0; i < MAX_STEPS; i++) {
    let ran: unknown = null;
    try {
      const res = await fetch("/api/cron/tick", { keepalive: true, cache: "no-store" });
      ran = ((await res.json()) as { ran?: unknown }).ran ?? null;
    } catch {
      return;
    }
    if (!ran) return;
  }
}

export function CronTick() {
  useEffect(() => {
    const key = "cron-tick-at";
    try {
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < 5 * 60_000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      /* 세션 저장소가 막혀 있어도 틱은 보낸다 */
    }
    void runTicks();
  }, []);
  return null;
}
