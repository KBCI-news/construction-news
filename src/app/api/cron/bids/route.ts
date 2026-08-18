import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { BID_MIN_RELEVANCE, matchBid } from "@/lib/bids";
import {
  DEFAULT_WORK_DIVS,
  WORK_DIVS,
  type WorkDiv,
  fetchBidWindow,
  hasG2bKey,
  normalizeBid,
  parseKst,
  probeG2b,
} from "@/lib/g2b";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 나라장터 입찰공고를 1시간 주기로 훑어 우리 사업(문서 전자화·전자문서 보관·
// 임대차조사·권리조사)에 걸리는 공고만 적재한다.
//
// 창(window)을 조회 주기보다 넓게 잡는 이유: GitHub Actions의 스케줄은
// 수 분에서 수십 분까지 밀리고, 공고 등록 시각과 API 색인 시각도 어긋난다.
// 겹쳐 읽어도 bid_key 기준 upsert라 중복이 생기지 않는다.
const DEFAULT_WINDOW_HOURS = 3;
const MAX_WINDOW_HOURS = 24 * 30;

// 진단용:
//   ?probe=1          살아 있는 API 경로와 응답 원형 확인
//   ?test=공고명      API 호출 없이 사전 판정만 확인
//   ?hours=72         과거 소급 수집
//   ?from=&?to=       창을 직접 지정(KST). 긴 구간은 이걸로 잘라서 돌린다
//   ?misses=50        걸리지 않은 공고명 표본 — 사전에 뭘 더 넣을지 정할 때
//   ?divs=용역,물품   업무구분 지정

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const p = request.nextUrl.searchParams;

  // 사전 점검은 키 없이도 돌아야 한다 — 키워드 튜닝이 배포와 분리된다
  const test = p.get("test");
  if (test) {
    return NextResponse.json({ ok: true, title: test, match: matchBid(test) });
  }

  if (!hasG2bKey()) {
    return NextResponse.json({
      ok: true,
      skipped:
        "G2B_SERVICE_KEY 미설정 — 공공데이터포털에서 '조달청_나라장터 입찰공고정보서비스' 키를 발급받아 등록하세요",
    });
  }

  const hours = clamp(Number(p.get("hours") ?? DEFAULT_WINDOW_HOURS), 1, MAX_WINDOW_HOURS);
  const to = parseWindowParam(p.get("to")) ?? new Date();
  const from =
    parseWindowParam(p.get("from")) ?? new Date(to.getTime() - hours * 3_600_000);

  if (from >= to) {
    return NextResponse.json({ ok: false, error: "from이 to보다 나중입니다" }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_HOURS * 3_600_000) {
    return NextResponse.json(
      { ok: false, error: `창이 너무 넓습니다 (최대 ${MAX_WINDOW_HOURS}시간)` },
      { status: 400 },
    );
  }

  const divs = parseDivs(p.get("divs"));

  if (p.get("probe")) {
    return NextResponse.json({
      ok: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      probe: await probeG2b(divs[0], from, to),
    });
  }

  // 사전이 무엇을 놓치는지는 추측이 아니라 실물로 확인해야 한다.
  // 걸리지 않은 공고명을 그대로 돌려주고, 눈으로 보고 사전에 반영한다.
  const missLimit = Number(p.get("misses") ?? 0);
  if (missLimit > 0) {
    const misses: { div: string; title: string; clsfc: string | null }[] = [];
    for (const div of divs) {
      const result = await fetchBidWindow({ workDiv: div, from, to });
      for (const raw of result.rows) {
        const bid = normalizeBid(raw, div);
        if (!bid || matchBid(bid.title).relevance >= BID_MIN_RELEVANCE) continue;
        misses.push({
          div,
          title: bid.title,
          clsfc: typeof raw.pubPrcrmntClsfcNm === "string" ? raw.pubPrcrmntClsfcNm : null,
        });
      }
    }
    return NextResponse.json({
      ok: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      total: misses.length,
      misses: misses.slice(0, Math.min(missLimit, 300)),
    });
  }

  const supabase = getSupabaseAdmin();

  let scanned = 0;
  let matchedCount = 0;
  let upserted = 0;
  const warnings: string[] = [];
  const perDiv: Record<string, { scanned: number; matched: number; total: number }> = {};
  const rowsByKey = new Map<string, Record<string, unknown>>();

  for (const div of divs) {
    const result = await fetchBidWindow({ workDiv: div, from, to });
    if (!result.ok) {
      warnings.push(`${div}: ${result.error ?? "조회 실패"}`);
      perDiv[div] = { scanned: 0, matched: 0, total: 0 };
      continue;
    }
    if (result.truncated) {
      warnings.push(
        `${div}: 창 안의 공고 ${result.totalCount}건 중 ${result.rows.length}건만 읽었습니다 (hours를 줄여 재실행하세요)`,
      );
    }

    let divMatched = 0;
    for (const raw of result.rows) {
      const bid = normalizeBid(raw, div);
      if (!bid) continue;
      scanned += 1;

      const match = matchBid(bid.title);
      if (match.relevance < BID_MIN_RELEVANCE) continue;
      divMatched += 1;

      rowsByKey.set(bid.bidKey, {
        bid_key: bid.bidKey,
        bid_no: bid.bidNo,
        bid_ord: bid.bidOrd,
        title: bid.title,
        work_div: bid.workDiv,
        notice_kind: bid.noticeKind,
        contract_method: bid.contractMethod,
        notice_agency: bid.noticeAgency,
        demand_agency: bid.demandAgency,
        region: bid.region,
        presmpt_price: bid.presmptPrice,
        budget_amount: bid.budgetAmount,
        notice_dt: bid.noticeDt,
        begin_dt: bid.beginDt,
        close_dt: bid.closeDt,
        opening_dt: bid.openingDt,
        detail_url: bid.detailUrl,
        ref_no: bid.refNo,
        areas: match.areas,
        matched_terms: match.terms,
        relevance: match.relevance,
        raw,
        updated_at: new Date().toISOString(),
      });
    }

    matchedCount += divMatched;
    perDiv[div] = { scanned: result.rows.length, matched: divMatched, total: result.totalCount };
  }

  const rows = Array.from(rowsByKey.values());
  let failure: string | null = null;

  if (rows.length > 0) {
    const { error, count } = await supabase
      .from("bids")
      .upsert(rows, { onConflict: "bid_key", count: "exact" });
    if (error) failure = `저장 실패: ${error.message}`;
    else upserted = count ?? rows.length;
  }

  // 실행 이력은 화면에 "마지막 확인 시각"으로 노출된다. 0건이어도 남겨야
  // '공고가 없는 것'과 '수집이 멈춘 것'을 구분할 수 있다.
  const ok = !failure && warnings.length === 0;
  const detail = [failure, ...warnings].filter(Boolean).join(" / ") || null;
  await supabase.from("bid_runs").insert({
    window_from: from.toISOString(),
    window_to: to.toISOString(),
    scanned,
    matched: matchedCount,
    upserted,
    ok,
    detail,
  });

  await supabase.rpc("purge_old_bids");

  if (failure) {
    return NextResponse.json({ ok: false, error: failure, scanned, matched: matchedCount }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    window: { from: from.toISOString(), to: to.toISOString(), hours },
    divs,
    scanned,
    matched: matchedCount,
    upserted,
    perDiv,
    ...(warnings.length ? { warnings } : {}),
  });
}

/**
 * 창 경계 파라미터. 타임존이 붙은 ISO는 그대로 읽고, 그 외에는 KST로 읽는다
 * (나라장터 공고 시각이 KST라 담당자가 KST로 적는 게 자연스럽다).
 */
function parseWindowParam(value: string | null): Date | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = parseKst(value);
  return iso ? new Date(iso) : null;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}

function parseDivs(raw: string | null): WorkDiv[] {
  if (!raw) return DEFAULT_WORK_DIVS;
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is WorkDiv => Object.prototype.hasOwnProperty.call(WORK_DIVS, s));
  return wanted.length ? wanted : DEFAULT_WORK_DIVS;
}
