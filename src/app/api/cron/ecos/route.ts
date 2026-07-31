import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ECOS_SERIES,
  discoverItems,
  discoverTables,
  fetchEcosSeries,
  hasEcosKey,
} from "@/lib/ecos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 한국은행 ECOS에서 지표 원본 통계를 가져와 시계열에 적재한다.
// 기사 추출과 달리 보도 유무와 무관하게 값이 채워지고, 전망치·변동폭이
// 섞일 여지가 없다. ECOS_API_KEY가 없으면 아무 일도 하지 않는다.
//
// 진단용:
//   ?discover=연체율   통계표 코드 검색
//   ?items=722Y001     통계표의 세부항목 코드 목록

const HOST = "ecos.bok.or.kr";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasEcosKey()) {
    return NextResponse.json({
      ok: true,
      skipped: "ECOS_API_KEY 미설정 — 기사 추출 방식을 그대로 사용합니다",
    });
  }

  const url = new URL(request.url);
  const discover = url.searchParams.get("discover");
  const items = url.searchParams.get("items");
  const raw = url.searchParams.get("raw");
  if (discover) {
    return NextResponse.json({ ok: true, tables: await discoverTables(discover) });
  }
  if (items) {
    return NextResponse.json({ ok: true, items: await discoverItems(items) });
  }
  // 다차원 표의 항목 조합 확인용 — statCode/cycle/start/end[/item1[/item2]]
  // 항목을 안 주면 전 조합이 오므로 (코드1,코드2) 조합별 최신값을 요약한다.
  if (raw) {
    if (!/^[A-Za-z0-9/.]+$/.test(raw)) {
      return NextResponse.json({ ok: false, error: "잘못된 raw 경로" });
    }
    const key = process.env.ECOS_API_KEY!;
    const res = await fetch(
      `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/500/${raw}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as Record<string, unknown>;
    const rows =
      ((json.StatisticSearch as { row?: Record<string, string>[] } | undefined)?.row ?? []);
    const combos = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const k = `${r.ITEM_CODE1}|${r.ITEM_CODE2 ?? ""}`;
      combos.set(k, {
        item1: `${r.ITEM_CODE1}=${r.ITEM_NAME1}`,
        item2: `${r.ITEM_CODE2 ?? ""}=${r.ITEM_NAME2 ?? ""}`,
        unit: r.UNIT_NAME ?? "",
        lastTime: r.TIME ?? "",
        lastValue: r.DATA_VALUE ?? "",
      });
    }
    return NextResponse.json({
      ok: true,
      totalRows: rows.length,
      result: (json.RESULT as unknown) ?? null,
      combos: Array.from(combos.values()),
    });
  }

  const supabase = getSupabaseAdmin();
  const now = Date.now();

  const report: Record<string, string> = {};
  let historyRows = 0;
  let updated = 0;

  for (const series of ECOS_SERIES) {
    const res = await fetchEcosSeries(series, now);
    if (!res.ok) {
      report[series.key] = `건너뜀 — ${res.reason}`;
      continue;
    }

    const rows = res.points.map((p) => ({
      key: series.key,
      value: p.value,
      as_of: p.asOf,
      source_host: HOST,
      source_link: null as string | null,
      source_kind: "official",
    }));

    // 중재자는 (key, as_of, value) 전체 유니크 제약.
    // (key, as_of) 부분 인덱스는 PostgREST upsert가 중재자로 쓸 수 없다 —
    // 처음 그렇게 썼다가 폴백이 source_kind를 뗀 채 저장해 ECOS 점들이
    // news로 들어갔다. 실패는 감추지 않고 report로 드러낸다.
    const histErr = (
      await supabase
        .from("indicator_history")
        .upsert(rows, { onConflict: "key,as_of,value", ignoreDuplicates: true })
    ).error;
    if (histErr) {
      report[series.key] = `이력 적재 실패 — ${histErr.message}`;
      continue;
    }
    historyRows += rows.length;

    const last = res.points[res.points.length - 1];
    const current = {
      key: series.key,
      label: series.label,
      unit: series.unit,
      sort_order: series.sortOrder,
      value: String(last.value),
      as_of: last.asOf,
      source_host: HOST,
      source_link: null as string | null,
      source_title: res.statName,
      source_kind: "official",
      updated_at: new Date(now).toISOString(),
    };
    const curErr = (
      await supabase.from("indicators").upsert(current, { onConflict: "key" })
    ).error;
    if (curErr) {
      report[series.key] = `현재값 갱신 실패 — ${curErr.message}`;
      continue;
    }
    updated += 1;
    report[series.key] = `${res.points.length}점 적재 · 최신 ${last.value}${series.unit} (${last.time})`;
  }

  return NextResponse.json({ ok: true, updated, historyRows, report });
}
