import { nfm } from "@/lib/match";

// ---------------------------------------------------------------------------
// 입찰공고 모니터링 — 나라장터(조달청) 공개 API를 1시간 주기로 훑어
// "우리가 실제로 응찰하는 4개 사업"에 걸리는 공고만 남긴다.
//
// 사전은 코드에 둔다(뉴스 lexicon과 같은 원칙). 공고명 오탐/누락은 반드시
// 나오므로, 누가 언제 왜 키워드를 넣고 뺐는지가 diff로 남아야 한다.
// ---------------------------------------------------------------------------

export type BidAreaId = "scan" | "archive" | "lease" | "rights";

export type BidArea = {
  id: BidAreaId;
  label: string;
  definition: string;
  className: string;
};

export const BID_AREAS: BidArea[] = [
  {
    id: "scan",
    label: "문서 전자화",
    definition: "종이문서·기록물 스캔, 원문 DB 구축",
    className: "text-blue-700",
  },
  {
    id: "archive",
    label: "전자문서 보관",
    definition: "전자문서·기록물 보관·위탁, 서고 운영",
    className: "text-indigo-700",
  },
  {
    id: "lease",
    label: "임대차조사",
    definition: "임대차 실태조사, 전세보증금·임차인 확인",
    className: "text-cyan-800",
  },
  {
    id: "rights",
    label: "권리조사",
    definition: "등기·권리관계 조사, 재산·담보물 조사",
    className: "text-teal-800",
  },
];

export const bidAreaLabel = (id: string): string =>
  BID_AREAS.find((a) => a.id === id)?.label ?? id;

/**
 * 분야별 판정 규칙.
 *   strong  — 단독으로 확정. 이 말이 공고명에 있으면 그 사업이다.
 *   weak    — 단독으로는 모호. context와 함께 나와야 인정한다.
 *   context — weak를 확정으로 끌어올리는 동반어.
 *   deny    — weak 경로에만 적용하는 배제어. strong은 배제하지 않는다.
 *             (예: "스캔"은 보안 취약점 스캔·3D 스캔과 충돌하지만
 *              "문서전자화"는 충돌할 여지가 없다)
 */
type AreaRule = {
  strong: string[];
  weak: string[];
  context: string[];
  deny: string[];
};

