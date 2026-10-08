import { stripHtml } from "@/lib/format";

// 같은 사안을 여러 매체가 각자 다른 제목으로 보도하는 것을 하나로 묶는다.
// 화면용 클라이언트 클러스터링과 달리 여기서는 결과를 DB에 저장하므로,
// 흡수된 기사를 지우지 않고 cluster_id만 부여해 "소멸"을 "접힘"으로 바꾼다.
//
// 판정은 제목의 변별 토큰을 희소도(IDF)로 가중한 자카드 유사도로 한다.
// 같은 데스크 기사는 '개인정보·유출·전세사기·대출'처럼 데스크 키워드를 늘 공유하므로
// 토큰 개수만 세면 다른 사건이 한 묶음이 됐다(여의도순복음교회 유출 ↔ 구글 유출 ↔
// 덴마크 유출). 희소한 토큰(여의도순복음교회·85만·햇살론유스)이 겹쳐야 같은 사건이다.

export type ClusterInput = {
  link: string;
  title: string;
  pubDate: string;
  sourceHost?: string | null;
  matchedTerms?: string[];
};

export type ClusterAssignment = {
  link: string;
  clusterId: string;
  isRep: boolean;
  clusterHosts: number;
  wireOnly: boolean;
};

const WIRE_HOSTS = new Set([
  "yna.co.kr",
  "newsis.com",
  "news1.kr",
  "yonhapnewstv.co.kr",
]);

// 가중 자카드 임계값. 희소 토큰(숫자·금액·영문 약칭·거의 안 나오는 고유명사)을
// 공유하면 낮은 쪽을 쓴다 — "전세사기 보증금 3분의 1 보장"처럼 핵심 숫자가 겹치는데
// 표현이 다른 보도를 잡는다.
const SIM_THRESHOLD = 0.34;
const SIM_WITH_STRONG = 0.2;
// 가중 겹침계수(공유 / (공유 + 짧은 쪽에만 있는 토큰)) 임계값. 자카드는 한쪽에만 있는
// 희소 토큰("생활안정자금", "11월 대환상품")을 크게 벌점해 같은 보도자료 전재를
// 갈라놓았다 — 짧은 쪽의 핵심이 긴 쪽에 대부분 들어 있으면 같은 사안으로 본다.
// (사흘치 태그 기사 735건으로 점검: 0.33~0.5 사이의 쌍은 전부 같은 사안이었고
//  0.5로 두면 "케이뱅크 햇살론유스"·"KB국민은행 119명 유출"이 두세 묶음으로 남았다)
const OVERLAP_THRESHOLD = 0.35;
// 겹침계수는 토큰 2개 이상을 공유할 때만 쓴다 — 한 토큰짜리 제목("[인사] 개인정보보호위원회")이
// 그 토큰이 든 다른 기사에 빨려 들어가지 않게
const OVERLAP_MIN_SHARED = 2;
// 제목 글자 2-gram이 이만큼 겹치면 표현이 거의 같은 전재 기사다
const DICE_VERBATIM = 0.6;
// 한 묶음이 걸칠 수 있는 최대 날짜 수(KST). 사흘짜리 사안(예고→부과→반응)은 잇고,
// 그 이상은 새 묶음으로 끊어 '개인정보 유출'류 상시 주제가 한 덩어리로 자라지 않게 한다.
const MAX_SPAN_DAYS = 3;
// 희소 토큰 기준 — 전체 집합에서 이 횟수 이하로 나오는 토큰
const RARE_DF = 3;
const STRONG_MAX_DF = 50;

function bigrams(norm: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) out.add(norm.slice(i, i + 2));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

const normTitle = (title: string): string =>
  stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// 제목에 흔한 채움말 — 변별력이 없어 토큰으로 세지 않는다
