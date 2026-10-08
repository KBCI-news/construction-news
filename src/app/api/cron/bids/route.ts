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
  searchBids,
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
// 지난 회차가 늦게 돌았으면 그 끝까지 거슬러 올라가 빈틈을 메운다(상한 12시간).
// GitHub Actions 스케줄은 매시간이지만 실제로는 2~6.5시간씩 밀렸고(14일간 66회 중
// 58회), 3시간 창으로는 전체 시간의 41%(138시간)가 한 번도 스캔되지 않았다 —
// 새마을금고중앙회 채권추심 위임 재공고(10/2)가 그 틈에 빠졌다.
const CATCHUP_MAX_HOURS = 12;
const CATCHUP_OVERLAP_MS = 10 * 60_000;

// 진단용:
//   ?probe=1          살아 있는 API 경로와 응답 원형 확인
//   ?test=공고명      API 호출 없이 사전 판정만 확인
//   ?hours=72         과거 소급 수집
//   ?from=&?to=       창을 직접 지정(KST). 긴 구간은 이걸로 잘라서 돌린다
//   ?misses=50        걸리지 않은 공고명 표본 — 사전에 뭘 더 넣을지 정할 때
//   ?clsfc=1          조달청 분류명 빈도표 — 어느 분류를 사전에 넣을지 고를 때
//   ?divs=용역,물품   업무구분 지정
//   ?search=추심&agency=한국자산관리공사&months=12
//                     공고명·수요기관으로 과거 공고 검색 (기관이 그 사업을 낸 적이 있는지)

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
  let from =
    parseWindowParam(p.get("from")) ?? new Date(to.getTime() - hours * 3_600_000);
  let catchupFrom: string | null = null;
  // 기본 창(파라미터 없음)일 때만 — 지난 성공 회차의 창 끝에 이어 붙인다
  if (!p.get("from") && !p.get("hours") && !p.get("to")) {
    try {
      const { data: last } = await getSupabaseAdmin()
        .from("bid_runs")
        .select("window_to")
        .eq("ok", true)
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastTo = last?.window_to ? new Date(last.window_to as string).getTime() : NaN;
      if (Number.isFinite(lastTo)) {
        const floor = to.getTime() - CATCHUP_MAX_HOURS * 3_600_000;
        const wanted = lastTo - CATCHUP_OVERLAP_MS;
        if (wanted < from.getTime()) {
          from = new Date(Math.max(wanted, floor));
          catchupFrom = from.toISOString();
        }
      }
    } catch {
      /* 이력 조회 실패 — 기본 창으로 */
    }
  }

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

  // 공고명·수요기관 검색 — 서버가 걸러 주므로 몇 달치를 한 번에 본다.
  // 검색창은 1개월씩만 받아 주므로 30일 단위로 거슬러 돈다.
  const search = p.get("search")?.trim();
  const agency = p.get("agency")?.trim();
  if (search || agency) {
    const started = Date.now();
    const months = clamp(Number(p.get("months") ?? 12), 1, 36);
    const seen = new Map<string, ReturnType<typeof normalizeBid>>();
    const errors: string[] = [];
    let windows = 0;
    let truncatedWindows = 0;
    outer: for (const div of divs) {
      for (let i = 0; i < months; i++) {
        if (Date.now() - started > 50_000) {
          errors.push(`시간 예산 초과 — ${div} ${i}개월까지만 봤습니다`);
          break outer;
        }
        const wTo = new Date(to.getTime() - i * 30 * 86_400_000);
        const wFrom = new Date(wTo.getTime() - 30 * 86_400_000 + 60_000);
        const r = await searchBids({
          workDiv: div,
          from: wFrom,
          to: wTo,
          keyword: search || undefined,
          agency: agency || undefined,
        });
        windows += 1;
        if (!r.ok) {
          errors.push(`${div} ${wFrom.toISOString().slice(0, 10)}~: ${r.error ?? "조회 실패"}`);
          continue;
        }
        if (r.truncated) truncatedWindows += 1;
        for (const raw of r.rows) {
          const bid = normalizeBid(raw, div);
          if (bid && !seen.has(bid.bidKey)) seen.set(bid.bidKey, bid);
        }
      }
    }
    const items = Array.from(seen.values())
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .sort((a, b) => (b.noticeDt ?? "").localeCompare(a.noticeDt ?? ""))
      .map((b) => ({
        title: b.title,
        demandAgency: b.demandAgency,
        noticeAgency: b.noticeAgency,
        noticeDt: b.noticeDt,
        closeDt: b.closeDt,
        presmptPrice: b.presmptPrice,
        budgetAmount: b.budgetAmount,
        match: matchBid({ title: b.title }).areas,
        url: b.detailUrl,
      }));
    return NextResponse.json({
      ok: true,
      search: search ?? null,
      agency: agency ?? null,
      months,
      windows,
      truncatedWindows,
      total: items.length,
      items,
      errors,
    });
  }

  if (p.get("probe")) {
    return NextResponse.json({
      ok: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      probe: await probeG2b(divs[0], from, to),
    });
  }

  // 조달청 분류명은 공고명보다 정직하다. 어떤 분류가 실제로 존재하는지
  // 세어 보고, 우리 사업에 해당하는 분류를 사전(classes)에 등록한다.
  if (p.get("clsfc")) {
    const tally = new Map<string, number>();
    for (const div of divs) {
      const result = await fetchBidWindow({ workDiv: div, from, to });
      for (const raw of result.rows) {
        for (const name of classesOf(raw)) {
          const key = `${div} | ${name}`;
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
    }
    const sorted = Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    return NextResponse.json({
      ok: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      distinct: sorted.length,
      classes: sorted.slice(0, 400),
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
        if (!bid) continue;
        if (matchBid({ title: bid.title, classes: classesOf(raw) }).relevance >= BID_MIN_RELEVANCE) {
          continue;
        }
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

      const match = matchBid({ title: bid.title, classes: classesOf(raw) });
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
    ...(catchupFrom ? { catchupFrom } : {}),
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
 * 조달청 분류명 3단(대·중·품목)을 그대로 뽑는다. 오퍼레이션마다 채워지는
 * 항목이 달라 있는 것만 쓴다.
 */
function classesOf(raw: Record<string, unknown>): string[] {
  return ["pubPrcrmntLrgClsfcNm", "pubPrcrmntMidClsfcNm", "pubPrcrmntClsfcNm"]
    .map((k) => raw[k])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
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
