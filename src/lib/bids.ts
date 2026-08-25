import { stripHtml } from "@/lib/format";
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
 *   classes — 조달청 분류명. 걸리면 weak의 context 요구를 면제한다.
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
  /**
   * 조달청 물품/용역 분류명. 공고명보다 훨씬 신뢰도가 높다 — 발주처가
   * 제목을 어떻게 짓든 분류는 체계를 따르기 때문이다. 분류가 걸리면
   * weak term의 동반어(context) 요구를 면제한다.
   */
  classes: string[];
};

const RULES: Record<BidAreaId, AreaRule> = {
  scan: {
    // 실제 공고명은 '전자화'보다 '전산화'·'DB구축'을 더 자주 쓴다.
    // 표현을 하나라도 빠뜨리면 그 공고는 영영 안 보이므로 넓게 깐다.
    strong: [
      "문서전자화", "문서 전자화", "문서전산화", "문서 전산화",
      "기록물전자화", "기록물 전자화", "기록물 전산화", "기록물 디지털화",
      "전자화사업", "전자화 사업", "전자화용역", "전자화 용역",
      "전산화사업", "전산화 사업", "전산화용역", "전산화 용역",
      "전자문서화", "종이문서", "비전자기록물", "비전자 기록물",
      "중요기록물", "영구기록물",
      "원문DB", "원문 DB", "원문정보DB", "원문정보 DB", "원문 이미지", "원문이미지",
      "기록물 DB구축", "기록물 데이터베이스",
      "스캔용역", "스캔 용역", "스캐닝용역", "스캐닝 용역",
      "문서 스캔", "문서스캔", "기록물 스캔", "도면 스캔", "도서 스캔",
      "책자 스캔", "간행물 스캔", "자료 스캔",
      "도면 전자화", "도면 전산화", "대장 전자화", "대장 전산화",
      "서류 전자화", "서류 전산화", "자료 전자화", "자료 디지털화",
      "마이크로필름", "색인DB", "색인 DB", "이미지DB", "이미지 DB",
      "OCR", "광학문자인식", "PDF 변환", "전자화 대상문서",
    ],
    weak: [
      "전자화", "전산화", "스캔", "스캐닝", "디지털화", "이미지화",
      "DB구축", "DB 구축", "데이터베이스 구축", "디지털 아카이브",
      "색인", "목록화",
    ],
    context: [
      "문서", "기록물", "도면", "서류", "자료", "카드", "장부", "원문",
      "공부", "도서", "사진", "필름", "명부", "고문서", "간행물", "책자",
      "민원서류", "등록부", "학적", "인사기록", "회계기록", "판결문",
      "정수", "박물",
    ],
    deny: [
      "취약점", "악성코드", "바이러스", "포트스캔", "보안 스캔", "스캔들",
      "3D", "3차원", "라이다", "LiDAR", "MRI", "초음파", "지문", "홍채",
      "얼굴인식", "바코드", "QR", "노면", "지하매설", "혈관", "안저",
      // 공간정보 DB구축은 'DB구축' weak 경로로 대량 유입된다. 도면·대장
      // 전자화는 strong으로 잡히므로 여기서 걸러도 놓치지 않는다.
      "공간정보", "GIS", "지하시설물", "상수도", "하수관로", "수치지도",
      "수치지형도", "정사영상", "항공촬영", "지오코딩",
    ],
    // 실측 확인: '2026년 중요 비전자기록물 전산화 사업'의 중분류가 이것이다
    classes: ["DB구축 및 자료입력"],
  },
  archive: {
    strong: [
      "공인전자문서센터", "전자문서센터", "전자문서 보관", "전자문서보관",
      "문서보관 용역", "문서 보관 용역", "문서 위탁보관", "외부 위탁보관",
      "기록물관리 위탁", "기록관리 위탁", "기록물 위탁", "기록관 운영",
      "기록물관리 전문", "기록물 관리 용역",
      "보존서고", "보존 서고", "문서고", "중간서고", "서고 이전",
      "서고 재배치", "서고 운영", "서고 정리",
      "기록물 이관", "기록물 정수점검", "정수점검", "기록물 정리",
      "기록물 평가폐기", "기록물 폐기", "기록물 상태검사",
      "기록물 소독", "탈산처리", "탈산 처리", "기록물 보존처리",
      "문서 파쇄", "문서파쇄", "보안 파쇄",
      "보존문서", "보존기간", "보존연한", "영구보존",
    ],
    weak: ["보관", "보존", "위탁", "이관", "정리", "폐기", "파쇄", "서고", "소독"],
    context: [
      "기록물", "문서", "서고", "기록관", "전자문서", "장부", "증빙",
      "서류", "아카이브", "간행물", "공문서", "행정박물",
    ],
    deny: [
      "냉장", "냉동", "의약품", "백신", "검체", "표본", "유물", "문화재",
      "종자", "탄약", "무기", "폐기물", "의료폐기물", "식품", "급식",
      "청소", "방역", "해충", "가축", "분뇨", "하수",
    ],
    classes: [],
  },
  lease: {
    strong: [
      "임대차조사", "임대차 조사", "임대차 실태조사", "임대차 실태 조사",
      "임차인 실태조사", "임차인 조사", "임차인 거주",
      "전세사기", "전세 실태조사", "전세피해", "전세 피해",
      "전입세대열람", "전입세대 열람",
      "보증금 반환", "보증금 미반환", "전세보증금", "임대보증금",
      "주택임대차 실태", "임대차계약 실태", "임대차 분쟁",
      "임대주택 실태조사", "공공임대주택 실태",
      "무단전대", "불법전대", "실거주 확인", "거주 실태조사", "깡통전세",
      "확정일자", "임차권등기",
    ],
    weak: ["임대차", "임차인", "전세", "보증금", "월세", "주택임대차", "전대"],
    context: [
      "조사", "실태", "점검", "확인", "검증", "현황", "실사", "열람",
      "분석", "컨설팅", "피해", "지원",
    ],
    deny: ["전세계", "청사", "관사", "사택", "임차료 산정", "감정평가 수수료", "임대료 인상"],
    classes: [],
  },
  rights: {
    strong: [
      "권리조사", "권리 조사", "권리분석", "권리 분석", "권리관계 조사",
      "등기부 조사", "등기부등본", "등기사항증명서", "등기 열람",
      "공부조사", "공부 조사", "공부 발급",
      "재산조사", "재산 조사", "재산 실태조사",
      "소유권 조사", "소유자 조사", "소유자 확인", "소유권 확인",
      "담보물 조사", "담보물 실사", "담보 실사", "물건조사",
      "명의신탁", "은닉재산", "상속인 조사", "상속재산 조사",
      "체납자 재산조사", "체납자 실태조사", "체납처분",
      "국유재산 실태조사", "공유재산 실태조사", "부동산 실태조사",
      "무단점유", "변상금", "지적공부",
    ],
    weak: ["권리", "등기", "소유권", "근저당", "재산", "명의", "체납"],
    context: [
      "조사", "분석", "실태", "확인", "정리", "검증", "현황", "실사",
      "부동산", "토지", "건물", "발급", "열람",
    ],
    deny: [
      "지식재산", "지식재산권", "저작권", "특허", "상표", "디자인권",
      "인권", "노동권", "권리구제", "권리보장", "아동", "장애인 권리",
      "소비자 권리", "권리금", "지장물", "재산권 보호", "권리 증진",
      "재산세 감면",
    ],
    classes: [],
  },
};

