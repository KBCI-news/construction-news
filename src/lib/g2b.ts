// ---------------------------------------------------------------------------
// 나라장터(조달청) 입찰공고정보서비스 클라이언트
//   공공데이터포털 <https://www.data.go.kr/data/15129394/openapi.do>
//
// 이 서비스는 엔드포인트 버전이 몇 차례 바뀌었고(BidPublicInfoService01~04 →
// /ad/BidPublicInfoService), 배포 시점마다 유효한 경로가 다르다. 코드에 하나를
// 박아두면 어느 날 조용히 0건이 되므로, 후보 경로를 순서대로 시도해 처음
// 성공한 것을 프로세스 수명 동안 재사용한다. 실제로 어떤 경로가 살아 있는지는
// /api/cron/bids?probe=1 로 확인한다.
// ---------------------------------------------------------------------------

const DEFAULT_BASES = [
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
  "https://apis.data.go.kr/1230000/BidPublicInfoService04",
  "http://apis.data.go.kr/1230000/BidPublicInfoService04",
];

/** 업무구분 — 오퍼레이션과 1:1. 문서 전자화·조사 용역은 대부분 '용역'이다. */
export const WORK_DIVS = {
  용역: "getBidPblancListInfoServc",
  물품: "getBidPblancListInfoThng",
  공사: "getBidPblancListInfoCnstwk",
} as const;

export type WorkDiv = keyof typeof WORK_DIVS;

/** 기본 수집 대상. 스캐너·저장장치 구매가 물품으로 올라오므로 둘 다 본다. */
export const DEFAULT_WORK_DIVS: WorkDiv[] = ["용역", "물품"];

const KST_OFFSET_MS = 9 * 3_600_000;

export const hasG2bKey = (): boolean => Boolean(process.env.G2B_SERVICE_KEY);

function bases(): string[] {
  const override = process.env.G2B_BASE_URL?.trim();
  return override ? [override, ...DEFAULT_BASES] : DEFAULT_BASES;
}

/**
 * 공공데이터포털은 인코딩 키와 디코딩 키를 함께 발급한다. 인코딩 키를
 * 다시 encodeURIComponent 하면 '%2B'가 '%252B'가 되어 인증이 깨진다.
 */
function keyParam(): string {
  const key = process.env.G2B_SERVICE_KEY ?? "";
  return key.includes("%") ? key : encodeURIComponent(key);
}

