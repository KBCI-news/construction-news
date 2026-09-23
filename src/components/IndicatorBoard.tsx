"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Indicator } from "@/app/api/indicators/route";
import { ECOS_SERIES } from "@/lib/ecos";
import { KOSIS_SERIES } from "@/lib/kosis";

// ---------------------------------------------------------------------------
// 구성
// ---------------------------------------------------------------------------

type Group = { title: string; sub?: string; keys: string[] };

const GROUPS: Group[] = [
  {
    title: "연체율",
    sub: "1개월 이상 갚지 못한 대출의 비율",
    keys: ["household_delinq", "corp_delinq", "bank_card_delinq", "bank_delinq"],
  },
  { title: "금리", sub: "정책금리와 은행 대출금리", keys: ["base_rate", "household_loan_rate"] },
  { title: "가계부채", sub: "가계가 진 빚의 전체 규모", keys: ["household_credit"] },
  // 물가는 아래 publishable()에서 걸러질 수 있어 환율과 한 묶음으로 두지 않는다
  { title: "물가", sub: "생활비가 오르는 속도", keys: ["cpi_yoy"] },
  { title: "환율", sub: "달러 대비 원화 가치", keys: ["usd_krw"] },
];

const delinqDesc = (kind: string) =>
  `은행 ${kind} 가운데 1개월 이상 연체된 대출의 비율입니다.`;

const DESC: Record<string, string> = {
  base_rate: "한국은행 금융통화위원회가 정하는 정책금리입니다.",
  household_loan_rate: "예금은행이 새로 내준 가계대출의 평균 금리입니다. (신규취급액 기준)",
  household_delinq: delinqDesc("가계대출"),
  corp_delinq: delinqDesc("기업대출"),
  bank_card_delinq: delinqDesc("신용카드대출"),
  bank_delinq: "기사에 보도된 국내 은행 대출 연체율입니다.",
  household_credit: "가계대출과 판매신용(카드 할부 구매 등)을 합한 가계 빚 총액입니다.",
  cpi_yoy: "소비자물가지수가 1년 전 같은 달보다 오른 비율입니다.",
  usd_krw:
    "1달러를 사고팔 때 기준이 되는 원화 가격(매매기준율)입니다. 숫자가 클수록 원화 값이 낮다는 뜻입니다.",
};

/** 값 자체가 이미 비교치인 계열 — 옆의 "전월 대비"와 헷갈리지 않게 기준을 밝힌다 */
const QUALIFIER: Record<string, string> = { cpi_yoy: "전년 동월 대비" };

/** 결정일에만 바뀌는 계열 — 점 사이를 사선으로 이으면 없던 중간값이 생긴다 */
const STEP_KEYS = new Set(["base_rate"]);

/** 세로축 최소 폭 — 0.4→0.5 같은 작은 변동이 급등처럼 보이지 않게 */
const MIN_SPAN: Record<string, number> = { "%": 1, 원: 100, 조원: 200 };

/**
 * 한국은행(ECOS)이 소수 첫째 자리로 반올림해 내놓는 계열. 공식 발표(금융감독원)는
 * 둘째 자리라, 반올림된 두 값의 차이로는 변동 폭을 말할 수 없다
 * (예: 5월 0.84% → 6월 0.68%는 ▼0.16%p인데 ECOS 값으로는 0.8 → 0.7).
 * 방향은 반올림해도 뒤집히지 않으므로 방향만 말한다.
 */
const ROUNDED_KEYS = new Set(["household_delinq", "corp_delinq", "bank_card_delinq"]);

/**
 * daily    하루 값 (환율)
 * monthEnd 하루 값을 달마다 마지막 날로 추린 계열 (기준금리) — 끝 점만 가장 최근 날
 * monthly  월 통계 (그달 1일에 저장)
 * quarterly 분기 통계 (분기 첫날에 저장)
 * irregular 기사 보도, 또는 주기를 모르는 계열
 */
type Cad = "daily" | "monthEnd" | "monthly" | "quarterly" | "irregular";

const CADENCE_TEXT: Partial<Record<Cad | "news", string>> = {
  daily: "매일 (영업일)",
  monthEnd: "매일 (그래프는 달마다 한 점)",
  monthly: "매월",
  quarterly: "분기마다",
  news: "기사 보도 때마다",
};

const ECOS_BY_KEY = new Map(ECOS_SERIES.map((s) => [s.key, s]));

/** 한국은행(ECOS)에서 받은 지표의 수집 설정 — 같은 키를 다른 기관에서 받을 수도 있어 출처를 함께 본다 */
const ecosSeriesOf = (it: Indicator) =>
  it.sourceKind === "official" && it.sourceLabel === "한국은행" ? ECOS_BY_KEY.get(it.key) : undefined;

/**
 * 원본 계열의 발표 주기. 점 간격으로 짐작하면 점이 한두 개뿐일 때(추이 조회 실패 포함)
 * 저장 날짜("6월 1일", 분기면 첫 달)가 그대로 기준일로 찍힌다.
 */
const KOSIS_BY_KEY = new Map(KOSIS_SERIES.map((s) => [s.key, s]));

/** 국가데이터처(KOSIS)에서 받은 지표 — 출처 표기는 /api/indicators의 OFFICIAL_HOSTS와 같아야 한다 */
const kosisSeriesOf = (it: Indicator) =>
  it.sourceKind === "official" && it.sourceLabel === "국가데이터처"
    ? KOSIS_BY_KEY.get(it.key)
    : undefined;

function knownCadence(it: Indicator): Cad | null {
  const s = ecosSeriesOf(it);
  if (s) {
    if (s.cycle === "D") return s.downsample === "month" ? "monthEnd" : "daily";
    if (s.cycle === "M") return "monthly";
    if (s.cycle === "Q") return "quarterly";
    return null;
  }
  // KOSIS도 ECOS와 같이 기간 첫날에 저장한다(kosisPeriodToIso)
  const k = kosisSeriesOf(it);
  if (k?.prdSe === "M") return "monthly";
  if (k?.prdSe === "Q") return "quarterly";
  return null;
}

/**
 * 싣지 않는 지표. ECOS 지수에서 우리가 계산한 전년동월비(transform: "yoy")는
 * 소수 둘째 자리 지수로 다시 계산해 반올림한 값이라 발표 상승률과 0.1%p씩
 * 어긋나는 달이 있다(2024.10 계산 1.2 / 발표 1.3). 소비자물가 상승률은 이제
 * 국가데이터처 발표 등락률(KOSIS)로 받으므로 걸리지 않는다 — 전환 직후
 * DB에 ECOS 값이 남아 있는 동안만 이 규칙이 가린다.
 */
const publishable = (it: Indicator) => ecosSeriesOf(it)?.transform !== "yoy";

// ---------------------------------------------------------------------------
// 데이터 준비 — 규칙마다 "틀린 숫자를 보여주지 않기" 위한 것이다
// ---------------------------------------------------------------------------

