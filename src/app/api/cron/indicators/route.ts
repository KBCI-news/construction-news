import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractIndicators } from "@/lib/indicators";
import { sourceTier } from "@/lib/lexicon";
import { officialIndicatorKeys } from "@/lib/indicator-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 지표 시계열을 아카이브에서 소급 생성한다.
// 30분 크론이 새 기사만 훑으면 이력이 한 점밖에 쌓이지 않아 추이 차트를
// 그릴 수 없다. 이 엔드포인트는 보관 중인 30일치를 전부 훑어 점을 채운다.
const WINDOW_DAYS = 30;
const PAGE = 1000;
const MAX_ROWS = 6000;

type Row = {
  link: string;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
};

const KEYWORD_FILTER = [
  "title.ilike.%연체율%",
  "description.ilike.%연체율%",
  "title.ilike.%기준금리%",
  "description.ilike.%기준금리%",
].join(",");

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("articles")
      .select("link,title,description,pub_date,source_host")
      .gte("pub_date", since)
      .or(KEYWORD_FILTER)
      .order("pub_date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json(
        { error: "Failed to read articles", detail: error.message },
        { status: 500 },
      );
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // 지표 × 날짜(KST) 단위로 하루 한 점만 남긴다 — 같은 수치의 중복 보도가 많다
  const points = new Map<
    string,
    { key: string; value: number; asOf: string; host: string | null; link: string }
  >();

  // 기관 원본으로 채워지는 지표는 기사 추출 점을 섞지 않는다
  const official = await officialIndicatorKeys(supabase);

  for (const r of rows) {
    if (sourceTier(r.source_host) < 0.8) continue;
    for (const hit of extractIndicators(r.title, r.description)) {
      if (official.has(hit.key)) continue;
      const value = Number(hit.value.replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      const d = new Date(r.pub_date);
      if (Number.isNaN(d.getTime())) continue;
      const kst = new Date(d.getTime() + 9 * 3_600_000);
      const day = kst.toISOString().slice(0, 10);
      const bucket = `${hit.key}|${day}`;
      // 같은 날 여러 보도가 있으면 가장 최신 기사를 쓴다 (rows는 최신순)
      if (!points.has(bucket)) {
        points.set(bucket, {
          key: hit.key,
          value,
          asOf: r.pub_date,
          host: r.source_host,
          link: r.link,
        });
      }
    }
  }

  const list = Array.from(points.values());
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK).map((p) => ({
      key: p.key,
      value: p.value,
      as_of: p.asOf,
      source_host: p.host,
      source_link: p.link,
    }));
    const { error } = await supabase
      .from("indicator_history")
      .upsert(chunk, { onConflict: "key,as_of,value", ignoreDuplicates: true });
    if (!error) inserted += chunk.length;
  }

  // 각 지표의 최신 값을 현재 값으로 반영
  const latest = new Map<string, (typeof list)[number]>();
  for (const p of list) {
    const cur = latest.get(p.key);
    if (!cur || new Date(p.asOf) > new Date(cur.asOf)) latest.set(p.key, p);
  }
  let updated = 0;
  for (const [key, p] of latest) {
    const { error } = await supabase
      .from("indicators")
      .update({
        value: String(p.value),
        as_of: p.asOf,
        source_host: p.host,
        source_link: p.link,
        updated_at: new Date().toISOString(),
      })
      .eq("key", key);
    if (!error) updated += 1;
  }

  const perKey: Record<string, number> = {};
  for (const p of list) perKey[p.key] = (perKey[p.key] ?? 0) + 1;

  return NextResponse.json({
    ok: true,
    scannedArticles: rows.length,
    points: list.length,
    perKey,
    inserted,
    updated,
  });
}
