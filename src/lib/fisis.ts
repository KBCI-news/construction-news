// 금융감독원 금융통계정보시스템(FISIS) OpenAPI 클라이언트.
//
// 은행·카드·저축은행 연체율의 "정답지"다 — 기사에서 뽑는 값은 보도가 있어야
// 생기고 개별사·지역 수치가 섞일 위험이 있지만, FISIS는 금감원이 집계한
// 원본 통계라 그 문제가 없다. 분기 공시라 시차(2~3개월)는 있다.
//
// 키가 없으면(FISIS_API_KEY 미설정) 아무것도 하지 않는다.
// 키 발급: https://fisis.fss.or.kr (OpenAPI 인증키 신청, 무료)
//
// 회사코드(financeCd)·통계표(listNo)·계정(accountCd)은 조회 API로 확정해야
// 한다. 코드를 추측해 넣으면 엉뚱한 숫자가 지표로 올라가므로, 응답의
// 통계표명·계정명을 expect 패턴으로 재검증해 어긋나면 값을 버린다.

const BASE = "https://fisis.fss.or.kr/openapi";

export type FisisSeries = {
  /** indicators.key */
  key: string;
  label: string;
  unit: string;
  sortOrder: number;
  financeCd: string;
  listNo: string;
  accountCd: string;
  /** 조회 주기 — 연체율 공시는 분기 */
  term: "Q" | "M" | "Y";
  /** 가져올 최근 개월 수 */
  spanMonths: number;
  /** 응답의 통계표·계정 이름 검증 — 코드 개편·오기입 시 값을 버린다 */
  expectName: RegExp;
  min: number;
  max: number;
};

// 코드는 프로브(?api=)로 실측 확인한 뒤에만 추가한다. 확인 전에는 빈 목록 —
// 이 상태의 크론은 아무것도 쓰지 않는다.
export const FISIS_SERIES: FisisSeries[] = [];

export const hasFisisKey = (): boolean => Boolean(process.env.FISIS_API_KEY);

type FisisRow = Record<string, string | number | null>;

export type FisisResult =
  | { ok: true; key: string; points: { time: string; asOf: string; value: number }[]; name: string }
  | { ok: false; key: string; reason: string };

async function fisisFetch(
  api: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = process.env.FISIS_API_KEY;
  if (!key) throw new Error("FISIS_API_KEY 미설정");
  const qs = new URLSearchParams({ lang: "kr", auth: key, ...params });
  const res = await fetch(`${BASE}/${api}.json?${qs}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 조회 API 원본 응답 — 코드 확정용 프로브에서 그대로 반환한다 */
export async function fisisRaw(
  api: string,
  params: Record<string, string>,
): Promise<unknown> {
  // 경로 조작 방지 — API 이름은 영문자만
  if (!/^[A-Za-z]+$/.test(api)) throw new Error("잘못된 api 이름");
  return fisisFetch(api, params);
}

/** YYYYMM(분기말) → ISO(KST 자정) */
export function fisisMonthToIso(baseMonth: string): string | null {
  const m = baseMonth.match(/^(\d{4})(\d{2})$/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  // 해당 월의 마지막 날 KST 자정
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo - 1, lastDay) - 9 * 3_600_000).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fisisRange(spanMonths: number, nowMs: number): { start: string; end: string } {
  const kst = new Date(nowMs + 9 * 3_600_000);
  const end = `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}`;
  const from = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - spanMonths, 1));
  const start = `${from.getUTCFullYear()}${pad(from.getUTCMonth() + 1)}`;
  return { start, end };
}

/** 한 계열 조회 — 이름·범위 검증을 통과한 점만 돌려준다 */
export async function fetchFisisSeries(
  series: FisisSeries,
  nowMs: number,
): Promise<FisisResult> {
  const { start, end } = fisisRange(series.spanMonths, nowMs);
  let json: unknown;
  try {
    json = await fisisFetch("statisticsDataSearch", {
      financeCd: series.financeCd,
      listNo: series.listNo,
      accountCd: series.accountCd,
      term: series.term,
      startBaseMm: start,
      endBaseMm: end,
    });
  } catch (e) {
    return { ok: false, key: series.key, reason: `요청 실패: ${(e as Error).message}` };
  }

  const result = (json as { result?: { err_cd?: string; err_msg?: string; list?: FisisRow[] } })
    .result;
  if (!result || (result.err_cd && result.err_cd !== "000")) {
    return {
      ok: false,
      key: series.key,
      reason: `FISIS ${result?.err_cd ?? "?"}: ${result?.err_msg ?? "응답 형식 불일치"}`,
    };
  }
  const rows = result.list ?? [];
  if (rows.length === 0) return { ok: false, key: series.key, reason: "데이터 없음" };

  const nameOf = (r: FisisRow) =>
    `${r.list_nm ?? ""} ${r.account_nm ?? ""} ${r.finance_nm ?? ""}`;
  if (!series.expectName.test(nameOf(rows[0]))) {
    return { ok: false, key: series.key, reason: `이름 불일치: ${nameOf(rows[0]).trim()}` };
  }

  const points: { time: string; asOf: string; value: number }[] = [];
  for (const r of rows) {
    const time = String(r.base_month ?? "");
    const asOf = fisisMonthToIso(time);
    const value = Number(String(r.a ?? "").replace(/,/g, ""));
    if (!asOf || !Number.isFinite(value)) continue;
    if (value < series.min || value > series.max) continue;
    points.push({ time, asOf, value });
  }
  if (points.length === 0) return { ok: false, key: series.key, reason: "유효한 값 없음" };

  points.sort((a, b) => a.time.localeCompare(b.time));
  return { ok: true, key: series.key, points, name: nameOf(rows[0]).trim() };
}