type Day = { t: number; y: number; m: number; d: number };
type Pt = Day & { value: number };
type Report = Pt & { lastT: number; count: number; conflict: boolean };
type SeqPt = Pt & { lastT?: number; count?: number; conflict?: boolean };
type Dir = "up" | "down" | "flat";

type Change = {
  prev: Pt;
  last: Pt;
  diff: number;
  dir: Dir;
  unitD: string;
  word: string;
  /** 비교 대상 이름 — "전월", "8월 말", "직전 보도" */
  prevName: string;
  /** prevName + " 대비" */
  basis: string;
  /** 반올림된 원자료라 변동 폭을 말하지 않는다 (ROUNDED_KEYS) */
  coarse: boolean;
};

type Prepared = {
  key: string;
  label: string;
  unit: string;
  news: boolean;
  sourceLabel: string;
  cad: Cad;
  dec: number;
  valueText: string;
  /** 가장 최근 보도의 기사끼리 수치가 엇갈려 큰 숫자를 싣지 않는다 */
  valueHidden: boolean;
  meta: string;
  /** 그래프에 그리는 점 (기사끼리 수치가 엇갈린 보도는 뺀다) */
  pts: Pt[];
  /** 표에 싣는 전체 시점 (기사 계열은 엇갈린 보도도 포함) */
  seq: SeqPt[];
  /** 가장 최근 보도가 그래프에서 빠졌으면 그 보도 */
  droppedLatest: SeqPt | null;
  change: Change | null;
  note: string;
  coarse: boolean;
  refYear: number;
  multiYear: boolean;
  /** 그래프·표의 점이 무엇인지 (달마다 마지막 날 값 등) */
  pointNote: string;
};

const DAY_MS = 86_400_000;