const RULES: Record<BidAreaId, AreaRule> = {
  scan: {
    strong: [
      "문서전자화",
      "문서 전자화",
      "기록물전자화",
      "기록물 전자화",
      "전자화사업",
      "전자화 사업",
      "전자화용역",
      "전자화 용역",
      "종이문서",
      "비전자기록물",
      "비전자 기록물",
      "원문DB구축",
      "원문 DB 구축",
      "원문정보DB",
      "원문정보 DB",
      "스캔용역",
      "스캔 용역",
      "스캐닝용역",
      "스캐닝 용역",
      "문서 스캔",
      "문서스캔",
      "기록물 스캔",
      "도면 전자화",
      "대장 전자화",
      "서류 전자화",
      "마이크로필름",
      "전자화 대상문서",
    ],
    weak: [
      "전자화",
      "스캔",
      "스캐닝",
      "디지털화",
      "이미지화",
      "DB구축",
      "DB 구축",
      "데이터베이스 구축",
      "디지털 아카이브",
    ],
    context: [
      "문서",
      "기록물",
      "도면",
      "대장",
      "서류",
      "자료",
      "카드",
      "장부",
      "원문",
      "공부",
      "도서",
      "사진",
      "필름",
      "명부",
      "고문서",
      "간행물",
      "민원서류",
    ],
    deny: [
      "취약점",
      "악성코드",
      "바이러스",
      "포트스캔",
      "보안 스캔",
      "3D",
      "3차원",
      "라이다",
      "LiDAR",
      "스캔들",
      "MRI",
      "초음파",
      "지문",
      "홍채",
      "얼굴인식",
      "바코드",
      "QR",
      "노면",
      "지하매설",
    ],
  },
  archive: {
    strong: [
      "공인전자문서센터",
      "전자문서센터",
      "전자문서 보관",
      "전자문서보관",
      "문서보관 용역",
      "문서 보관 용역",
      "기록물관리 위탁",
      "기록관리 위탁",
      "기록물 위탁",
      "보존서고",
      "보존 서고",
      "문서고",
      "중간서고",
      "기록물 이관",
      "기록물 정수점검",
      "기록물 정리",
      "기록물 평가폐기",
      "문서 위탁보관",
      "문서 파쇄",
      "보존기간",
      "보존연한",
    ],
    weak: ["보관", "보존", "위탁", "이관", "정리", "폐기", "파쇄", "서고"],
    context: [
      "기록물",
      "문서",
      "서고",
      "기록관",
      "전자문서",
      "장부",
      "증빙",
      "서류",
      "아카이브",
    ],
    deny: [
      "냉장",
      "냉동",
      "의약품",
      "백신",
      "검체",
      "표본",
      "유물",
      "문화재",
      "종자",
      "탄약",
      "무기",
      "폐기물",
      "의료폐기물",
      "식품",
    ],
  },
  lease: {
    strong: [
      "임대차조사",
      "임대차 조사",
      "임대차 실태조사",
      "임대차 실태 조사",
      "임차인 실태조사",
      "임차인 조사",
      "전세사기",
      "전세 실태조사",
      "전입세대열람",
      "전입세대 열람",
      "보증금 반환",
      "주택임대차 실태",
      "임대차계약 실태",
      "깡통전세",
    ],
    weak: ["임대차", "임차인", "전세", "보증금", "확정일자", "월세", "주택임대차"],
    context: [
      "조사",
      "실태",
      "점검",
      "확인",
      "검증",
      "현황",
      "실사",
      "열람",
      "분석",
      "컨설팅",
    ],
    deny: ["전세계", "청사", "관사", "사택", "임차료 산정", "감정평가 수수료"],
  },
  rights: {
    strong: [
      "권리조사",
      "권리 조사",
      "권리분석",
      "권리 분석",
      "권리관계 조사",
      "등기부 조사",
      "등기사항증명서",
      "공부조사",
      "공부 조사",
      "재산조사",
      "재산 조사",
      "소유권 조사",
      "담보물 조사",
      "물건조사",
      "명의신탁",
      "국유재산 실태조사",
      "공유재산 실태조사",
      "무단점유",
      "변상금",
    ],
    weak: ["권리", "등기", "소유권", "근저당", "지분", "재산", "명의", "지적공부"],
    context: [
      "조사",
      "분석",
      "실태",
      "확인",
      "정리",
      "검증",
      "현황",
      "실사",
      "부동산",
      "토지",
      "건물",
    ],
    deny: [
      "지식재산",
      "지식재산권",
      "저작권",
      "특허",
      "상표",
      "디자인권",
      "인권",
      "노동권",
      "권리구제",
      "권리보장",
      "아동",
      "장애인 권리",
      "소비자 권리",
      "권리금",
    ],
  },
};

export type BidMatch = {
  areas: BidAreaId[];
  terms: string[];
  relevance: number;
};

const STRONG_SCORE = 80;
const WEAK_SCORE = 50;
/** 이 점수 미만은 저장하지 않는다 — 표가 오탐으로 덮이면 아무도 안 본다 */
export const BID_MIN_RELEVANCE = WEAK_SCORE;

/**
 * 공고명으로 사업 분야를 판정한다. 수요기관명은 근거로 쓰지 않는다 —
 * 기관 이름만으로 사업 성격을 단정하면 오탐이 걷잡을 수 없이 늘어난다.
 */
export function matchBid(title: string): BidMatch {
  const hay = nfm(title);
  const has = (term: string) => hay.includes(nfm(term));

  const areas: BidAreaId[] = [];
  const terms = new Set<string>();
  let best = 0;

  (Object.keys(RULES) as BidAreaId[]).forEach((area) => {
    const rule = RULES[area];

    const strongHits = rule.strong.filter(has);
    if (strongHits.length > 0) {
      areas.push(area);
      strongHits.forEach((t) => terms.add(t));
      best = Math.max(best, STRONG_SCORE);
      return;
    }

    if (rule.deny.some(has)) return;

    const weakHits = rule.weak.filter(has);
    if (weakHits.length === 0) return;
    const contextHits = rule.context.filter(has);
    if (contextHits.length === 0) return;

    areas.push(area);
    weakHits.forEach((t) => terms.add(t));
    contextHits.slice(0, 3).forEach((t) => terms.add(t));
    best = Math.max(best, WEAK_SCORE);
  });

  if (areas.length === 0) return { areas: [], terms: [], relevance: 0 };

  // 근거가 여러 개면 확신이 커진다. 다만 상한을 둬 100을 넘기지 않는다.
  const bonus = Math.min(20, (terms.size - 1) * 5);
  return {
    areas,
    terms: Array.from(terms).slice(0, 20),
    relevance: Math.min(100, best + bonus),
  };
}
