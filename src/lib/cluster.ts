import { stripHtml } from "@/lib/format";

// 같은 사안을 여러 매체가 각자 다른 제목으로 보도하는 것을 하나로 묶는다.
// 화면용 클라이언트 클러스터링과 달리 여기서는 결과를 DB에 저장하므로,
// 흡수된 기사를 지우지 않고 cluster_id만 부여해 "소멸"을 "접힘"으로 바꾼다.

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

const SIM_THRESHOLD = 0.42;
// 변별 토큰을 2개 이상 공유할 때 적용하는 완화 임계값
const LOOSE_THRESHOLD = 0.28;

function bigrams(title: string): Set<string> {
  const s = stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
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

/**
 * 사건을 특정하는 "변별 토큰" — 숫자를 포함한 토큰(540억, 2.1억)과 3자 이상 단어.
 * 같은 사건 보도는 표현이 달라도 이 토큰들을 공유한다.
 */
function keyTokens(title: string): Set<string> {
  const raw = stripHtml(title)
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out = new Set<string>();
  for (const tk of raw) {
    // 조사를 떼어 "KB증권에" 와 "KB증권" 이 같은 토큰이 되게 한다
    const t = tk.replace(/(에서|에게|으로|이라|라며|은|는|이|가|을|를|에|의|로|와|과|도)$/u, "");
    const w = t.length >= 2 ? t : tk;

    const amount = normalizeAmount(w);
    if (amount) {
      out.add(amount);
      continue;
    }
    // 기업 약칭은 짧아도 사건을 특정한다 (KT, SK, LG, KB)
    if (/^[a-z]{2,}$/.test(w)) {
      out.add(w);
      continue;
    }
    if (/\d/.test(w) && w.length >= 2) out.add(w);
    else if (w.length >= 3) out.add(w);
  }
  return out;
}

/**
 * 금액 표기를 통일한다. 같은 제재를 두고 매체마다
 * "539억" · "539억원" · "539.7억" · "540억" 처럼 달리 쓰기 때문에
 * 그대로 두면 같은 사건인데도 공유 토큰이 잡히지 않는다.
 */
function normalizeAmount(token: string): string | null {
  const m = token.match(/^(\d+(?:\.\d+)?)(억|조|만)/u);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  // 반올림 오차(539 vs 540)를 흡수하도록 10 단위로 맞춘다
  const rounded = value >= 100 ? Math.round(value / 10) * 10 : Math.round(value);
  return `${rounded}${m[2]}`;
}

function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  const out: string[] = [];
  for (const x of small) if (large.has(x)) out.push(x);
  return out;
}

// 금액(540억)과 기업 약칭(kt, kb)은 사건을 특정하는 강한 신호다.
const isStrongToken = (t: string): boolean =>
  /^\d+(억|조|만)$/u.test(t) || /^[a-z]{2,4}$/.test(t);

// KST 기준 날짜 버킷 — UTC로 나누면 09:00 KST 경계에서 같은 사안이 갈라진다
function kstDayKey(pubDate: string): string {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "_";
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${kst.getUTCMonth()}-${kst.getUTCDate()}`;
}

const hostOfEntry = (e: ClusterInput): string =>
  (e.sourceHost ?? "").replace(/^www\./, "");

/**
 * 대표(medoid)와만 비교하는 단일 패스 클러스터링.
 * 단일연결 전이 병합(A~B, B~C ⇒ A~C)을 허용하지 않아 대형 오병합이 생기지 않는다.
 */
export function assignClusters(items: ClusterInput[]): ClusterAssignment[] {
  // 버킷: KST 날짜별로만 비교해 비용과 오병합을 함께 줄인다
  const buckets = new Map<string, ClusterInput[]>();
  for (const it of items) {
    const k = kstDayKey(it.pubDate);
    const arr = buckets.get(k);
    if (arr) arr.push(it);
    else buckets.set(k, [it]);
  }

  type Cluster = {
    id: string;
    repIndexTitle: Set<string>;
    repTerms: Set<string>;
    repKeys: Set<string>;
    repNorm: string;
    members: ClusterInput[];
  };

  const assignments: ClusterAssignment[] = [];

  for (const [, bucket] of buckets) {
    // 최신순으로 처리해 가장 새로운 기사가 대표가 되게 한다
    const sorted = bucket
      .slice()
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    const clusters: Cluster[] = [];

    for (const it of sorted) {
      const grams = bigrams(it.title);
      const terms = new Set(it.matchedTerms ?? []);
      const keys = keyTokens(it.title);
      const norm = normTitle(it.title);
      let placed = false;

      for (const c of clusters) {
        const d = dice(grams, c.repIndexTitle);
        // 제목이 완전히 같으면 무조건 같은 사안 (통신사 전재 등)
        const identical = norm.length > 0 && norm === c.repNorm;
        // 같은 사건은 표현이 달라도 변별 토큰(숫자·고유명사)을 공유한다.
        // 예: "KT 과징금 540억…증거 은닉" ↔ "불법 기지국에 뚫린 KT, 유출 540억 과징금"
        const shared = sharedTokens(keys, c.repKeys);
        const strong = shared.filter(isStrongToken).length;
        // 제목 표현이 크게 달라도 강한 신호가 겹치면 같은 사건으로 본다.
        // 예: "KT 500억 원대 과징금" ↔ "KT, 1만6647명 유출로 539억원 과징금"
        const sameEvent =
          strong >= 2 ||
          (strong >= 1 && shared.length >= 3) ||
          (shared.length >= 2 && d >= LOOSE_THRESHOLD);

        if (!identical && d < SIM_THRESHOLD && !sameEvent) continue;

        // 제목이 비슷해도 업권 term을 공유하지 않으면 다른 사안으로 본다
        if (!identical && c.repTerms.size && terms.size) {
          let shared = false;
          for (const t of terms) {
            if (c.repTerms.has(t)) {
              shared = true;
              break;
            }
          }
          if (!shared) continue;
        }
        c.members.push(it);
        placed = true;
        break;
      }

      if (!placed) {
        clusters.push({
          id: it.link,
          repIndexTitle: grams,
          repTerms: terms,
          repKeys: keys,
          repNorm: norm,
          members: [it],
        });
      }
    }

    for (const c of clusters) {
      const hosts = new Set(c.members.map(hostOfEntry).filter(Boolean));
      const wireOnly =
        hosts.size > 0 && Array.from(hosts).every((h) => WIRE_HOSTS.has(h));
      c.members.forEach((m, i) => {
        assignments.push({
          link: m.link,
          clusterId: c.id,
          isRep: i === 0,
          clusterHosts: Math.max(1, hosts.size),
          wireOnly,
        });
      });
    }
  }

  return assignments;
}