const TOKEN_STOP = new Set([
  "정부", "발표", "검토", "추진", "강화", "확대", "방안", "대책", "계획",
  "전망", "우려", "논란", "국내", "올해", "내년", "지난해", "오늘", "이번",
  "관련", "최대", "역대", "돌파", "급증", "급감", "단독", "속보", "종합",
  "위한", "위해", "대상", "통해", "따라", "대해", "대한", "오는", "지난",
  "이달", "이날", "지금", "가능", "본격", "잇단", "잇따라", "또", "등", "및",
]);

// 조사·보조사 — 떼어 "KB증권에"와 "KB증권", "은행은"과 "은행"이 같은 토큰이 되게 한다.
// 떼고 나서 한 글자만 남으면(한도→한, 결과→결) 원래 토큰을 쓴다.
const PARTICLE =
  /(에서는|으로는|에게는|까지|부터|에서|에게|으로|이라|라며|처럼|보다|마다|조차|마저|밖에|이나|이며|은|는|이|가|을|를|에|의|로|와|과|도|만)$/u;

/**
 * 금액 표기를 통일한다. 같은 제재를 두고 매체마다
 * "539억" · "539억원" · "539.7억" · "540억" 처럼 달리 쓰기 때문에
 * 그대로 두면 같은 사건인데도 공유 토큰이 잡히지 않는다.
 */
function normalizeAmount(token: string): string | null {
  const m = token.match(/^(\d+(?:\.\d+)?)(억|조|만|천)/u);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  // 반올림 오차(539 vs 540)를 흡수하도록 10 단위로 맞춘다
  const rounded = value >= 100 ? Math.round(value / 10) * 10 : Math.round(value);
  return `${rounded}${m[2]}`;
}

/**
 * 사건을 특정하는 "변별 토큰" — 숫자·금액, 영문 약칭, 2자 이상 단어.
 * 같은 사건 보도는 표현이 달라도 이 토큰들을 공유한다.
 */
export function keyTokens(title: string): Set<string> {
  const raw = stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out = new Set<string>();
  for (const tk of raw) {
    // 숫자 토큰은 조사를 떼지 않는다 — "85만"에서 '만'을 떼면 금액이 사라진다
    if (/^\d/.test(tk)) {
      const amount = normalizeAmount(tk);
      if (amount) out.add(amount);
      else if (tk.length >= 2) out.add(tk.replace(/(명|건|곳|개|원|년|월|일|시|분|배|차|호|회)$/u, "") || tk);
      continue;
    }
    const stripped = tk.replace(PARTICLE, "");
    const w = stripped.length >= 2 ? stripped : tk;
    // 기업 약칭은 짧아도 사건을 특정한다 (KT, SK, LG, KB)
    if (/^[a-z]{2,}$/.test(w)) {
      out.add(w);
      continue;
    }
    // "kt새노조"·"sk하이닉스"처럼 약칭에 한글이 붙은 토큰에서 약칭을 따로 뽑는다
    const prefix = w.match(/^([a-z]{2,4})[가-힣]/);
    if (prefix) out.add(prefix[1]);
    if (TOKEN_STOP.has(w)) continue;
    if (w.length >= 2) out.add(w);
  }
  return out;
}

/**
 * 기관명 나열형 소식란 — "[금융레이더] iM금융그룹/카카오뱅크/BNK부산은행/…",
 * "[오늘의 금융ESG] 우리금융·우리은행·BNK부산은행·KB국민카드·…".
 * 희소한 기관명을 여럿 품고 있어 어느 사건 묶음에든 끼어들고, 가장 새 기사면
 * 그 묶음의 대표가 되어 목록에 사건 대신 소식란 제목이 떴다. 토큰을 주지 않아
 * 혼자 남게 한다(제목이 완전히 같은 전재끼리는 그래도 묶인다).
 */
function isDigest(title: string): boolean {
  const body = stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s*(外|외)\s*$/u, "")
    .trim();
  const seps = (body.match(/[·\/,]/g) ?? []).length;
  const words = body.split(/\s+/).filter(Boolean).length;
  return seps >= 3 && words <= 2;
}