function kstAt(t: number): Day {
  const k = new Date(t + 9 * 3_600_000);
  return { t, y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}

function kstParts(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? kstAt(t) : null;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const sameDate = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;

function decimalsOf(v: number | string | null): number {
  const n = Number(v);
  if (v === null || !Number.isFinite(n)) return 0;
  const s = String(Number(n.toPrecision(12)));
  if (s.includes("e")) return 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

const fmtNum = (v: number, dec: number) =>
  v.toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** 받침 유무로 과/와 — 숫자로 끝나면 한국어 읽기(일·이·삼…) 기준 */
function josaGwa(word: string): "과" | "와" {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? "과" : "와";
  if (/[0-9]/.test(ch)) return "2459".includes(ch) ? "와" : "과";
  return "와";
}

type WhenOpts = { refYear?: number; multiYear?: boolean };

/**
 * 시점 이름. 월별 통계는 ECOS 관례대로 그달 1일(KST)에 저장돼 있어
 * "2026.06.01"처럼 찍으면 하루치 값처럼 읽힌다 — 월·분기 이름으로 바꾼다.
 */
function when(
  p: Day,
  cad: Cad,
  style: "long" | "short" | "basis" = "long",
  o: WhenOpts = {},
): string {
  const yr =
    style === "short"
      ? `${String(p.y).slice(2)}년 `
      : style === "basis" && p.y === o.refYear
        ? ""
        : `${p.y}년 `;
  const monthEnd = p.d === lastDay(p.y, p.m);
  if (cad === "quarterly") {
    if (p.d === 1 && p.m % 3 === 1) return `${yr}${(p.m + 2) / 3}분기`;
    if (monthEnd && p.m % 3 === 0) return `${yr}${p.m / 3}분기 말`;
  }
  // monthEnd 계열은 하루 값이다 — 1일 값을 "10월"이라 부르면 그달 전체처럼 읽힌다
  if (cad === "monthly" && p.d === 1) return `${yr}${p.m}월`;
  if ((cad === "monthly" || cad === "monthEnd") && monthEnd) {
    return style === "short" ? `${yr}${p.m}월` : `${yr}${p.m}월 말`;
  }
  return `${style === "short" && !o.multiYear ? "" : yr}${p.m}월 ${p.d}일`;
}

/**
 * 같은 보도를 여러 매체가 며칠에 걸쳐 싣는다 — 7일 안에 이어진 기사는 한 보도로 묶는다.
 * 묶음 안에서 수치가 엇갈리면 어느 쪽이 맞는지 알 수 없으므로 conflict로 표시한다.
 */
function groupNews(pts: Pt[]): Report[] {
  const out: Report[] = [];
  let g: Report | null = null;
  for (const p of pts) {
    if (!g || p.t - g.lastT > 7 * DAY_MS) {
      g = { ...p, lastT: p.t, count: 1, conflict: false };
      out.push(g);
    } else {
      g.count++;
      g.lastT = p.t;
      if (p.value !== g.value) g.conflict = true;
    }
  }
  return out;
}

function inferCadence(pts: Day[]): Cad {
  if (pts.length < 2) return "irregular";
  const gaps = pts
    .slice(1)
    .map((p, i) => (p.t - pts[i].t) / DAY_MS)
    .sort((a, b) => a - b);
  const h = gaps.length >> 1;
  const med = gaps.length % 2 ? gaps[h] : (gaps[h - 1] + gaps[h]) / 2;
  if (med <= 5) return "daily";
  if (med >= 26 && med <= 35) return "monthly";
  if (med >= 80 && med <= 100) return "quarterly";
  return "irregular";
}

/** 비교 대상의 이름 ("전월", "8월 말", "직전 보도") — 뒤에 "대비"·"보다" 등을 붙여 쓴다 */
function prevNameOf(prev: Pt, last: Pt, cad: Cad, news: boolean): string {
  if (news) return "직전 보도";
  // 주기를 모르면 저장 날짜를 하루 단위로 찍지 않는다
  if (cad === "irregular") return "직전 값";
  if (cad === "daily" && Math.round((last.t - prev.t) / DAY_MS) <= 4) return "전일";
  const isEnd = (p: Pt) => p.d === lastDay(p.y, p.m);
  const mi = (p: Pt) => p.y * 12 + p.m;
  if (cad === "monthEnd" && isEnd(prev) && isEnd(last) && mi(last) - mi(prev) === 1) {
    return "전월 말";
  }
  const anchor = (p: Pt) => (p.d === 1 ? "first" : isEnd(p) ? "end" : null);
  if (cad === "monthly") {
    const a = anchor(last);
    if (a && a === anchor(prev) && mi(last) - mi(prev) === 1) return "전월";
  }
  if (cad === "quarterly") {
    const qa = (p: Pt) =>
      p.d === 1 && p.m % 3 === 1 ? "first" : isEnd(p) && p.m % 3 === 0 ? "end" : null;
    const qi = (p: Pt) => p.y * 4 + Math.floor((p.m - 1) / 3);
    const a = qa(last);
    if (a && a === qa(prev) && qi(last) - qi(prev) === 1) return "전분기";
  }
  return when(prev, cad, "basis", { refYear: last.y });
}

const headOf = (it: Indicator) =>
  it.value !== null && it.value.trim() !== "" ? Number(it.value) : NaN;

/** 헤드라인 값이 추이의 마지막 점과 같은 값·같은 날인지 — 아니면 증감을 말하지 않는다 */
function headMatches(it: Indicator, last: SeqPt): boolean {
  const head = headOf(it);
  if (!Number.isFinite(head) || Math.abs(head - last.value) > 1e-9) return false;
  const at = kstParts(it.asOf);
  return !at || sameDate(at, kstAt(last.lastT ?? last.t));
}

function changeOf(
  it: Indicator,
  seq: SeqPt[],
  cad: Cad,
  dec: number,
  unit: string,
  news: boolean,
  coarse: boolean,
): { change: Change | null; note: string } {
  if (seq.length < 2) return { change: null, note: "비교할 이전 값 없음" };
  const last = seq[seq.length - 1];
  const prev = seq[seq.length - 2];
  if (last.conflict || prev.conflict) {
    return { change: null, note: "기사마다 수치가 달라 비교하지 않음" };
  }
  if (!headMatches(it, last)) return { change: null, note: "이전 값과 비교할 수 없음" };

  const diff = Number((last.value - prev.value).toFixed(dec));
  const dir: Dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const stock = unit === "조원" || it.label.includes("잔액");
  const word =
    dir === "flat"
      ? "변동 없음"
      : stock
        ? dir === "up"
          ? "증가"
          : "감소"
        : dir === "up"
          ? "상승"
          : "하락";
  const prevName = prevNameOf(prev, last, cad, news);
  return {
    change: {
      prev,
      last,
      diff,
      dir,
      unitD: unit === "%" ? "%p" : unit,
      word,
      prevName,
      basis: `${prevName} 대비`,
      coarse,
    },
    note: "",
  };
}

function prepare(it: Indicator): Prepared {
  const news = it.sourceKind === "news";
  const unit = it.unit ?? "";
  const raw: Pt[] = (it.history ?? [])
    .map((h) => {
      const k = kstParts(h.asOf);
      const value = Number(h.value);
      return k && Number.isFinite(value) ? { ...k, value } : null;
    })
    .filter((p): p is Pt => p !== null)
    .sort((a, b) => a.t - b.t);

  const reports = news ? groupNews(raw) : null;
  const seq: SeqPt[] = reports ?? raw;
  const pts: Pt[] = reports ? reports.filter((r) => !r.conflict) : raw;
  // 주기는 수집 설정에서 받는다. 모르는 계열만 점 간격으로 짐작하고,
  // 그래도 모르면(irregular) 기준일을 하루 단위로 찍지 않는다
  const cad: Cad = news ? "irregular" : (knownCadence(it) ?? inferCadence(pts));
  const dec = Math.min(3, Math.max(decimalsOf(it.value), ...pts.map((p) => decimalsOf(p.value))));
  const coarse = !news && ROUNDED_KEYS.has(it.key) && dec < 2;

  const lastSeq = seq[seq.length - 1];
  // 가장 최근 보도의 기사끼리 수치가 엇갈리면 어느 쪽도 큰 숫자로 싣지 않는다
  const valueHidden = news && Boolean(lastSeq?.conflict);
  const head = headOf(it);
  const valueText = valueHidden
    ? "기사마다 다름"
    : Number.isFinite(head)
      ? fmtNum(head, dec)
      : (it.value ?? "—");
  const { change, note } = changeOf(it, seq, cad, dec, unit, news, coarse);

  let meta = "";
  if (news) {
    const at = lastSeq && headMatches(it, lastSeq) ? lastSeq : (kstParts(it.asOf) ?? lastSeq);
    // 보도일일 뿐 몇 월 말 기준 수치인지는 기사마다 다르다 (줄이 바뀌어도 한 덩어리로)
    if (at) meta = `${when(at, "irregular")} 보도 · 기준 시점 미확인`;
  } else if (cad === "irregular") {
    meta = "기준 시점 미확인";
  } else {
    const at = kstParts(it.asOf) ?? pts[pts.length - 1];
    if (at) meta = `${when(at, cad)} 기준`;
  }
  if (!news && QUALIFIER[it.key]) meta += `${meta ? " · " : ""}${QUALIFIER[it.key]}`;

  const lastPt = pts[pts.length - 1];
  const refYear = (lastSeq ?? lastPt)?.y ?? 0;

  let pointNote = "";
  if (cad === "monthEnd" && lastPt) {
    pointNote =
      lastPt.d === lastDay(lastPt.y, lastPt.m)
        ? "그래프와 표는 달마다 마지막 날 값입니다."
        : `그래프와 표는 달마다 마지막 날 값이고, 맨 끝 점만 가장 최근 날(${when(lastPt, "daily", "basis", { refYear })}) 값입니다.`;
  } else if (cad === "monthly" && pts.some((p) => p.d !== 1 && p.d === lastDay(p.y, p.m))) {
    pointNote = "그래프와 표는 달마다 마지막 날 값을 씁니다.";
  }

  return {
    key: it.key,
    label: it.label,
    unit,
    news,
    sourceLabel: it.sourceLabel,
    cad,
    dec,
    valueText,
    valueHidden,
    meta,
    pts,
    seq,
    droppedLatest: lastSeq && lastPt && lastSeq.t !== lastPt.t ? lastSeq : null,
    change,
    note,
    coarse,
    refYear,
    multiYear: pts.length > 1 && pts[0].y !== lastPt.y,
    pointNote,
  };
}

/** 헤더가 실제로 화면 위에 붙어 있는지. sticky여도 조상에 overflow가 걸리면 같이 스크롤돼 사라진다 */
function headerPinned(h: HTMLElement): boolean {
  const cs = getComputedStyle(h);
  if (cs.position === "fixed") return true;
  if (cs.position !== "sticky") return false;
  const r = h.getBoundingClientRect();
  if (r.bottom <= 0) return false; // 이미 스크롤돼 사라졌다
  // 헤더 높이보다 더 내려왔는데 sticky top 자리에 있다 — top을 음수로 둬 GNB만 붙는 헤더도 '붙어 있음'
  if (window.scrollY > r.height + 1) return Math.abs(r.top - (parseFloat(cs.top) || 0)) < 1;
  // 아직 맨 위 근처라 위치로는 알 수 없다 — 조상 중 스크롤 컨테이너가 있으면 붙지 않는다
  const root = document.documentElement;
  const clips = (el: Element) => {
    const s = getComputedStyle(el);
    return /auto|scroll|hidden/.test(`${s.overflowX} ${s.overflowY}`);
  };
  const rootClips = clips(root);
  for (let el = h.parentElement; el && el !== root; el = el.parentElement) {
    // html이 visible이면 body의 overflow는 body가 아니라 뷰포트에 적용된다
    if (el === document.body && !rootClips) continue;
    if (clips(el)) return false;
  }
  return true;
}

/** 화면 위쪽에서 고정 헤더가 가리는 높이 (헤더가 같이 스크롤되면 0) */
function coveredTop(): number {
  const h = document.querySelector("header");
  if (!h || !headerPinned(h)) return 0;
  return Math.max(0, h.getBoundingClientRect().bottom);
}

/** 보기 좋은 눈금 간격 (1·2·2.5·5 × 10^n) */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

/** 라벨 충돌 판정용 대략 폭 */
function estW(s: string, px: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 0xac00 && c <= 0xd7a3 ? px * 0.95 : ch === " " || ch === "," || ch === "." ? px * 0.3 : px * 0.6;
  }
  return w;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(320);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cw = Math.floor(el.clientWidth);
      if (cw > 0) setW(cw);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// 아이콘
// ---------------------------------------------------------------------------

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-200 ${up ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5l5 5 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <rect
        x="3"
        y="4.5"
        width="14"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true" className="block text-gray-400">
    <path
      d="M4 11h13M12.5 6.5L17 11l-4.5 4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const RingMark = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <circle cx="6" cy="6" r="4" fill="#fff" stroke="#B98A10" strokeWidth="2" />
  </svg>
);

const DotMark = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <circle cx="6" cy="6" r="5" fill="#B98A10" />
  </svg>
);

const DIR_TEXT: Record<Dir, string> = {
  up: "text-rose-700",
  down: "text-blue-700",
  flat: "text-gray-800",
};

function DeltaText({ c, dec }: { c: Change; dec: number }) {
  if (c.dir === "flat") {
    return <span className="text-[15px] font-bold text-gray-800">변동 없음</span>;
  }
  return (
    <span className={`whitespace-nowrap text-[15px] font-bold tabular-nums ${DIR_TEXT[c.dir]}`}>
      <span aria-hidden="true">{c.dir === "up" ? "▲" : "▼"}</span> {fmtNum(Math.abs(c.diff), dec)}
      {c.unitD} {c.word}
    </span>
  );
}

/** 목록 줄의 비교 문구. 반올림된 계열은 폭 대신 두 값을 보여 준다 */
function RowChange({ c, p }: { c: Change; p: Prepared }) {
  const v = (q: Pt) => `${fmtNum(q.value, p.dec)}${p.unit}`;
  if (!c.coarse) {
    return (
      <>
        <span className="text-[14px] text-gray-600">{c.basis}</span>
        <DeltaText c={c} dec={p.dec} />
      </>
    );
  }
  if (c.dir === "flat") {
    return (
      <>
        <span className="text-[14px] text-gray-600">
          {c.prevName}
          {josaGwa(c.prevName)}
        </span>
        <span className="text-[15px] font-bold tabular-nums text-gray-800">같은 {v(c.last)}</span>
      </>
    );
  }
  return (
    <>
      <span className="text-[14px] tabular-nums text-gray-600">
        {c.prevName} {v(c.prev)}보다
      </span>
      <span className={`whitespace-nowrap text-[15px] font-bold ${DIR_TEXT[c.dir]}`}>
        <span aria-hidden="true">{c.dir === "up" ? "▲" : "▼"}</span> {c.word}
      </span>
    </>
  );
}

const ROUNDED_NOTE =
  "한국은행 통계는 소수 첫째 자리까지만 나와 실제 변동 폭(금감원 발표)과 다를 수 있습니다.";

// ---------------------------------------------------------------------------
// 추이 차트 — 빈 칸 없는 눈금·단위, 비교한 두 점 표시, 누른 시점 값은 위 칸에
// ---------------------------------------------------------------------------

const H = 196;
const PT = 30;
const PB = 30;
/** 이만큼 움직이기 전까지는 탭으로 본다 */
const TAP_SLOP = 10;
/** 비교한 직전 점(링)과 최근 점이 겹치지 않을 최소 가로 간격 */
const MIN_LAST_GAP = 18;

type Gesture = { id: number; x: number; y: number; before: number | null; scrub: boolean };

function TrendChart({ p, open }: { p: Prepared; open: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(boxRef);
  const [sel, setSel] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);

  // 다시 펼치면 언제나 "가장 최근 값"부터 — 지난번(대개 실수로 누른) 선택을 들고 오지 않는다
  useEffect(() => {
    if (!open) {
      setSel(null);
      gesture.current = null;
    }
  }, [open]);

  const { pts, unit, dec, cad, news } = p;
  const n = pts.length;
  const last = pts[n - 1];
  const vals = pts.map((q) => q.value);
  const rMin = Math.min(...vals);
  const rMax = Math.max(...vals);

  const span = Math.max((rMax - rMin) * 1.3, MIN_SPAN[unit] ?? (Math.abs(rMax) * 0.1 || 1));
  const mid = (rMax + rMin) / 2;
  let lo = mid - span / 2;
  let hi = mid + span / 2;
  if (rMin >= 0 && lo < span) {
    // 0부터 그릴 때 위 여백은 실제 최고값 기준 — 가운데 기준이면 윗부분이 텅 빈다
    lo = 0;
    hi = Math.max(rMax + (rMax - rMin) * 0.15, span);
  }
  const step = niceStep(span / 3);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const tickCount = Math.round((hi - lo) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Number((lo + i * step).toFixed(8)));
  const tickDec = decimalsOf(step);
  const shortUnit = unit === "조원" ? "조" : unit;
  const tickLabel = (v: number) => (Math.abs(v) < 1e-12 ? "0" : `${fmtNum(v, tickDec)}${shortUnit}`);

  const endLabel = `${fmtNum(last.value, dec)}${unit}`;
  const GL = Math.max(...ticks.map((t) => tickLabel(t).length)) * 7.5 + 12;
  const GR = endLabel.length * 8.5 + 16;
  const x0 = GL + 8;
  const plotW = Math.max(40, W - GR - x0);
  const t0 = pts[0].t;
  const tSpan = last.t - t0;
  let xs = pts.map((q, i) =>
    news && tSpan > 0 ? x0 + ((q.t - t0) / tSpan) * plotW : x0 + (i / (n - 1)) * plotW,
  );
  // 비교한 직전 점 — 위 비교 칸의 링(○)과 같은 표시로 그래프에도 찍는다
  const prevIdx = p.change ? pts.findIndex((q) => q.t === p.change!.prev.t) : -1;
  // 마지막 간격이 좁으면(기준금리 8월 말 → 9월 20일 등) 링이 최근 점에 묻힌다 —
  // 앞쪽 점들을 조금 좁혀 마지막 구간을 벌린다
  if (prevIdx === n - 2 && n > 2 && xs[n - 1] - xs[n - 2] < MIN_LAST_GAP) {
    const from = xs[n - 2] - x0;
    const to = xs[n - 1] - MIN_LAST_GAP - x0;
    if (from > 0 && to > 0) xs = xs.map((x, i) => (i === n - 1 ? x : x0 + (x - x0) * (to / from)));
  }
  const yOf = (v: number) => PT + ((hi - v) / (hi - lo)) * (H - PT - PB);
  const ys = pts.map((q) => yOf(q.value));
  const xEnd = xs[n - 1];

  const stepLine = STEP_KEYS.has(p.key);
  let line = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    line += stepLine
      ? ` H${xs[i].toFixed(1)} V${ys[i].toFixed(1)}`
      : ` L${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
  }
  const area =
    lo === 0 && !news
      ? `${line} L${xEnd.toFixed(1)},${yOf(0).toFixed(1)} L${xs[0].toFixed(1)},${yOf(0).toFixed(1)} Z`
      : null;

  // x축 라벨 — 처음·끝을 먼저 놓고, 겹치면 가운데 것을 뺀다
  const xText = (q: Pt) => when(q, cad, "short", { multiYear: p.multiYear });
  const order =
    n <= 4 ? [0, n - 1, ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1)] : [0, n - 1, Math.floor((n - 1) / 2)];
  const placed: { i: number; cx: number; text: string; l: number; r: number }[] = [];
  for (const i of order) {
    if (placed.some((q) => q.i === i)) continue;
    const text = xText(pts[i]);
    const w = estW(text, 13);
    const cx = Math.min(Math.max(xs[i], w / 2 + 2), W - w / 2 - 2);
    const l = cx - w / 2;
    const r = cx + w / 2;
    if (placed.some((q) => l < q.r + 6 && r > q.l - 6)) continue;
    placed.push({ i, cx, text, l, r });
  }

  const pickAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs[i] - vx) < Math.abs(xs[best] - vx)) best = i;
    setSel(best);
  };

  // 손가락: 닿자마자 고르지 않는다. 그래프 위에서 시작한 세로 스크롤이 몰래 시점을
  // 바꿔 놓기 때문이다. 제자리 탭이면 떼는 순간 고르고, 옆으로 밀 때만 따라 고른다.
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse") return pickAt(e);
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, before: sel, scrub: false };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse") return pickAt(e);
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = Math.abs(e.clientX - g.x);
    const dy = Math.abs(e.clientY - g.y);
    if (!g.scrub) {
      if (dy > TAP_SLOP && dy >= dx) {
        gesture.current = null; // 세로 스크롤 — 브라우저에 맡긴다
        return;
      }
      if (dx > TAP_SLOP && dx > dy) g.scrub = true;
    }
    if (g.scrub) pickAt(e);
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId || g.scrub) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < TAP_SLOP) pickAt(e);
  };
  const onCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    // 브라우저가 제스처를 스크롤로 가져갔다 — 밀면서 바뀐 선택을 되돌린다
    if (g && g.id === e.pointerId) setSel(g.before);
  };

  const whenLong = (q: Pt) =>
    news ? `${when(q, "irregular", "basis", { refYear: p.refYear })} 보도` : when(q, cad);
  const range = `${when(pts[0], cad)} ~ ${
    pts[0].y === last.y ? when(last, cad, "basis", { refYear: last.y }) : when(last, cad)
  }${news ? " 보도" : ""}`;
  const si = sel !== null && sel < n ? sel : null;
  const picked = si !== null;
  const shown = si !== null ? pts[si] : last;
  const restLabel = p.droppedLatest ? "마지막으로 확인된 보도" : "가장 최근 값";

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[15px] font-bold text-gray-900">{range} 추이</p>
        <p className="text-[14px] tabular-nums text-gray-600">
          이 기간 최고 {fmtNum(rMax, dec)}
          {unit} · 최저 {fmtNum(rMin, dec)}
          {unit}
        </p>
      </div>

      <div
        className={`flex min-h-[88px] items-center justify-between gap-2 rounded-xl py-2 pl-3 pr-2 ${
          picked ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-800"
        }`}
      >
        <div aria-live="polite" className="min-w-0">
          <p className={`text-[14px] ${picked ? "text-gray-300" : "text-gray-600"}`}>
            {picked ? "선택한 시점" : restLabel}
          </p>
          <p className="text-[15px] tabular-nums">{whenLong(shown)}</p>
          <p className="text-[17px] font-extrabold tabular-nums">
            {fmtNum(shown.value, dec)}
            {unit}
          </p>
        </div>
        {picked && (
          <button
            type="button"
            onClick={() => setSel(null)}
            className="h-11 shrink-0 rounded-lg border border-white/40 px-3 text-[14px] font-bold text-white hover:bg-white/10 active:bg-white/10"
          >
            {p.droppedLatest ? "마지막 값 보기" : "최근 값 보기"}
          </button>
        )}
      </div>

      {p.droppedLatest && (
        <p className="text-[14px] leading-relaxed text-gray-600">
          가장 최근 보도({when(p.droppedLatest, "irregular", "basis", { refYear: p.refYear })})는
          기사마다 수치가 달라 그래프에서 뺐습니다.
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[14px] text-gray-600">
        <span className="mt-[3px]">
          <InfoIcon />
        </span>
        그래프를 누르거나 옆으로 밀면 그 시점의 값이 위{"\u00a0"}칸에 나옵니다.
      </p>

      <div ref={boxRef}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block select-none"
          style={{ touchAction: "pan-y" }}
          role="img"
          aria-label={`${p.label} ${range} 추이. 최저 ${fmtNum(rMin, dec)}${unit}, 최고 ${fmtNum(
            rMax,
            dec,
          )}${unit}, 최근 ${fmtNum(last.value, dec)}${unit}.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setSel(null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={GL}
                x2={xEnd + 4}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke={Math.abs(t) < 1e-12 ? "#CFD3DA" : "#ECEEF2"}
                strokeWidth="1"
              />
              <text
                x={GL - 6}
                y={yOf(t)}
                fontSize="13"
                fill="#6B7280"
                textAnchor="end"
                dominantBaseline="central"
                className="tabular-nums"
              >
                {tickLabel(t)}
              </text>
            </g>
          ))}

          {area && <path d={area} fill="rgba(185,138,16,0.10)" />}
          <path
            d={line}
            fill="none"
            stroke="#B98A10"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={news ? "3 5" : undefined}
          />
          {news &&
            pts.slice(0, -1).map((q, i) => (
              <circle key={q.t} cx={xs[i]} cy={ys[i]} r="3.5" fill="#B98A10" />
            ))}

          {placed.map((q) => (
            <text
              key={q.i}
              x={q.cx}
              y={H - 8}
              fontSize="13"
              fill="#6B7280"
              textAnchor="middle"
              className="tabular-nums"
            >
              {q.text}
            </text>
          ))}

          {si !== null && (
            <line
              x1={xs[si]}
              x2={xs[si]}
              y1={PT - 10}
              y2={H - PB}
              stroke="#9CA3AF"
              strokeWidth="1"
            />
          )}

          {/* 흰 테두리를 먼저 깔고 링을 그 위에 — 링이 테두리에 잘리지 않게 */}
          <circle cx={xEnd} cy={ys[n - 1]} r="7" fill="#fff" />
          {prevIdx >= 0 && (
            <circle
              cx={xs[prevIdx]}
              cy={ys[prevIdx]}
              r="4.5"
              fill="#fff"
              stroke="#B98A10"
              strokeWidth="2"
            />
          )}
          <circle cx={xEnd} cy={ys[n - 1]} r="5" fill="#B98A10" />
          <text
            x={xEnd + 12}
            y={Math.min(Math.max(ys[n - 1], 10), H - 10)}
            fontSize="14"
            fontWeight="700"
            fill="#111827"
            dominantBaseline="central"
            className="tabular-nums"
            stroke="#fff"
            strokeWidth="4"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {endLabel}
          </text>

          {si !== null && (
            <circle
              cx={xs[si]}
              cy={ys[si]}
              r="5.5"
              fill="#111827"
              stroke="#fff"
              strokeWidth="2"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

function HistoryTable({ p, id }: { p: Prepared; id: string }) {
  const { seq, dec, unit, news, cad, coarse } = p;
  const rows = seq.map((q, i) => ({ q, prev: i > 0 ? seq[i - 1] : null })).reverse();
  const deltaUnit = coarse || !unit ? "" : `(${unit === "%" ? "%p" : unit})`;
  return (
    <div className="overflow-x-auto">
      <table id={id} className="w-full border-collapse text-[15px] tabular-nums">
        <caption className="sr-only">{p.label} 시점별 값</caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-[14px] text-gray-500">
            <th scope="col" className="whitespace-nowrap py-2 pr-2 text-left font-bold">
              시점
            </th>
            <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-bold">
              값{unit ? `(${unit})` : ""}
            </th>
            {/* 좁은 화면(360)에서 일별 날짜가 "9월 / 22일"로 쪼개지지 않게, 칸이 모자라면 단위만 둘째 줄로 */}
            <th scope="col" className="py-2 pl-2 text-right font-bold">
              <span className="whitespace-nowrap">직전 대비</span>
              {deltaUnit && (
                <>
                  <wbr />
                  <span className="whitespace-nowrap">{deltaUnit}</span>
                </>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ q, prev }, i) => {
            let delta: React.ReactNode = <span className="text-gray-500">—</span>;
            if (prev && !q.conflict && !prev.conflict) {
              const diff = Number((q.value - prev.value).toFixed(dec));
              // 반올림된 계열은 방향만 — 폭은 실제와 다를 수 있다
              delta =
                diff === 0 ? (
                  <span className="text-[14px] text-gray-500">{coarse ? "같음" : "변동 없음"}</span>
                ) : (
                  <span className={`font-bold ${diff > 0 ? "text-rose-700" : "text-blue-700"}`}>
                    <span aria-hidden="true">{diff > 0 ? "▲" : "▼"}</span>{" "}
                    {coarse ? (diff > 0 ? "상승" : "하락") : fmtNum(Math.abs(diff), dec)}
                    {!coarse && <span className="sr-only">{diff > 0 ? " 상승" : " 하락"}</span>}
                  </span>
                );
            }
            return (
              <tr
                key={q.t}
                className={`border-b border-[var(--line)] ${i === 0 ? "bg-[#FFFBF0]" : ""}`}
              >
                <td className="py-2 pr-2 text-left text-gray-800">
                  {news ? (
                    <>
                      <span className="whitespace-nowrap">
                        {when(q, "irregular", "basis", { refYear: p.refYear })}
                      </span>{" "}
                      보도
                      <span className="block text-[14px] text-gray-500">기사 {q.count ?? 1}건</span>
                    </>
                  ) : (
                    <span className="whitespace-nowrap">{when(q, cad)}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-bold text-gray-900">
                  {q.conflict ? (
                    <span className="text-[14px] font-normal text-gray-500">기사마다 다름</span>
                  ) : (
                    fmtNum(q.value, dec)
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pl-2 text-right">{delta}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 펼침 영역 — 누른 줄 바로 아래에 열린다
// ---------------------------------------------------------------------------

function DetailPanel({
  p,
  open,
  mounted,
  onCollapse,
}: {
  p: Prepared;
  open: boolean;
  mounted: boolean;
  onCollapse: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tableBtnRef = useRef<HTMLButtonElement>(null);
  const [table, setTable] = useState(false);
  const closedFromBelow = useRef(false);

  // React 18은 inert 속성을 그대로 넘기지 않는다
  useIsoLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", !open);
  }, [open]);

  // 다시 펼치면 표는 접힌 상태부터 — 지난번 상태를 들고 오면 패널이 길게 열린다
  useEffect(() => {
    if (!open) setTable(false);
  }, [open]);

  // 표 아래쪽 "표 닫기"로 닫으면 표가 사라지며 화면이 엉뚱한 곳에 남는다 —
  // 위쪽 "표로 보기" 버튼이 화면 아래쪽에 오도록 되돌린다
  useIsoLayoutEffect(() => {
    if (table || !closedFromBelow.current) return;
    closedFromBelow.current = false;
    const btn = tableBtnRef.current;
    if (!btn) return;
    btn.focus({ preventScroll: true });
    const r = btn.getBoundingClientRect();
    if (r.top < coveredTop() + 8 || r.bottom > window.innerHeight - 8) {
      window.scrollBy({ top: r.bottom - (window.innerHeight - 16), behavior: "instant" });
    }
  }, [table]);

  const c = p.change;
  const cadence =
    p.key === "base_rate"
      ? "금융통화위원회 결정 때 (연 8회)"
      : CADENCE_TEXT[p.news ? "news" : p.cad];
  const cellWhen = (q: Pt) =>
    p.news ? `${when(q, "irregular", "basis", { refYear: p.refYear })} 보도` : when(q, p.cad);
  const prevLong = c ? cellWhen(c.prev) : "";
  const tableId = `table-${p.key}`;
  const btn = "btn-soft text-[15px]";

  return (
    <div
      id={`panel-${p.key}`}
      ref={ref}
      role="region"
      aria-labelledby={`label-${p.key}`}
      className={`grid ${
        open
          ? "transition-[grid-template-rows] duration-[240ms] ease-out motion-reduce:transition-none"
          : ""
      }`}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="min-h-0 overflow-hidden">
        {mounted && (
          <div className="mx-3 mb-3 space-y-3 rounded-2xl border border-[#F5E3B3] bg-white p-4">
            {DESC[p.key] && (
              <p className="text-[15px] leading-relaxed text-gray-800">{DESC[p.key]}</p>
            )}

            {p.news && (
              <p className="rounded-xl bg-gray-50 p-3 text-[14px] leading-relaxed text-gray-700">
                기사에서 자동으로 뽑은 수치라 공식 통계와 다를 수 있습니다. 몇 월 말 기준인지도
                기사마다 달라, 다른 공식 통계와 나란히 비교하지 마세요.
              </p>
            )}

            {c && (
              <div>
                <div className="relative grid grid-cols-2 gap-5 rounded-xl bg-gray-50 p-3">
                  {[
                    { q: c.prev, now: false },
                    { q: c.last, now: true },
                  ].map(({ q, now }) => (
                    <div key={String(now)} className="min-w-0">
                      <p
                        className={`text-[14px] ${now ? "font-bold text-gray-900" : "text-gray-600"}`}
                      >
                        {cellWhen(q)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                        {now ? <DotMark /> : <RingMark />}
                        <span>
                          <span className="text-[19px] font-extrabold tabular-nums tracking-tight text-gray-900 min-[375px]:text-[20px]">
                            {fmtNum(q.value, p.dec)}
                          </span>
                          <span className="ml-0.5 text-[14px] font-bold text-gray-500">
                            {p.unit}
                          </span>
                        </span>
                      </p>
                    </div>
                  ))}
                  <span className="pointer-events-none absolute left-1/2 top-[23px] -translate-x-1/2 -translate-y-1/2">
                    <Arrow />
                  </span>
                </div>
                <p className="mt-2 px-0.5 text-[15px] text-gray-800">
                  {c.dir === "flat" ? (
                    <>
                      {c.coarse && "소수 첫째 자리까지는 "}
                      {prevLong}
                      {josaGwa(prevLong)} 같습니다.
                    </>
                  ) : (
                    <>
                      {prevLong}보다{" "}
                      <b className={`font-bold ${DIR_TEXT[c.dir]}`}>
                        {!c.coarse && `${fmtNum(Math.abs(c.diff), p.dec)}${c.unitD} `}
                        {c.word}
                      </b>
                      했습니다.
                    </>
                  )}
                </p>
                {c.coarse && (
                  <p className="mt-1 flex items-start gap-1.5 px-0.5 text-[14px] leading-relaxed text-gray-600">
                    <span className="mt-[3px]">
                      <InfoIcon />
                    </span>
                    {ROUNDED_NOTE}
                  </p>
                )}
              </div>
            )}

            {p.pts.length >= 2 ? (
              <TrendChart p={p} open={open} />
            ) : (
              <p className="text-[14px] text-gray-600">추이를 그릴 만큼 자료가 모이지 않았습니다.</p>
            )}

            {p.pointNote && <p className="text-[14px] text-gray-600">{p.pointNote}</p>}

            <div className="border-t border-[var(--line)] pt-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
                <dt className="text-gray-500">출처</dt>
                <dd className="text-gray-800">
                  {p.news ? "뉴스 기사 자동 추출 · 공식 통계 아님" : p.sourceLabel}
                </dd>
                {cadence && (
                  <>
                    <dt className="text-gray-500">발표 주기</dt>
                    <dd className="text-gray-800">{cadence}</dd>
                  </>
                )}
              </dl>
              <div className="mt-3 flex gap-2">
                {p.pts.length >= 2 && (
                  <button
                    ref={tableBtnRef}
                    type="button"
                    aria-expanded={table}
                    aria-controls={tableId}
                    onClick={() => setTable((v) => !v)}
                    className={btn}
                  >
                    {table ? "표 닫기" : "표로 보기"}
                  </button>
                )}
                <button type="button" onClick={onCollapse} className={btn}>
                  접기
                  <Chevron up />
                </button>
              </div>
            </div>

            {table && (
              <>
                <HistoryTable p={p} id={tableId} />
                {/* 표가 길다(20줄 이상) — 닫는 버튼을 표 끝에도 둔다 */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closedFromBelow.current = true;
                      setTable(false);
                    }}
                    className={btn}
                  >
                    표 닫기
                  </button>
                  <button type="button" onClick={onCollapse} className={btn}>
                    접기
                    <Chevron up />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 목록 한 줄
// ---------------------------------------------------------------------------

function IndicatorRow({
  p,
  open,
  mounted,
  onToggle,
  onCollapse,
}: {
  p: Prepared;
  open: boolean;
  mounted: boolean;
  onToggle: (key: string) => void;
  onCollapse: (key: string) => void;
}) {
  return (
    <li className={open ? "rounded-[18px] bg-[#FFFBF0] ring-2 ring-inset ring-[#FFB81C]" : undefined}>
      {/* 부모 ul.card가 overflow-hidden이라 링을 안쪽에 — 열림 테두리(노랑) 안쪽의 진한 링으로 포커스와 열림을 구분.
          닫힌 줄은 카드 폭 가득이라 눌림 배경도 모서리 없이, 열린 줄은 노란 테두리가 가려지지 않게 반투명으로 */}
      <button
        type="button"
        id={`row-${p.key}`}
        aria-expanded={open}
        aria-controls={`panel-${p.key}`}
        onClick={() => onToggle(p.key)}
        className={`grid min-h-[96px] w-full grid-cols-[1fr_auto] gap-x-3 px-4 pb-3 pt-3.5 text-left focus-visible:-outline-offset-4 ${
          open ? "rounded-[18px] active:bg-black/[0.04]" : "active:bg-gray-100"
        }`}
      >
        <span className="col-start-1 row-start-1 min-w-0 leading-snug">
          <span id={`label-${p.key}`} className="text-[17px] font-bold text-gray-900">
            {p.label}
          </span>
          {p.news && (
            <span className="ml-1.5 inline-block whitespace-nowrap rounded-md bg-gray-100 px-1.5 align-[2px] text-[13px] font-bold leading-5 text-gray-600">
              기사 추출
            </span>
          )}
          <span className="sr-only">, </span>
        </span>
        <span className="col-start-2 row-span-2 row-start-1 self-center whitespace-nowrap text-right">
          {p.valueHidden ? (
            <span className="text-[15px] font-bold text-gray-600">{p.valueText}</span>
          ) : (
            <>
              <span className="text-[27px] font-extrabold tabular-nums tracking-tight text-gray-900">
                {p.valueText}
              </span>
              {p.unit && (
                <span className="ml-0.5 text-[15px] font-bold text-gray-500">{p.unit}</span>
              )}
            </>
          )}
          <span className="sr-only">, </span>
        </span>
        <span className="col-start-1 row-start-2 text-[14px] text-gray-500">
          {p.meta}
          <span className="sr-only">, </span>
        </span>
        <span className="col-span-2 row-start-3 mt-2.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            {p.change ? (
              <RowChange c={p.change} p={p} />
            ) : (
              <span className="text-[14px] text-gray-500">{p.note}</span>
            )}
            <span className="sr-only">, </span>
          </span>
          {/* 보이는 행동 이름(추이 보기·접기)은 버튼 이름에 남긴다 — 음성 제어로 "추이 보기"라고 말해 누를 수 있게 */}
          <span
            className={`inline-flex h-[34px] shrink-0 items-center gap-1 rounded-full px-3.5 text-[14px] font-bold ${
              open ? "bg-[#FFB81C] text-gray-900" : "bg-[#FFF4D6] text-[#8A6400]"
            }`}
          >
            {open ? "접기" : "추이 보기"}
            <Chevron up={open} />
          </span>
        </span>
      </button>
      <DetailPanel p={p} open={open} mounted={mounted} onCollapse={() => onCollapse(p.key)} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// 머리 카드
// ---------------------------------------------------------------------------

function IntroCard() {
  return (
    <section className="card p-4 sm:p-6">
      <h1 className="accent-bar flex items-center text-[19px] font-extrabold tracking-tight text-gray-900">
        경제지표
      </h1>
      <p className="mt-1 text-[15px] text-gray-600">
        한국은행 등 기관 통계를 자동으로 모아 보여 드립니다.
      </p>
      <div className="mt-3 space-y-1.5 rounded-xl border border-[#F5E3B3] bg-[#FFFBF0] p-3 text-[15px] leading-snug text-gray-800">
        <p className="flex gap-2">
          <span className="mt-0.5 text-[#8A6400]">
            <Chevron />
          </span>
          <span>
            항목을 누르면 <b className="font-bold">바로 아래에</b> 추이 그래프가 펼쳐집니다.
          </span>
        </p>
        <p className="flex gap-2">
          <span className="mt-0.5 text-[#8A6400]">
            <CalendarIcon />
          </span>
          <span>
            통계마다 발표 시기가 달라 <b className="font-bold">기준 시점</b>이 서로 다릅니다.
          </span>
        </p>
      </div>
      <div className="mt-3 space-y-0.5 text-[14px] text-gray-600">
        <p className="flex flex-wrap gap-x-3">
          <span>
            <span className="text-rose-700">▲</span> 올랐음
          </span>
          <span>
            <span className="text-blue-700">▼</span> 내렸음
          </span>
          <span>좋고 나쁨이 아닌 방향만 표시</span>
        </p>
        <p>
          <b className="font-bold text-gray-800">%p</b> 퍼센트포인트 · 0.7%→0.8%는 0.1%p 상승
        </p>
      </div>
    </section>
  );
}

function GroupHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-baseline gap-x-2 px-1">
      <h2 className="text-[18px] font-extrabold tracking-tight text-gray-900">{title}</h2>
      {sub && <span className="text-[14px] text-gray-600">{sub}</span>}
    </div>
  );
}

/**
 * 경제지표 보드. 값은 한국은행 등 기관 원본 통계나 수집 기사에서 자동으로
 * 채워진다. 확인되지 않은 지표는 표시하지 않는다 — 게시판에 틀린 숫자가
 * 붙는 것이 더 나쁘다.
 *
 * 레이아웃: 주제별 목록 + 누른 줄 바로 아래에 펼쳐지는 추이. 맨 아래에
 * 따로 뜨던 상세 패널은 어느 항목의 그래프인지 연결이 끊겨 헷갈렸다.
 */
export function IndicatorBoard() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [items, setItems] = useState<Indicator[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<{ key: string; top: number; collapse: boolean } | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    fetch("/api/indicators")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        setItems(Array.isArray(j?.indicators) ? j.indicators : []);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const prepared = useMemo(() => items.filter(publishable).map(prepare), [items]);

  const groups = useMemo(() => {
    const byKey = new Map(prepared.map((p) => [p.key, p]));
    const known = new Set(GROUPS.flatMap((g) => g.keys));
    return [
      ...GROUPS.map((g) => ({
        ...g,
        list: g.keys.map((k) => byKey.get(k)).filter((p): p is Prepared => Boolean(p)),
      })),
      { title: "기타", keys: [], list: prepared.filter((p) => !known.has(p.key)) },
    ].filter((g) => g.list.length > 0);
  }, [prepared]);

  const remember = (key: string, collapse: boolean) => {
    const row = document.getElementById(`row-${key}`);
    anchorRef.current = { key, top: row?.getBoundingClientRect().top ?? 0, collapse };
  };

  const onToggle = (key: string) => {
    remember(key, false);
    setOpenKey((cur) => (cur === key ? null : key));
    setSeen((s) => (s.has(key) ? s : new Set(s).add(key)));
  };

  const onCollapse = (key: string) => {
    remember(key, true);
    setOpenKey((cur) => (cur === key ? null : cur));
  };

  // 위쪽 펼침이 즉시 닫히면 누른 줄이 손가락 밑에서 달아난다 — 같은 자리로 되돌린다
  useIsoLayoutEffect(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!a) return;
    const row = document.getElementById(`row-${a.key}`);
    if (!row) return;

    if (a.collapse) {
      row.focus({ preventScroll: true });
      const top = row.getBoundingClientRect().top;
      const hb = coveredTop();
      if (top < hb) window.scrollBy({ top: top - hb - 8, behavior: "instant" });
      return;
    }

    const dy = row.getBoundingClientRect().top - a.top;
    if (Math.abs(dy) >= 1) window.scrollBy({ top: dy, behavior: "instant" });
    if (openKey !== a.key) return;

    const reduce = reducedMotion();
    const timer = window.setTimeout(
      () => {
        const panel = document.getElementById(`panel-${a.key}`);
        if (!panel) return;
        const over = panel.getBoundingClientRect().bottom - (window.innerHeight - 12);
        if (over <= 0) return;
        // 헤더가 같이 스크롤되는 페이지라면 줄을 화면 맨 위까지 올려도 가려지지 않는다
        const room = row.getBoundingClientRect().top - coveredTop() - 8;
        const by = Math.min(over, room);
        if (by > 0) window.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });
      },
      reduce ? 0 : 260,
    );
    return () => window.clearTimeout(timer);
  }, [openKey]);

  const hasNews = prepared.some((p) => p.news);

  return (
    <div>
      <IntroCard />

      {status === "loading" && (
        <div aria-busy="true">
          <p className="sr-only">지표를 불러오는 중입니다</p>
          {[0, 1].map((g) => (
            <div key={g}>
              {/* 불러온 뒤의 GroupHeading(29px)·줄(118px)과 같은 높이 — 목록이 뜰 때 밀리지 않게 */}
              <div className="mb-2 mt-6 flex h-[29px] items-center px-1">
                <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
              </div>
              <div className="card divide-y divide-[var(--line)] overflow-hidden">
                {[0, 1, 2, 3].map((r) => (
                  <div key={r} className="h-[118px] p-3">
                    <div className="h-full animate-pulse rounded-xl bg-gray-100" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="card mt-6 p-4 sm:p-6">
          <div role="alert" className="error-box">
            <p className="text-[15px] font-bold text-rose-800">지표를 불러오지 못했습니다</p>
            <p className="mt-1 text-[14px] text-rose-800">
              잠시 후 다시 시도해 주세요. 계속되면 담당자에게 알려 주세요.
            </p>
            <button type="button" onClick={load} className="btn-retry">
              다시 불러오기
            </button>
          </div>
        </div>
      )}

      {status === "ok" && prepared.length === 0 && (
        <div className="card mt-6 p-5 text-center">
          <p className="text-[15px] text-gray-800">확인된 지표가 아직 없습니다.</p>
          <p className="mt-1 text-[14px] text-gray-500">확인되지 않은 수치는 싣지 않습니다.</p>
        </div>
      )}

      {status === "ok" && prepared.length > 0 && (
        <>
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <GroupHeading title={g.title} sub={g.sub} />
              <ul className="card divide-y divide-[var(--line)] overflow-hidden">
                {g.list.map((p) => (
                  <IndicatorRow
                    key={p.key}
                    p={p}
                    open={openKey === p.key}
                    mounted={seen.has(p.key)}
                    onToggle={onToggle}
                    onCollapse={onCollapse}
                  />
                ))}
              </ul>
            </section>
          ))}
          <p className="mt-5 px-1 text-[14px] leading-relaxed text-gray-600">
            숫자는 한국은행 등 기관이 발표한 원본 통계입니다. 확인되지 않은 지표는 싣지 않습니다.
            {hasNews &&
              " ‘기사 추출’ 표시가 붙은 항목은 뉴스 기사에서 자동으로 뽑은 수치라 공식 통계와 다를 수 있습니다."}
          </p>
        </>
      )}
    </div>
  );
}
