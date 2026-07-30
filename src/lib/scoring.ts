import {
  KB_TICKER_RE,
  PREPARED_ACT,
  PREPARED_AUTH,
  PREPARED_COLLISIONS,
  PREPARED_NOISE,
  PREPARED_OWN_NULLIFIERS,
  PREPARED_OWN_RISK,
  PREPARED_TERMS,
  sourceTier,
  tierOf,
  type DeskId,
  type ImportanceTier,
  type KindId,
} from "@/lib/lexicon";
import {
  findTerm,
  matchesAny,
  nfm,
  normalizeHaystack,
  type NormalizedHaystack,
} from "@/lib/match";

// 충돌 방어를 적용한 매칭 — 약칭이 무관한 단어 안에 들어간 경우를 무효 처리한다.
function findTermGuarded(
  hay: NormalizedHaystack,
  norm: string,
): ReturnType<typeof findTerm> {
  const hit = findTerm(hay, norm);
  if (!hit) return null;
  const rule = PREPARED_COLLISIONS.find((c) => c.norm === norm);
  if (!rule) return hit;
  // 무효화어가 본문에 있고, 해당 term이 그 무효화어 밖에서 따로 등장하지 않으면 무효
  const all = `${hay.title} ${hay.description} ${hay.body}`;
  const stripped = rule.voidedByNorms.reduce(
    (acc, v) => acc.split(v).join(" "),
    all,
  );
  return stripped.includes(norm) ? hit : null;
}

// 8축 가중치 (합 100). 점수는 서버 cron에서 미리 계산해 저장한다.
const W = {
  tier: 25, // 업무 근접도
  vol: 18, // 보도량(매체 수)
  act: 16, // 행위성
  auth: 12, // 발신 주체
  fresh: 12, // 신선도
  src: 7, // 매체 등급
  body: 6, // 본문 밀도
  internal: 4, // 사내 관심
} as const;

const TIER_VALUE: Record<0 | 1 | 2 | 3, number> = {
  0: 1.0,
  1: 0.7,
  2: 0.4,
  3: 0.15,
};

export type ScoreInput = {
  title: string;
  description?: string | null;
  body?: string | null;
  pubDate: string;
  sourceHost?: string | null;
  /** 이 사안을 보도한 서로 다른 언론사 수 (클러스터에서 계산) */
  clusterHosts?: number;
  /** 통신사만으로 구성된 클러스터인지 */
  wireOnly?: boolean;
  /** 본문 추출 성공 여부 */
  bodyOk?: boolean | null;
  /** 최근 7일 사내 인기 검색어 (정규화 전 원문) */
  internalTerms?: string[];
  /** 기준 시각 — 테스트 재현성을 위해 주입 */
  now?: number;
  /** 주간 뷰는 감쇠를 완만하게 */
  mode?: "daily" | "weekly";
};

export type ReasonTag = { label: string; kind: "desk" | "act" | "auth" | "vol" | "time" };