// KST 기준 날짜 번호 — UTC로 나누면 09:00 KST 경계에서 같은 사안이 갈라진다
function kstDayNum(pubDate: string): number {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((d.getTime() + 9 * 3_600_000) / 86_400_000);
}

const hostOfEntry = (e: ClusterInput): string =>
  (e.sourceHost ?? "").replace(/^www\./, "");

type Prepared = {
  it: ClusterInput;
  day: number;
  time: number;
  norm: string;
  grams: Set<string>;
  tokens: string[];
  weight: number; // Σ w(token)
};

type Cluster = {
  id: string;
  firstDay: number;
  days: Set<number>;
  repGrams: Set<string>;
  norms: Set<string>;
  // 토큰 프로필 — 구성원 중 몇 건이 그 토큰을 가졌는지. 대표 한 건과만 비교하면
  // 그 날 가장 먼저 들어온 기사가 특이한 제목일 때 묶음 전체가 흔들렸다.
  profile: Map<string, number>;
  members: Prepared[];
};

/**
 * 희소도 가중 토큰 유사도 기반 단일 패스 클러스터링.
 *
 * - 토큰 가중치 w = ln(N/df)² — 집합 안에서 흔한 토큰(개인정보·대출·금융)은 거의 0,
 *   드문 토큰(여의도순복음교회·85만·햇살론유스)은 크다.
 * - 기사 ↔ 묶음 유사도 = 가중 자카드(묶음 쪽은 토큰별 구성원 비율로 희석).
 * - 비교 범위는 같은 KST 날짜와 전날에 등록된 묶음. 묶음은 구성원이 들어온 날마다
 *   등록되므로 사흘짜리 사안이 이어지되(MAX_SPAN_DAYS), 비교는 늘 프로필 전체와
 *   하므로 연쇄 병합(A~B, B~C ⇒ A~C)으로 멀리 떠내려가지 않는다.
 * - 역색인으로 토큰을 하나라도 공유하는 묶음만 후보로 본다 — O(n²)를 피한다.
 */
