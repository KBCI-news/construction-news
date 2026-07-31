// 한국은행 경제통계시스템(ECOS) OpenAPI 클라이언트.
//
// 지표를 기사에서 뽑아내는 방식은 한계가 뚜렷하다. 보도가 있어야만 값이 생기고,
// 전망치·변동폭·개별사 수치를 걸러내느라 규칙이 계속 복잡해지며, 그래도 틀린
// 숫자가 섞일 위험이 남는다. 게시판에 붙는 숫자라 그 위험이 특히 나쁘다.
// ECOS는 한국은행이 직접 배포하는 원본 통계라 이 문제가 전부 사라진다.
//
// 키가 없으면(ECOS_API_KEY 미설정) 이 모듈은 아무것도 하지 않는다.
// 기존 기사 추출 방식이 그대로 동작하므로 운영에 영향이 없다.
// 키 발급: https://ecos.bok.or.kr/api/#/AuthKeyApply (무료, 즉시 발급)

const BASE = "https://ecos.bok.or.kr/api";

export type EcosCycle = "D" | "M" | "Q" | "A";

export type EcosSeries = {
  /** indicators.key */
  key: string;
  label: string;
  unit: string;
  sortOrder: number;
  statCode: string;
  itemCodes: string[];
  cycle: EcosCycle;
  /** 가져올 최근 구간 길이 (cycle 단위) */
  span: number;
  /**
   * 응답의 통계·항목명이 이 패턴과 맞아야 값을 인정한다.
   * 통계표 코드는 개편될 수 있는데, 코드만 믿고 쓰면 엉뚱한 숫자가 조용히
   * 지표로 올라간다. 이름을 함께 확인해 어긋나면 값을 버리고 보고한다.
   */
  expectName: RegExp;
  expectUnit: RegExp;
  min: number;
  max: number;
};

// 코드가 확실한 계열만 켠다. 새 계열은 아래 discover 모드로 코드를 확인한 뒤 추가한다.
export const ECOS_SERIES: EcosSeries[] = [
  {
    key: "base_rate",
    label: "기준금리",
    unit: "%",
    sortOrder: 1,
    statCode: "722Y001", // 1.3.1. 한국은행 기준금리 및 여수신금리
    itemCodes: ["0101000"], // 한국은행 기준금리
    cycle: "M",
    span: 24, // 2년치 — 인상·인하 경로가 한눈에 보이는 최소 길이
    expectName: /기준금리/,
    expectUnit: /%/,
    min: 0.25,
    max: 6,
  },
];

export type EcosPoint = { time: string; asOf: string; value: number };

export type EcosResult =
  | { ok: true; key: string; points: EcosPoint[]; statName: string; unitName: string }
  | { ok: false; key: string; reason: string };

export const hasEcosKey = (): boolean => Boolean(process.env.ECOS_API_KEY);

/** ECOS 시간 표기(YYYYMMDD / YYYYMM / YYYYQn / YYYY) → ISO(KST 기준일) */
export function ecosTimeToIso(time: string, cycle: EcosCycle): string | null {
  const t = time.trim();
  let y: number, m: number, d: number;
  if (cycle === "D" && /^\d{8}$/.test(t)) {
    y = +t.slice(0, 4);
    m = +t.slice(4, 6);
    d = +t.slice(6, 8);
  } else if (cycle === "M" && /^\d{6}$/.test(t)) {
    y = +t.slice(0, 4);
    m = +t.slice(4, 6);
    d = 1;
  } else if (cycle === "Q" && /^(\d{4})Q?([1-4])$/.test(t)) {
    const mt = t.match(/^(\d{4})Q?([1-4])$/)!;
    y = +mt[1];
    m = (+mt[2] - 1) * 3 + 1;
    d = 1;
  } else if (cycle === "A" && /^\d{4}$/.test(t)) {
    y = +t;
    m = 1;
    d = 1;
  } else {
    return null;
  }
  // KST 자정으로 고정 — 기사 pub_date와 같은 timestamptz 축에 놓기 위해
  const iso = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3_600_000);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 조회 구간의 시작/끝 문자열을 cycle 표기로 만든다 */