export type ScoreResult = {
  score: number;
  tier: ImportanceTier;
  urgent: boolean;
  desks: DeskId[];
  kinds: KindId[];
  matchedTerms: string[];
  reasons: ReasonTag[];
  parts: Record<string, number>;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreArticle(input: ScoreInput): ScoreResult {
  const hay = normalizeHaystack({
    title: input.title,
    description: input.description ?? "",
    body: input.body ?? "",
  });
  const now = input.now ?? Date.now();
  const mode = input.mode ?? "daily";

  // ---- W1 Tier : 업무 근접도 -------------------------------------------------
  let bestTierValue = 0;
  let bestTierTerm: { term: string; tier: number; desk: DeskId } | null = null;
  const matchedTerms: string[] = [];
  // 가드레일 판정은 감독기관명을 뺀 "업무 term"만으로 한다
  const businessTiers: number[] = [];
  const deskSet = new Set<DeskId>();
  let nearCount = 0; // T0·T1 추가 매칭 수

  for (const pt of PREPARED_TERMS) {
    const hit = findTermGuarded(hay, pt.norm);
    if (!hit) continue;
    matchedTerms.push(pt.term);
    // 감독기관명은 발신 주체 신호로만 쓴다 — 업무 근접도·데스크에 기여하지 않는다
    if (pt.authOnly) continue;
    businessTiers.push(pt.tier);
    deskSet.add(pt.desk);
    const v = TIER_VALUE[pt.tier] * hit.weight;
    if (v > bestTierValue) {
      bestTierValue = v;
      bestTierTerm = { term: pt.term, tier: pt.tier, desk: pt.desk };
    }
    if (pt.tier <= 1) nearCount += 1;
  }
  const tierAxis = clamp01(bestTierValue + Math.max(0, nearCount - 1) * 0.08);

  // ---- W2 Vol : 보도량 (클러스터 크기가 아니라 서로 다른 매체 수) --------------
  const c = input.clusterHosts ?? 1;
  let volAxis = c <= 1 ? 0 : clamp01(Math.log(c) / Math.log(8));
  if (input.wireOnly) volAxis *= 0.7;

  // ---- W3 Act : 행위성 -------------------------------------------------------
  let actAxis = 0;
  let actLabel: string | null = null;
  const kindSet = new Set<KindId>();
  let actGradeHits = 0;
  for (const g of PREPARED_ACT) {
    const hit = g.norms.some((n) => findTermGuarded(hay, n) !== null);
    if (!hit) continue;
    actGradeHits += 1;
    kindSet.add(g.kind);
    if (g.value > actAxis) {
      actAxis = g.value;
      actLabel = g.label;
    }
  }
  if (actGradeHits >= 2) actAxis = clamp01(actAxis + 0.06);

  // ---- W4 Auth : 발신 주체 ---------------------------------------------------
  let authAxis = 0;
  let authLabel: string | null = null;
  let authGradeHits = 0;
  for (const g of PREPARED_AUTH) {
    const hit = g.norms.some((n) => findTermGuarded(hay, n) !== null);
    if (!hit) continue;
    authGradeHits += 1;
    if (g.value > authAxis) {
      authAxis = g.value;
      authLabel = g.label;
    }
  }
  if (authGradeHits >= 2) authAxis = clamp01(authAxis + 0.1);

  // ---- W5 Fresh : 신선도 (규제·확정 기사는 오래 살리고, 노이즈는 빨리 죽인다) ----
  const published = new Date(input.pubDate).getTime();
  let hours = Number.isNaN(published) ? 48 : Math.max(0, (now - published) / 3_600_000);
  const isDurable = actAxis >= 0.9 || authAxis >= 1.0;
  if (isDurable) hours *= 0.6;
  const halfLife = mode === "weekly" ? 120 : 36;

  // ---- Penalty : 곱셈 감점 ---------------------------------------------------
  let penalty = 1;
  const noiseLabels: string[] = [];
  for (const r of PREPARED_NOISE) {
    if (r.norms.some((n) => findTermGuarded(hay, n) !== null)) {
      penalty *= r.factor;
      noiseLabels.push(r.label);
    }
  }
  if (KB_TICKER_RE.test(hay.title)) {
    penalty *= 0.6;
    noiseLabels.push("자사 시세");
  }
  if ((input.description ?? "").length < 30 && c <= 1) {
    penalty *= 0.8;
  }

  // 감점된 기사는 신선도도 빨리 소진시킨다
  if (penalty < 1) hours *= 3;
  const freshAxis = Math.max(0.35, Math.exp(-hours / halfLife));

  // ---- W6 Src : 매체 등급 ----------------------------------------------------
  const srcAxis = sourceTier(input.sourceHost);

  // ---- W7 Body : 본문 밀도 ---------------------------------------------------
  let bodyAxis = 0;
  if (input.bodyOk === false) {
    bodyAxis = 0;
  } else {
    const nearTerms = PREPARED_TERMS.filter((p) => p.tier <= 1);
    let inBody = 0;
    let inTitle = false;
    for (const p of nearTerms) {
      const hit = findTerm(hay, p.norm);
      if (!hit) continue;
      if (hit.field === "title") inTitle = true;
      if (hit.field === "body" || hit.field === "description") inBody += 1;
    }
    if (input.bodyOk && inBody >= 2) bodyAxis = 1;
    else if (input.bodyOk && inBody === 1) bodyAxis = 0.6;
    else if (inTitle) bodyAxis = 0.3;
  }

  // ---- W8 Internal : 사내 관심 (담당자의 실제 검색이 다음 날 순위로 되먹여진다) --
  let internalAxis = 0;
  const internalNorms = (input.internalTerms ?? []).map(nfm).filter(Boolean);
  if (internalNorms.length && matchesAny(hay, internalNorms)) internalAxis += 0.5;
  if (deskSet.has("own")) internalAxis += 0.5;
  internalAxis = clamp01(internalAxis);

  // ---- 합산 ------------------------------------------------------------------
  const raw =
    W.tier * tierAxis +
    W.vol * volAxis +
    W.act * actAxis +
    W.auth * authAxis +
    W.fresh * freshAxis +
    W.src * srcAxis +
    W.body * bodyAxis +
    W.internal * internalAxis;

  let score = Math.max(0, Math.min(100, Math.round(raw * penalty)));

  // ---- 가드레일 : 산식만으로는 막히지 않는 오판 3종 ---------------------------
  // 1) 어떤 업권 사전에도 걸리지 않은 기사 (또는 거시만) → 상한 30
  const hasNear = businessTiers.some((tv) => tv <= 2);
  if (!hasNear) score = Math.min(score, 30);
  // 2) 거시(T3)만 걸렸고 당국·행위성도 약함 → 상한 45 (거시는 지표가 담당한다)
  if (bestTierTerm?.tier === 3 && authAxis === 0 && actAxis < 0.6) {
    score = Math.min(score, 45);
  }
  // 3) 당국 발신이지만 업권 접점 0 → 상한 55 (필수확인이 될 수 없다)
  const hasT0T1 = businessTiers.some((tv) => tv <= 1);
  if (authAxis >= 0.65 && !hasT0T1) score = Math.min(score, 55);

  // ---- 자사 리스크 강제 승격 : 이 한 건을 놓치는 것이 시스템 실패의 정의 --------
  let urgent = false;
  if (deskSet.has("own") && matchesAny(hay, PREPARED_OWN_RISK)) {
    if (!matchesAny(hay, PREPARED_OWN_NULLIFIERS)) {
      urgent = true;
      score = Math.max(score, 78);
    }
  }

  // ---- 근거 태그 : 점수를 단독 표기하지 않는다 --------------------------------
  const reasons: ReasonTag[] = [];
  if (bestTierTerm) {
    reasons.push({
      label: bestTierTerm.desk === "own" ? `자사 ${bestTierTerm.term}` : bestTierTerm.term,
      kind: "desk",
    });
  }
  if (actLabel) reasons.push({ label: actLabel, kind: "act" });
  if (authLabel && authAxis >= 0.65) reasons.push({ label: authLabel, kind: "auth" });
  if (c >= 2) reasons.push({ label: `${c}개 매체`, kind: "vol" });

  return {
    score,
    tier: tierOf(score, urgent),
    urgent,
    desks: Array.from(deskSet),
    kinds: Array.from(kindSet),
    matchedTerms,
    reasons: reasons.slice(0, 4),
    parts: {
      tier: Number(tierAxis.toFixed(3)),
      vol: Number(volAxis.toFixed(3)),
      act: Number(actAxis.toFixed(3)),
      auth: Number(authAxis.toFixed(3)),
      fresh: Number(freshAxis.toFixed(3)),
      src: Number(srcAxis.toFixed(3)),
      body: Number(bodyAxis.toFixed(3)),
      internal: Number(internalAxis.toFixed(3)),
      penalty: Number(penalty.toFixed(3)),
    },
  };
}

// 검색 결과 랭킹용 — 질의어와의 관련도를 중요도와 합성한다.
// (기존 검색은 sort=date 후 부분문자열 필터라 제목 정확일치와 본문 스침을 동일 취급했다)
export function searchRelevance(
  query: string,
  item: { title: string; description?: string | null },
): number {
  const q = nfm(query);
  if (!q) return 0;
  const title = nfm(item.title);
  const desc = nfm(item.description ?? "");

  let r = 0;
  if (title === q) r += 60; // 제목 전체가 질의어
  else if (title.startsWith(q)) r += 45; // 제목 머리
  else if (title.includes(q)) r += 35; // 제목 포함
  if (desc.includes(q)) r += 12;

  // 다어절 질의는 토큰 커버리지도 본다
  const tokens = query
    .split(/\s+/)
    .map(nfm)
    .filter((x) => x.length >= 2);
  if (tokens.length > 1) {
    const inTitle = tokens.filter((tk) => title.includes(tk)).length;
    const inDesc = tokens.filter((tk) => desc.includes(tk)).length;
    r += (inTitle / tokens.length) * 20;
    r += (inDesc / tokens.length) * 6;
  }
  return r;
}