export type BidMatch = {
  areas: BidAreaId[];
  terms: string[];
  relevance: number;
};

const STRONG_SCORE = 80;
/** 분류가 받쳐주면 동반어 없이도 인정한다 — 분류는 제목보다 정직하다 */
const CLASS_WEAK_SCORE = 65;
const WEAK_SCORE = 50;
const CLASS_ONLY_SCORE = 50;
/** 이 점수 미만은 저장하지 않는다 — 표가 오탐으로 덮이면 아무도 안 본다 */
export const BID_MIN_RELEVANCE = WEAK_SCORE;

/**
 * 공백을 한 칸으로 살린 정규화. 공백을 전부 지우는 nfm만 쓰면 어절 경계를
 * 넘는 유령 매칭이 생긴다 — "엘라스토머 모폴로지 분석기"가 "지분"에 걸려
 * 권리조사로 분류된 실제 사고가 있었다.
 */
const nfs = (s: string): string =>
  stripHtml(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * 짧은 term일수록 유령 매칭 확률이 높다. 4자 미만은 어절 경계를 넘지 못하게
 * 하고, 4자 이상만 공백을 지운 형태로도 찾는다("DB 구축" ↔ "DB구축").
 */
const SPACE_CROSSING_MIN_LEN = 4;

/**
 * 라틴 문자·숫자로만 된 term(OCR, GIS, 3D…)은 단어 경계로만 인정한다.
 * 한글은 어절 경계로 걸러지지만 라틴 약어는 다른 단어 속에 그대로 묻힌다 —
 * 'OCR'이 'Hemocron'에 걸려 검사재료 구매 공고가 80점을 받은 사고가 있었다.
 * (\b는 ASCII 기준이라 'OCR작업'처럼 한글이 붙는 경우는 정상 매칭된다)
 */
const LATIN_ONLY = /^[a-z0-9]+$/;

function makeHas(title: string): (term: string) => boolean {
  const spaced = nfs(title);
  const packed = nfm(title);
  return (term: string) => {
    const s = nfs(term);
    if (!s) return false;
    if (LATIN_ONLY.test(s)) return new RegExp(`\\b${s}\\b`).test(spaced);
    if (spaced.includes(s)) return true;
    const m = nfm(term);
    return m.length >= SPACE_CROSSING_MIN_LEN && packed.includes(m);
  };
}

/**
 * 공고명으로 사업 분야를 판정한다. 수요기관명은 근거로 쓰지 않는다 —
 * 기관 이름만으로 사업 성격을 단정하면 오탐이 걷잡을 수 없이 늘어난다.
 */
/** 판정에 쓰는 공고 정보. 분류명은 없을 수 있다(오퍼레이션마다 다르다). */
export type BidSubject = {
  title: string;
  /** 조달청 분류명들 — 대분류·중분류·품목분류를 그대로 넘긴다 */
  classes?: (string | null | undefined)[];
};

export function matchBid(subject: string | BidSubject): BidMatch {
  const { title, classes = [] } =
    typeof subject === "string" ? { title: subject, classes: [] } : subject;

  const has = makeHas(title);
  const classNames = classes.filter((c): c is string => Boolean(c && c.trim()));
  const hasClass = (name: string) =>
    classNames.some((c) => nfm(c) === nfm(name) || nfm(c).includes(nfm(name)));

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

    const classHits = rule.classes.filter(hasClass);
    const weakHits = rule.weak.filter(has);
    const contextHits = rule.context.filter(has);

    // 분류가 받쳐주면 동반어를 요구하지 않는다. 공고명이 "2026년 ○○사업"처럼
    // 아무 정보가 없어도 분류는 체계를 따르기 때문이다.
    if (classHits.length > 0 && weakHits.length > 0) {
      areas.push(area);
      weakHits.forEach((t) => terms.add(t));
      classHits.forEach((c) => terms.add(`분류:${c}`));
      best = Math.max(best, CLASS_WEAK_SCORE);
      return;
    }

    if (weakHits.length > 0 && contextHits.length > 0) {
      areas.push(area);
      weakHits.forEach((t) => terms.add(t));
      contextHits.slice(0, 3).forEach((t) => terms.add(t));
      best = Math.max(best, WEAK_SCORE);
      return;
    }

    // 분류만 걸린 건 확신이 낮지만, 놓치는 것보다는 낫다. 최소 점수로 남긴다.
    if (classHits.length > 0) {
      areas.push(area);
      classHits.forEach((c) => terms.add(`분류:${c}`));
      best = Math.max(best, CLASS_ONLY_SCORE);
    }
  });

  if (areas.length === 0) return { areas: [], terms: [], relevance: 0 };

  const bonus = Math.min(20, (terms.size - 1) * 5);
  return {
    areas,
    terms: Array.from(terms).slice(0, 20),
    relevance: Math.min(100, best + bonus),
  };
}

