// 통계청 KOSIS 공유서비스 클라이언트.
//
// 법원행정처의 개인회생·개인파산 접수 건수처럼 ECOS에 없는 공식 통계를
// 받아온다. 기관표(orgId)·통계표(tblId)·항목(itmId)·분류(objL1…)는 반드시
// 프로브로 실측 확인한 뒤에만 계열에 넣는다 — ECOS·FISIS에서 그랬듯
// 코드를 추측하면 엉뚱한 숫자가 게시판에 올라간다.
//
// 키가 없으면(KOSIS_API_KEY 미설정) 아무것도 하지 않는다.
// 키 발급: https://kosis.kr/openapi (무료)

const BASE = "https://kosis.kr/openapi";

export type KosisSeries = {
  /** indicators.key */
  key: string;
  label: string;
  unit: string;
  sortOrder: number;
  orgId: string;
  tblId: string;
  /** statisticsParameterData 파라미터 — itmId, objL1 등 표마다 다르다 */
  params: Record<string, string>;
  /** M(월)·Q(분기)·Y(연) */
  prdSe: "M" | "Q" | "Y";
  /** 가져올 최근 기간 수 */
  span: number;
  /** 응답의 표·항목 이름 검증 — 어긋나면 값을 버린다 */
  expectName: RegExp;
  /** 여러 행이 오면 합산한다 (예: 회생 + 파산) */
  sum?: boolean;
  scale?: number;
  digits?: number;
  min: number;
  max: number;
};

// 프로브로 코드를 확정한 뒤에만 추가한다. 빈 목록이면 크론은 아무것도 쓰지 않는다.
export const KOSIS_SERIES: KosisSeries[] = [];

export const hasKosisKey = (): boolean => Boolean(process.env.KOSIS_API_KEY);

type KosisRow = Record<string, string | null | undefined>;

async function kosisFetch(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = process.env.KOSIS_API_KEY;
  if (!key) throw new Error("KOSIS_API_KEY 미설정");
  const qs = new URLSearchParams({ apiKey: key, format: "json", jsonVD: "Y", ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 조회 API 원본 호출 — 코드 확정용 프로브에서 그대로 반환한다 */
export async function kosisRaw(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (!/^[A-Za-z/]+\.do$/.test(path)) throw new Error("잘못된 KOSIS 경로");
  return kosisFetch(path, params);
}

/** KOSIS 기간 표기(YYYYMM / YYYYQn? / YYYY) → ISO(KST 말일 자정) */
export function kosisPeriodToIso(prd: string, prdSe: "M" | "Q" | "Y"): string | null {
  const t = prd.trim();
  if (prdSe === "M" && /^\d{6}$/.test(t)) {
    const y = +t.slice(0, 4);
    const m = +t.slice(4, 6);
    if (m < 1 || m > 12) return null;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1, lastDay) - 9 * 3_600_000).toISOString();
  }
  if (prdSe === "Q" && /^\d{4}0[1-4]$/.test(t)) {
    const y = +t.slice(0, 4);
    const q = +t.slice(5, 6);
    const m = q * 3;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1, lastDay) - 9 * 3_600_000).toISOString();
  }
  if (prdSe === "Y" && /^\d{4}$/.test(t)) {
    return new Date(Date.UTC(+t, 11, 31) - 9 * 3_600_000).toISOString();
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function kosisRange(
  prdSe: "M" | "Q" | "Y",
  span: number,
  nowMs: number,
): { start: string; end: string } {
  const kst = new Date(nowMs + 9 * 3_600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-based
  if (prdSe === "M") {
    const from = new Date(Date.UTC(y, m - span + 1, 1));
    return {
      start: `${from.getUTCFullYear()}${pad(from.getUTCMonth() + 1)}`,
      end: `${y}${pad(m + 1)}`,
    };
  }
  if (prdSe === "Q") {
    const q = Math.floor(m / 3) + 1;
    const total = y * 4 + (q - 1) - (span - 1);
    return {
      start: `${Math.floor(total / 4)}0${(total % 4) + 1}`,
      end: `${y}0${q}`,
    };
  }
  return { start: String(y - span + 1), end: String(y) };
}

export type KosisResult =
  | {
      ok: true;
      key: string;
      points: { time: string; asOf: string; value: number }[];
      name: string;
    }
  | { ok: false; key: string; reason: string };

/** 한 계열 조회 — 이름·범위 검증을 통과한 점만 돌려준다 */
export async function fetchKosisSeries(
  series: KosisSeries,
  nowMs: number,
): Promise<KosisResult> {
  const { start, end } = kosisRange(series.prdSe, series.span, nowMs);
  let json: unknown;
  try {
    json = await kosisFetch("Param/statisticsParameterData.do", {
      method: "getList",
      orgId: series.orgId,
      tblId: series.tblId,
      prdSe: series.prdSe,
      startPrdDe: start,
      endPrdDe: end,
      ...series.params,
    });
  } catch (e) {
    return { ok: false, key: series.key, reason: `요청 실패: ${(e as Error).message}` };
  }

  // 오류 시 KOSIS는 배열 대신 {err, errMsg} 객체를 준다
  if (!Array.isArray(json)) {
    const err = json as { err?: string; errMsg?: string };
    return {
      ok: false,
      key: series.key,
      reason: `KOSIS ${err.err ?? "?"}: ${err.errMsg ?? "응답 형식 불일치"}`,
    };
  }
  const rows = json as KosisRow[];
  if (rows.length === 0) return { ok: false, key: series.key, reason: "데이터 없음" };

  const nameOf = (r: KosisRow) =>
    `${r.TBL_NM ?? ""} ${r.ITM_NM ?? ""} ${r.C1_NM ?? ""} ${r.C2_NM ?? ""}`;
  if (!series.expectName.test(nameOf(rows[0]))) {
    return { ok: false, key: series.key, reason: `이름 불일치: ${nameOf(rows[0]).trim()}` };
  }

  // 기간별로 모은다 — sum이면 같은 기간의 여러 행(회생+파산 등)을 합산
  const byPeriod = new Map<string, number>();
  for (const r of rows) {
    const prd = String(r.PRD_DE ?? "");
    const v = Number(String(r.DT ?? "").replace(/,/g, ""));
    if (!prd || !Number.isFinite(v)) continue;
    if (series.sum) byPeriod.set(prd, (byPeriod.get(prd) ?? 0) + v);
    else if (!byPeriod.has(prd)) byPeriod.set(prd, v);
  }

  const points: { time: string; asOf: string; value: number }[] = [];
  for (const [prd, raw] of byPeriod) {
    const value = Number((raw / (series.scale ?? 1)).toFixed(series.digits ?? 0));
    if (value < series.min || value > series.max) continue;
    const asOf = kosisPeriodToIso(prd, series.prdSe);
    if (!asOf) continue;
    points.push({ time: prd, asOf, value });
  }
  if (points.length === 0) return { ok: false, key: series.key, reason: "유효한 값 없음" };

  points.sort((a, b) => a.time.localeCompare(b.time));
  return { ok: true, key: series.key, points, name: nameOf(rows[0]).trim() };
}
