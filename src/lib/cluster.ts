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
const MAX_CLUSTER = 12;

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
      let placed = false;

      for (const c of clusters) {
        if (c.members.length >= MAX_CLUSTER) continue;
        if (dice(grams, c.repIndexTitle) < SIM_THRESHOLD) continue;
        // 제목이 비슷해도 업권 term을 공유하지 않으면 다른 사안으로 본다
        if (c.repTerms.size && terms.size) {
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
