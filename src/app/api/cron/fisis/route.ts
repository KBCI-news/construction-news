import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { FISIS_SERIES, fetchFisisSeries, fisisRaw, hasFisisKey } from "@/lib/fisis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 금감원 FISIS에서 연체율 원본 통계를 받아 시계열에 적재한다.
// FISIS_API_KEY가 없으면 아무 일도 하지 않는다.
//
// 코드 확정용 프로브: ?api=<API이름>&<파라미터…> 를 FISIS로 그대로 전달해
// 원본 응답을 돌려준다. 예)
//   ?api=statisticsListSearch&lrgDiv=...      통계표 목록
//   ?api=statisticsInfoSearch&listNo=...      통계표의 계정 목록
//   ?api=companySearch&partDiv=...            금융회사(집계 포함) 코드
//   ?api=statisticsDataSearch&financeCd=...   실데이터 확인

const HOST = "fisis.fss.or.kr";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasFisisKey()) {
    return NextResponse.json({
      ok: true,
      skipped: "FISIS_API_KEY 미설정 — 기사 추출 방식을 그대로 사용합니다",
    });
  }

  const url = new URL(request.url);
  const api = url.searchParams.get("api");
  if (api) {
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (k !== "api") params[k] = v;
    });
    try {
      return NextResponse.json({ ok: true, api, raw: await fisisRaw(api, params) });
    } catch (e) {
      return NextResponse.json({ ok: false, api, error: (e as Error).message });
    }
  }

  if (FISIS_SERIES.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "확정된 계열 없음 — ?api= 프로브로 코드를 확인한 뒤 FISIS_SERIES에 추가",
    });
  }

  const supabase = getSupabaseAdmin();
  const now = Date.now();
  const report: Record<string, string> = {};
  let historyRows = 0;
  let updated = 0;

  for (const series of FISIS_SERIES) {
    const res = await fetchFisisSeries(series, now);
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
    const curErr = (
      await supabase.from("indicators").upsert(
        {
          key: series.key,
          label: series.label,
          unit: series.unit,
          sort_order: series.sortOrder,
          value: String(last.value),
          as_of: last.asOf,
          source_host: HOST,
          source_link: null,
          source_title: res.name,
          source_kind: "official",
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "key" },
      )
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