export function assignClusters(items: ClusterInput[]): ClusterAssignment[] {
  const prepared: Prepared[] = items.map((it) => {
    const norm = normTitle(it.title);
    return {
      it,
      day: kstDayNum(it.pubDate),
      time: new Date(it.pubDate).getTime(),
      norm,
      grams: bigrams(norm),
      tokens: isDigest(it.title) ? [] : Array.from(keyTokens(it.title)),
      weight: 0,
    };
  });

  // 문서 빈도 → 가중치
  const df = new Map<string, number>();
  for (const p of prepared) for (const t of p.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(prepared.length, 2);
  const weightOf = (t: string): number => {
    const f = df.get(t) ?? 1;
    const idf = Math.log(n / f);
    return idf > 0 ? idf * idf : 0;
  };
  const isStrong = (t: string): boolean => {
    const f = df.get(t) ?? 1;
    if (f <= RARE_DF && t.length >= 3) return true;
    return f <= STRONG_MAX_DF && (/\d/.test(t) || /^[a-z]{2,}$/.test(t));
  };
  for (const p of prepared) p.weight = p.tokens.reduce((s, t) => s + weightOf(t), 0);

  // 날짜 버킷 — 오래된 날짜부터, 그 안에서는 최신순(가장 새 기사가 묶음 id가 된다)
  const buckets = new Map<number, Prepared[]>();
  for (const p of prepared) {
    const arr = buckets.get(p.day);
    if (arr) arr.push(p);
    else buckets.set(p.day, [p]);
  }
  const days = Array.from(buckets.keys()).sort((a, b) => a - b);

  const clusters: Cluster[] = [];
  // 역색인: 날짜 → 토큰 → 묶음
  const index = new Map<number, Map<string, Cluster[]>>();
  const register = (c: Cluster, day: number, tokens: Iterable<string>) => {
    let byToken = index.get(day);
    if (!byToken) {
      byToken = new Map();
      index.set(day, byToken);
    }
    for (const t of tokens) {
      const arr = byToken.get(t);
      if (arr) {
        if (arr[arr.length - 1] !== c) arr.push(c);
      } else byToken.set(t, [c]);
    }
    c.days.add(day);
  };

  // 기사 ↔ 묶음 비교. 묶음 쪽 토큰은 구성원 비율로 희석한 프로필을 쓴다.
  type Match = { jaccard: number; overlap: number; shared: number; strong: boolean };
  const compare = (p: Prepared, c: Cluster): Match => {
    const none = { jaccard: 0, overlap: 0, shared: 0, strong: false };
    if (!p.tokens.length || !c.profile.size) return none;
    const size = c.members.length;
    let inter = 0;
    let mineOnly = 0;
    let theirsOnly = 0;
    let shared = 0;
    let strong = false;
    const mine = new Set(p.tokens);
    for (const [t, cnt] of c.profile) {
      const w = (weightOf(t) * cnt) / size;
      if (mine.has(t)) {
        inter += w;
        shared++;
        if (!strong && isStrong(t)) strong = true;
      } else theirsOnly += w;
    }
    for (const t of p.tokens) if (!c.profile.has(t)) mineOnly += weightOf(t);
    const union = inter + mineOnly + theirsOnly;
    const smaller = Math.min(mineOnly, theirsOnly);
    return {
      jaccard: union > 0 ? inter / union : 0,
      overlap: inter + smaller > 0 ? inter / (inter + smaller) : 0,
      shared,
      strong,
    };
  };
  const accept = (m: Match): boolean =>
    m.jaccard >= SIM_THRESHOLD ||
    (m.shared >= OVERLAP_MIN_SHARED && m.overlap >= OVERLAP_THRESHOLD) ||
    (m.shared >= OVERLAP_MIN_SHARED && m.strong && m.jaccard >= SIM_WITH_STRONG);
  const scoreOf = (m: Match): number => Math.max(m.jaccard, m.shared >= OVERLAP_MIN_SHARED ? m.overlap : 0);

  for (const day of days) {
    const sorted = buckets.get(day)!.slice().sort((a, b) => b.time - a.time);
    for (const p of sorted) {
      // 후보: 오늘·어제 색인에서 토큰을 하나라도 공유하는 묶음
      const seen = new Set<Cluster>();
      for (const d of [day, day - 1]) {
        const byToken = index.get(d);
        if (!byToken) continue;
        for (const t of p.tokens) {
          const arr = byToken.get(t);
          if (arr) for (const c of arr) seen.add(c);
        }
      }

      let best: Cluster | null = null;
      let bestScore = 0;
      for (const c of seen) {
        if (day - c.firstDay >= MAX_SPAN_DAYS) continue;
        // 제목이 완전히 같으면 무조건 같은 사안 (통신사 전재 등)
        if (p.norm.length > 0 && c.norms.has(p.norm)) {
          best = c;
          bestScore = Infinity;
          break;
        }
        const m = compare(p, c);
        const d = dice(p.grams, c.repGrams);
        if (!accept(m) && d < DICE_VERBATIM) continue;
        const score = Math.max(scoreOf(m), d);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      if (best) {
        best.members.push(p);
        best.norms.add(p.norm);
        for (const t of p.tokens) best.profile.set(t, (best.profile.get(t) ?? 0) + 1);
        if (!best.days.has(day)) register(best, day, best.profile.keys());
        else register(best, day, p.tokens);
      } else {
        const c: Cluster = {
          id: p.it.link,
          firstDay: day,
          days: new Set(),
          repGrams: p.grams,
          norms: new Set(p.norm ? [p.norm] : []),
          profile: new Map(p.tokens.map((t) => [t, 1])),
          members: [p],
        };
        clusters.push(c);
        register(c, day, p.tokens);
      }
    }
  }

  // ---- 묶음 간 병합 패스 --------------------------------------------------
  // 단일 패스는 그 날 가장 먼저 들어온(가장 새) 기사가 특이한 제목이면 같은 사안이
  // 두세 묶음으로 갈라진다. 프로필이 다 찬 뒤 묶음끼리 한 번 더 비교해 합친다.
  const dead = new Set<Cluster>();
  const profileMatch = (a: Cluster, b: Cluster): Match => {
    let inter = 0;
    let aOnly = 0;
    let bOnly = 0;
    let shared = 0;
    let strong = false;
    const sa = a.members.length;
    const sb = b.members.length;
    for (const [t, cnt] of a.profile) {
      const wa = (weightOf(t) * cnt) / sa;
      const cb = b.profile.get(t);
      if (cb) {
        const wb = (weightOf(t) * cb) / sb;
        inter += Math.min(wa, wb);
        aOnly += Math.max(0, wa - wb);
        bOnly += Math.max(0, wb - wa);
        shared++;
        if (!strong && isStrong(t)) strong = true;
      } else aOnly += wa;
    }
    for (const [t, cnt] of b.profile) if (!a.profile.has(t)) bOnly += (weightOf(t) * cnt) / sb;
    const union = inter + aOnly + bOnly;
    const smaller = Math.min(aOnly, bOnly);
    return {
      jaccard: union > 0 ? inter / union : 0,
      overlap: inter + smaller > 0 ? inter / (inter + smaller) : 0,
      shared,
      strong,
    };
  };
  for (let pass = 0; pass < 2; pass++) {
    let merged = 0;
    for (const c of clusters) {
      if (dead.has(c)) continue;
      const seen = new Set<Cluster>();
      for (const day of c.days) {
        for (const d of [day - 1, day, day + 1]) {
          const byToken = index.get(d);
          if (!byToken) continue;
          for (const t of c.profile.keys()) {
            const arr = byToken.get(t);
            if (arr) for (const o of arr) if (o !== c && !dead.has(o)) seen.add(o);
          }
        }
      }
      for (const o of seen) {
        if (dead.has(c)) break;
        const lo = Math.min(c.firstDay, o.firstDay);
        const hi = Math.max(...c.days, ...o.days);
        if (hi - lo >= MAX_SPAN_DAYS) continue;
        if (!accept(profileMatch(c, o))) continue;
        // 먼저 생긴 묶음(firstDay가 이른 쪽)이 남는다
        const [keep, drop] = c.firstDay <= o.firstDay ? [c, o] : [o, c];
        for (const m of drop.members) keep.members.push(m);
        for (const nm of drop.norms) keep.norms.add(nm);
        for (const [t, cnt] of drop.profile) keep.profile.set(t, (keep.profile.get(t) ?? 0) + cnt);
        for (const day of new Set([...keep.days, ...drop.days])) register(keep, day, keep.profile.keys());
        dead.add(drop);
        merged++;
      }
    }
    if (!merged) break;
  }

  const assignments: ClusterAssignment[] = [];
  for (const c of clusters) {
    if (dead.has(c)) continue;
    const hosts = new Set(c.members.map((m) => hostOfEntry(m.it)).filter(Boolean));
    const wireOnly =
      hosts.size > 0 && Array.from(hosts).every((h) => WIRE_HOSTS.has(h));
    // 대표는 묶음에서 가장 최신 기사 — 다음 날 후속 보도가 흡수되면
    // 그 후속이 대표가 되어 목록이 항상 최신 국면을 보여준다
    let repIdx = 0;
    let repTime = -Infinity;
    c.members.forEach((m, i) => {
      if (Number.isFinite(m.time) && m.time > repTime) {
        repTime = m.time;
        repIdx = i;
      }
    });
    c.members.forEach((m, i) => {
      assignments.push({
        link: m.it.link,
        clusterId: c.id,
        isRep: i === repIdx,
        clusterHosts: Math.max(1, hosts.size),
        wireOnly,
      });
    });
  }

  return assignments;
}
