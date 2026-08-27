import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { KOSIS_SERIES, fetchKosisSeries, hasKosisKey, kosisRaw } from "@/lib/kosis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 통계청 KOSIS에서 지표 원본 통계를 받아 시계열에 적재한다.
// KOSIS_API_KEY가 없으면 아무 일도 하지 않는다.
//
// 코드 확정용 프로브: ?api=<경로.do>&<파라미터…> 를 KOSIS로 그대로 전달.
//   ?api=statisticsList.do&method=getList&vwCd=MT_ZTITLE&parentListId=...
//   ?api=Param/statisticsParameterData.do&method=getList&orgId=...&tblId=...

const HOST = "kosis.kr";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasKosisKey()) {
    return NextResponse.json({ ok: true, skipped: "KOSIS_API_KEY 미설정" });
  }

  const url = new URL(request.url);
  const api = url.searchParams.get("api");
  if (api) {
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (k !== "api") params[k] = v;
    });
    try {
      return NextResponse.json({ ok: true, api, raw: await kosisRaw(api, params) });
    } catch (e) {
      return NextResponse.json({ ok: false, api, error: (e as Error).message });
    }
  }

  if (KOSIS_SERIES.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "확정된 계열 없음 — ?api= 프로브로 코드를 확인한 뒤 KOSIS_SERIES에 추가",
    });
  }

  const supabase = getSupabaseAdmin();
  const now = Date.now();
  const report: Record<string, string> = {};
  let historyRows = 0;
  let updated = 0;

  for (const series of KOSIS_SERIES) {
    const res = await fetchKosisSeries(series, now);
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
          value: last.value.toLocaleString("ko-KR"),
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
    report[series.key] = `${res.points.length}점 적재 · 최신 ${last.value.toLocaleString("ko-KR")}${series.unit} (${last.time})`;
  }

  return NextResponse.json({ ok: true, updated, historyRows, report });
}
