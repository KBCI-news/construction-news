"use client";

import { useEffect } from "react";

// 화면을 열 때 한 번, 크론 틱을 뒤에서 건드린다 — 응답은 기다리지 않는다.
// (GitHub Actions 스케줄이 늦어도 직원이 쓰는 동안은 수집·묶음·썸네일이 돈다)
// 틱은 점유하자마자 응답하고 단계 실행과 다음 단계 연결은 서버가 끝까지 붙잡으므로,
// 방문자가 곧바로 페이지를 닫아도 수집 → 채점 → 썸네일이 이어서 돈다.
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
    fetch("/api/cron/tick", { keepalive: true, cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}
