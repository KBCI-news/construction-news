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

// 제목에 흔한 채움말 — 변별력이 없어 공유 토큰으로 세지 않는다
const TOKEN_STOP = new Set([
  "정부", "발표", "검토", "추진", "강화", "확대", "방안", "대책", "계획",
  "전망", "우려", "논란", "국내", "올해", "내년", "지난해", "오늘", "이번",
  "관련", "최대", "역대", "돌파", "급증", "급감", "단독", "속보", "종합",
]);

/**
 * 사건을 특정하는 "변별 토큰" — 숫자를 포함한 토큰(540억, 2.1억)과 2자 이상 단어.
 * 같은 사건 보도는 표현이 달라도 이 토큰들을 공유한다.
 * (3자 이상만 세면 유출·해킹·부과·티빙처럼 사건을 특정하는 2자 한자어가
 *  전부 빠져 "KT 540억 과징금" 보도들이 서로 다른 사건으로 남았다)
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
    // "kt새노조"·"sk하이닉스"처럼 약칭에 한글이 붙은 토큰에서 약칭을 따로 뽑는다
    // — 이걸 놓치면 "KT새노조 539억…"과 "KT 540억 과징금"이 다른 사건이 된다
    const prefix = w.match(/^([a-z]{2,4})[가-힣]/);
    if (prefix) out.add(prefix[1]);
    if (TOKEN_STOP.has(w)) continue;
    if (/\d/.test(w) && w.length >= 2) out.add(w);
    else if (w.length >= 2) out.add(w);
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

// KST 기준 날짜 번호 — UTC로 나누면 09:00 KST 경계에서 같은 사안이 갈라진다
function kstDayNum(pubDate: string): number {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((d.getTime() + 9 * 3_600_000) / 86_400_000);
}

const hostOfEntry = (e: ClusterInput): string =>
  (e.sourceHost ?? "").replace(/^www\./, "");

/**
 * 대표(medoid)와만 비교하는 단일 패스 클러스터링.
 * 단일연결 전이 병합(A~B, B~C ⇒ A~C)을 허용하지 않아 대형 오병합이 생기지 않는다.
 *
 * 비교 범위는 같은 KST 날짜 + 전날의 클러스터.
 * 하루 단위로만 자르면 "심의 예고(수) → 부과(목) → 반응(금)"처럼 이어지는
 * 사안이 날짜마다 새 대표를 만들어 같은 사건이 3~4번 노출됐다.
 */
export function assignClusters(items: ClusterInput[]): ClusterAssignment[] {
  // 버킷: KST 날짜별. 비교는 자기 날짜와 전날까지만 — 비용과 오병합을 함께 줄인다.
  const buckets = new Map<number, ClusterInput[]>();
  for (const it of items) {
    const k = kstDayNum(it.pubDate);
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
  const clustersByDay = new Map<number, Cluster[]>();
  // 오래된 날짜부터 처리해야 다음 날 기사가 전날 클러스터에 흡수될 수 있다
  const days = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const day of days) {
    // 최신순으로 처리해 가장 새로운 기사가 그 날의 대표가 되게 한다
    const sorted = buckets
      .get(day)!
      .slice()
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    const clusters: Cluster[] = [];
    clustersByDay.set(day, clusters);
    const prevDay = clustersByDay.get(day - 1) ?? [];

    for (const it of sorted) {
      const grams = bigrams(it.title);
      const terms = new Set(it.matchedTerms ?? []);
      const keys = keyTokens(it.title);
      const norm = normTitle(it.title);
      let placed = false;

      for (const c of [...clusters, ...prevDay]) {
        const d = dice(grams, c.repIndexTitle);
        // 제목이 완전히 같으면 무조건 같은 사안 (통신사 전재 등)
        const identical = norm.length > 0 && norm === c.repNorm;
        // 같은 사건은 표현이 달라도 변별 토큰(숫자·고유명사)을 공유한다.
        // 예: "KT 과징금 540억…증거 은닉" ↔ "불법 기지국에 뚫린 KT, 유출 540억 과징금"
        const shared = sharedTokens(keys, c.repKeys);
        const strong = shared.filter(isStrongToken).length;
        // 제목 표현이 크게 달라도 강한 신호가 겹치면 같은 사건으로 본다.
        // 예: "KT 500억 원대 과징금" ↔ "KT, 1만6647명 유출로 539억원 과징금"
        // 변별 토큰 4개 이상 공유는 그 자체로 같은 사건이다
        // ("박용갑 전세사기 연대보증 추심 중단"류의 표현 변주를 잡는다).
        const sameEvent =
          strong >= 2 ||
          (strong >= 1 && shared.length >= 3) ||
          shared.length >= 4 ||
          (shared.length >= 2 && d >= LOOSE_THRESHOLD);

        if (!identical && d < SIM_THRESHOLD && !sameEvent) continue;

        // 변별 신호가 아주 강하면(기업 약칭+금액 2개 이상, 또는 강신호+4토큰)
        // term 일치까지 요구하지 않는다 — 같은 KT 과징금 사건인데 한쪽은
        // "개인정보보호법", 한쪽은 "개인정보보호위원회"에 걸려 갈라지던 문제.
        const certain =
          strong >= 2 || (strong >= 1 && shared.length >= 4);

        // 제목이 비슷해도 업권 term을 공유하지 않으면 다른 사안으로 본다
        if (!identical && !certain && c.repTerms.size && terms.size) {
          let termShared = false;
          for (const t of terms) {
            if (c.repTerms.has(t)) {
              termShared = true;
              break;
            }
          }
          if (!termShared) continue;
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
  }

  for (const clusters of clustersByDay.values()) {
    for (const c of clusters) {
      const hosts = new Set(c.members.map(hostOfEntry).filter(Boolean));
      const wireOnly =
        hosts.size > 0 && Array.from(hosts).every((h) => WIRE_HOSTS.has(h));
      // 대표는 클러스터에서 가장 최신 기사 — 다음 날 후속 보도가 흡수되면
      // 그 후속이 대표가 되어 목록이 항상 최신 국면을 보여준다
      let repIdx = 0;
      let repTime = -Infinity;
      c.members.forEach((m, i) => {
        const t = new Date(m.pubDate).getTime();
        if (Number.isFinite(t) && t > repTime) {
          repTime = t;
          repIdx = i;
        }
      });
      c.members.forEach((m, i) => {
        assignments.push({
          link: m.link,
          clusterId: c.id,
          isRep: i === repIdx,
          clusterHosts: Math.max(1, hosts.size),
          wireOnly,
        });
      });
    }
  }

  return assignments;
}