/** Date → 나라장터가 요구하는 KST 기준 'YYYYMMDDHHmm' */
export function toKstStamp(date: Date): string {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}` +
    `${p(k.getUTCHours())}${p(k.getUTCMinutes())}`
  );
}

/**
 * 응답의 일시 문자열을 ISO로 바꾼다. 값에 타임존이 없고 항상 KST다.
 * '2025-08-18 14:00:00' / '202508181400' / '2025-08-18' 모두 받는다.
 */
export function parseKst(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const n = (from: number, len: number) => Number(digits.slice(from, from + len) || "0");
  const y = n(0, 4);
  const mo = n(4, 2);
  const d = n(6, 2);
  if (!y || !mo || !d) return null;
  const h = digits.length >= 10 ? n(8, 2) : 0;
  const mi = digits.length >= 12 ? n(10, 2) : 0;
  const s = digits.length >= 14 ? n(12, 2) : 0;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - KST_OFFSET_MS;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** '1,234,000.00' → 1234000. 값이 없거나 0이면 null. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = Math.round(Number(cleaned));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export type G2bRow = Record<string, unknown>;

export type G2bPage = {
  ok: boolean;
  rows: G2bRow[];
  totalCount: number;
  /** 성공한 베이스 URL — 진단용 */
  base: string | null;
  /** 실패 사유(결과코드/메시지). ok=false일 때만 채워진다. */
  error?: string;
};

const str = (row: G2bRow, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
};

/** 응답 본문에서 목록을 꺼낸다. items가 배열/단건/{item:...} 세 형태로 온다. */
function extractItems(body: unknown): G2bRow[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as Record<string, unknown>).items;
  if (Array.isArray(items)) return items as G2bRow[];
  if (items && typeof items === "object") {
    const inner = (items as Record<string, unknown>).item;
    if (Array.isArray(inner)) return inner as G2bRow[];
    if (inner && typeof inner === "object") return [inner as G2bRow];
    return [items as G2bRow];
  }
  return [];
}

/** 공공데이터포털은 키 오류 시 JSON 대신 XML 오류봉투를 준다. */
function readErrorEnvelope(text: string): string | null {
  const reason = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)?.[1];
  const code = text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/)?.[1];
  if (reason || code) return [reason, code && `code=${code}`].filter(Boolean).join(" ");
  if (/^\s*</.test(text)) return `비JSON 응답: ${text.slice(0, 160)}`;
  return null;
}

let cachedBase: string | null = null;

async function callOnce(
  base: string,
  operation: string,
  params: Record<string, string>,
): Promise<G2bPage> {
  const qs = new URLSearchParams({ ...params, type: "json" }).toString();
  const url = `${base}/${operation}?serviceKey=${keyParam()}&${qs}`;

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let text: string;
    try {
      const res = await fetch(url, { cache: "no-store" });
      text = await res.text();
      if (!res.ok && res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "fetch 실패";
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    const envelope = readErrorEnvelope(text);
    if (envelope) return { ok: false, rows: [], totalCount: 0, base, error: envelope };

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        rows: [],
        totalCount: 0,
        base,
        error: `JSON 파싱 실패: ${text.slice(0, 160)}`,
      };
    }

    const response = (json.response ?? json) as Record<string, unknown>;
    const header = (response.header ?? {}) as Record<string, unknown>;
    const code = String(header.resultCode ?? "");
    if (code && code !== "00" && code !== "0") {
      return {
        ok: false,
        rows: [],
        totalCount: 0,
        base,
        error: `resultCode=${code} ${String(header.resultMsg ?? "")}`.trim(),
      };
    }

    const body = (response.body ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      rows: extractItems(body),
      totalCount: Number(body.totalCount ?? 0) || 0,
      base,
    };
  }

  return { ok: false, rows: [], totalCount: 0, base, error: lastError || "재시도 소진" };
}

/** 후보 베이스를 순서대로 시도한다. 한 번 성공하면 그 경로를 계속 쓴다. */
async function call(
  operation: string,
  params: Record<string, string>,
): Promise<G2bPage> {
  const candidates = cachedBase ? [cachedBase, ...bases().filter((b) => b !== cachedBase)] : bases();
  let last: G2bPage | null = null;
  for (const base of candidates) {
    const page = await callOnce(base, operation, params);
    if (page.ok) {
      cachedBase = base;
      return page;
    }
    last = page;
    // 키 자체가 잘못된 경우는 경로를 바꿔도 소용없다
    if (page.error && /SERVICE_KEY|SERVICE ACCESS DENIED|등록되지/i.test(page.error)) break;
  }
  return last ?? { ok: false, rows: [], totalCount: 0, base: null, error: "후보 경로 없음" };
}

export type FetchWindow = {
  workDiv: WorkDiv;
  from: Date;
  to: Date;
  numOfRows?: number;
  maxPages?: number;
};

export type FetchResult = {
  ok: boolean;
  rows: G2bRow[];
  totalCount: number;
  pages: number;
  /** maxPages에 걸려 뒷부분을 못 읽었으면 true — 조용히 자르지 않는다 */
  truncated: boolean;
  base: string | null;
  error?: string;
};

/** 공고게시일시(inqryDiv=1) 기준으로 창(window) 안의 공고를 전부 가져온다. */
export async function fetchBidWindow(opts: FetchWindow): Promise<FetchResult> {
  const numOfRows = opts.numOfRows ?? 300;
  const maxPages = opts.maxPages ?? 8;
  const operation = WORK_DIVS[opts.workDiv];

  const rows: G2bRow[] = [];
  let totalCount = 0;
  let pages = 0;
  let base: string | null = null;

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const page = await call(operation, {
      inqryDiv: "1",
      inqryBgnDt: toKstStamp(opts.from),
      inqryEndDt: toKstStamp(opts.to),
      pageNo: String(pageNo),
      numOfRows: String(numOfRows),
    });
    pages = pageNo;
    base = page.base;
    if (!page.ok) {
      return { ok: false, rows, totalCount, pages, truncated: false, base, error: page.error };
    }
    totalCount = page.totalCount || totalCount;
    rows.push(...page.rows);
    if (page.rows.length < numOfRows) {
      return { ok: true, rows, totalCount, pages, truncated: false, base };
    }
  }

  return {
    ok: true,
    rows,
    totalCount,
    pages,
    truncated: rows.length < totalCount,
    base,
  };
}

/** 진단용 — 1건만 받아 응답 원형과 살아 있는 베이스 경로를 확인한다. */
export async function probeG2b(workDiv: WorkDiv, from: Date, to: Date) {
  const page = await call(WORK_DIVS[workDiv], {
    inqryDiv: "1",
    inqryBgnDt: toKstStamp(from),
    inqryEndDt: toKstStamp(to),
    pageNo: "1",
    numOfRows: "1",
  });
  return {
    ok: page.ok,
    base: page.base,
    totalCount: page.totalCount,
    error: page.error,
    sample: page.rows[0] ?? null,
    sampleKeys: page.rows[0] ? Object.keys(page.rows[0]) : [],
  };
}

export type NormalizedBid = {
  bidKey: string;
  bidNo: string;
  bidOrd: string;
  title: string;
  workDiv: string;
  noticeKind: string | null;
  contractMethod: string | null;
  noticeAgency: string | null;
  demandAgency: string | null;
  region: string | null;
  presmptPrice: number | null;
  budgetAmount: number | null;
  noticeDt: string | null;
  beginDt: string | null;
  closeDt: string | null;
  openingDt: string | null;
  detailUrl: string | null;
  refNo: string | null;
};

/**
 * 오퍼레이션(용역/물품/공사)마다 필드명이 조금씩 다르고 개편도 잦아,
 * 후보 키를 나열해 먼저 잡히는 값을 쓴다.
 */
export function normalizeBid(row: G2bRow, workDiv: WorkDiv): NormalizedBid | null {
  const bidNo = str(row, "bidNtceNo");
  const title = str(row, "bidNtceNm");
  if (!bidNo || !title) return null;
  const bidOrd = str(row, "bidNtceOrd") ?? "00";

  return {
    bidKey: `${bidNo}-${bidOrd}`,
    bidNo,
    bidOrd,
    title,
    workDiv,
    noticeKind: str(row, "ntceKindNm"),
    contractMethod: str(row, "cntrctCnclsMthdNm", "bidMethdNm"),
    noticeAgency: str(row, "ntceInsttNm"),
    demandAgency: str(row, "dminsttNm"),
    region: str(row, "prtcptPsblRgnNm", "rgnLmtBidLocplcJdgmBssNm"),
    presmptPrice: parseAmount(row.presmptPrce),
    budgetAmount: parseAmount(row.asignBdgtAmt ?? row.bdgtAmt),
    noticeDt: parseKst(row.bidNtceDt ?? row.rgstDt),
    beginDt: parseKst(row.bidBeginDt),
    closeDt: parseKst(row.bidClseDt),
    openingDt: parseKst(row.opengDt),
    detailUrl: str(row, "bidNtceDtlUrl", "bidNtceUrl"),
    refNo: str(row, "refNo"),
  };
}