export function ecosRange(
  cycle: EcosCycle,
  span: number,
  nowMs: number,
): { start: string; end: string } {
  const kst = new Date(nowMs + 9 * 3_600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-based
  const d = kst.getUTCDate();

  if (cycle === "D") {
    const from = new Date(Date.UTC(y, m, d - span));
    const fmt = (x: Date) =>
      `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}`;
    return { start: fmt(from), end: fmt(kst) };
  }
  if (cycle === "M") {
    const from = new Date(Date.UTC(y, m - span + 1, 1));
    const fmt = (x: Date) => `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}`;
    return { start: fmt(from), end: fmt(kst) };
  }
  if (cycle === "Q") {
    const q = Math.floor(m / 3) + 1;
    const total = y * 4 + (q - 1) - (span - 1);
    const sy = Math.floor(total / 4);
    const sq = (total % 4) + 1;
    return { start: `${sy}Q${sq}`, end: `${y}Q${q}` };
  }
  return { start: String(y - span + 1), end: String(y) };
}

type EcosRow = {
  STAT_CODE?: string;
  STAT_NAME?: string;
  ITEM_NAME1?: string;
  ITEM_NAME2?: string;
  UNIT_NAME?: string;
  TIME?: string;
  DATA_VALUE?: string;
};

async function ecosFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 한 계열을 조회한다. 코드·이름·단위·범위 검증을 모두 통과한 점만 돌려준다.
 * 하나라도 어긋나면 값을 쓰지 않고 이유를 반환한다 — 틀린 숫자를 올리는 것보다
 * 지표 한 칸이 비는 편이 낫다.
 */
export async function fetchEcosSeries(
  series: EcosSeries,
  nowMs: number,
): Promise<EcosResult> {
  const key = process.env.ECOS_API_KEY;
  if (!key) return { ok: false, key: series.key, reason: "ECOS_API_KEY 미설정" };

  const { start, end } = ecosRange(series.cycle, series.span, nowMs);
  const path = [
    "StatisticSearch",
    encodeURIComponent(key),
    "json",
    "kr",
    "1",
    String(Math.max(series.span * 2, 100)),
    series.statCode,
    series.cycle,
    start,
    end,
    ...series.itemCodes,
  ].join("/");

  let json: unknown;
  try {
    json = await ecosFetch(path);
  } catch (e) {
    return { ok: false, key: series.key, reason: `요청 실패: ${(e as Error).message}` };
  }

  const obj = json as Record<string, unknown>;
  const result = obj.RESULT as { CODE?: string; MESSAGE?: string } | undefined;
  if (result?.CODE) {
    return { ok: false, key: series.key, reason: `ECOS ${result.CODE}: ${result.MESSAGE ?? ""}` };
  }
  const search = obj.StatisticSearch as { row?: EcosRow[] } | undefined;
  const rows = search?.row ?? [];
  if (rows.length === 0) return { ok: false, key: series.key, reason: "데이터 없음" };

  const first = rows[0];
  const name = `${first.STAT_NAME ?? ""} ${first.ITEM_NAME1 ?? ""} ${first.ITEM_NAME2 ?? ""}`;
  if (!series.expectName.test(name)) {
    return { ok: false, key: series.key, reason: `통계명 불일치: ${name.trim()}` };
  }
  if (!series.expectUnit.test(first.UNIT_NAME ?? "")) {
    return { ok: false, key: series.key, reason: `단위 불일치: ${first.UNIT_NAME ?? "(없음)"}` };
  }

  const points: EcosPoint[] = [];
  for (const r of rows) {
    if (!r.TIME || r.DATA_VALUE == null) continue;
    const value = Number(String(r.DATA_VALUE).replace(/,/g, ""));
    if (!Number.isFinite(value) || value < series.min || value > series.max) continue;
    const asOf = ecosTimeToIso(r.TIME, series.cycle);
    if (!asOf) continue;
    points.push({ time: r.TIME, asOf, value });
  }
  if (points.length === 0) return { ok: false, key: series.key, reason: "유효한 값 없음" };

  points.sort((a, b) => a.time.localeCompare(b.time));
  return {
    ok: true,
    key: series.key,
    points,
    statName: (first.STAT_NAME ?? "").trim(),
    unitName: (first.UNIT_NAME ?? "").trim(),
  };
}

export type EcosTable = { code: string; name: string; cycle: string };

/** 통계표 목록에서 키워드로 코드를 찾는다 — 새 계열을 추가할 때 쓰는 조회용 */
export async function discoverTables(query: string): Promise<EcosTable[]> {
  const key = process.env.ECOS_API_KEY;
  if (!key) return [];
  const json = (await ecosFetch(
    `StatisticTableList/${encodeURIComponent(key)}/json/kr/1/1000/`,
  )) as Record<string, unknown>;
  const list = (json.StatisticTableList as { row?: Record<string, string>[] } | undefined)?.row ?? [];
  return list
    .filter((r) => (r.STAT_NAME ?? "").includes(query))
    .map((r) => ({ code: r.STAT_CODE ?? "", name: r.STAT_NAME ?? "", cycle: r.CYCLE ?? "" }));
}

export type EcosItem = { code: string; name: string; cycle: string; start: string; end: string };

/** 특정 통계표의 세부항목 코드 목록 */
export async function discoverItems(statCode: string): Promise<EcosItem[]> {
  const key = process.env.ECOS_API_KEY;
  if (!key) return [];
  const json = (await ecosFetch(
    `StatisticItemList/${encodeURIComponent(key)}/json/kr/1/500/${statCode}`,
  )) as Record<string, unknown>;
  const list = (json.StatisticItemList as { row?: Record<string, string>[] } | undefined)?.row ?? [];
  return list.map((r) => ({
    code: r.ITEM_CODE ?? "",
    name: r.ITEM_NAME ?? "",
    cycle: r.CYCLE ?? "",
    start: r.START_TIME ?? "",
    end: r.END_TIME ?? "",
  }));
}
