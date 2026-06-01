export type Category = {
  id: string;
  label: string;
};

// 상단 GNB에 노출되는 일반 뉴스 카테고리
export const CATEGORIES: Category[] = [
  { id: "finance", label: "금융" },
  { id: "economy", label: "경제" },
  { id: "industry", label: "산업" },
  { id: "society", label: "사회" },
  { id: "law", label: "법률" },
  { id: "it", label: "IT" },
];

// 네이버 검색에 사용하는 키워드(토픽)와 일반 카테고리 매핑.
// 회사 업무 관련 기사만 수집되도록 구체적인 키워드를 유지하되,
// 화면에서는 일반 카테고리로 묶어서 보여준다.
export type SearchTopic = {
  term: string;
  category: string;
};

export const SEARCH_TOPICS: SearchTopic[] = [
  // 금융
  { term: "채권추심", category: "finance" },
  { term: "채권추심회사", category: "finance" },
  { term: "부실채권", category: "finance" },
  { term: "NPL 매각", category: "finance" },
  { term: "신용조사", category: "finance" },
  { term: "신용정보", category: "finance" },
  { term: "신용평가", category: "finance" },
  { term: "마이데이터", category: "finance" },
  { term: "여신전문금융", category: "finance" },
  { term: "KB금융", category: "finance" },
  { term: "KB국민은행", category: "finance" },
  { term: "KB국민카드", category: "finance" },
  { term: "KB신용정보", category: "finance" },
  { term: "가계부채", category: "finance" },

  // 경제
  { term: "기준금리", category: "economy" },
  { term: "물가", category: "economy" },
  { term: "환율", category: "economy" },
  { term: "경기침체", category: "economy" },
  { term: "부동산 시장", category: "economy" },
  { term: "가계대출", category: "economy" },

  // 산업
  { term: "공인전자문서", category: "industry" },
  { term: "전자문서", category: "industry" },
  { term: "전자문서산업", category: "industry" },
  { term: "공인전자문서센터", category: "industry" },
  { term: "핀테크", category: "industry" },
  { term: "데이터산업", category: "industry" },

  // 사회
  { term: "개인채무자보호법", category: "society" },
  { term: "채무조정", category: "society" },
  { term: "개인정보 유출", category: "society" },
  { term: "보이스피싱", category: "society" },
  { term: "불법추심", category: "society" },

  // 법률
  { term: "신용정보법", category: "law" },
  { term: "채권추심법", category: "law" },
  { term: "전자금융거래법", category: "law" },
  { term: "전자금융감독규정", category: "law" },
  { term: "개인정보보호법", category: "law" },
  { term: "여신전문금융업법", category: "law" },
  { term: "근로기준법", category: "law" },
  { term: "노란봉투법", category: "law" },
  { term: "중대재해처벌법", category: "law" },

  // IT
  { term: "AI 금융", category: "it" },
  { term: "전자서명", category: "it" },
  { term: "클라우드 보안", category: "it" },
  { term: "개인정보 보안", category: "it" },
];

export const getCategory = (id: string): Category | undefined =>
  CATEGORIES.find((c) => c.id === id);

export const keywordsForCategory = (id: string): string[] =>
  SEARCH_TOPICS.filter((t) => t.category === id).map((t) => t.term);

// 검색창 하단에 칩으로 노출 + 빈도 집계 대상이 되는 회사 핵심 키워드
export const HOT_KEYWORDS = [
  "채권추심",
  "신용조사",
  "공인전자문서",
  "신용정보법",
  "채권추심법",
  "개인채무자보호법",
  "마이데이터",
  "전자금융거래법",
  "부실채권",
  "노란봉투법",
  "KB금융",
  "보이스피싱",
];

// 주요 뉴스(featured) 가중치 및 관련도 점수에 쓰이는 최우선 키워드
export const FEATURED_KEYWORDS = [
  // 자사 / 그룹사
  "KB신용정보",
  "KB국민은행",
  "KB국민카드",
  "KB금융",
  // 핵심 사업
  "채권추심",
  "신용조사",
  "공인전자문서",
  // 핵심 법령 / 규정
  "신용정보법",
  "채권추심법",
  "개인채무자보호법",
  "전자금융감독규정",
  "전자금융거래법",
  // 이슈성 노동법
  "노란봉투법",
];

// "법·제도 동향" 섹션에서 입법/개정/제재/위반성 기사를 가려내는 키워드
export const LEGAL_ACTION_KEYWORDS = [
  "개정",
  "개정안",
  "시행",
  "입법",
  "발의",
  "제정",
  "공포",
  "제재",
  "과징금",
  "벌금",
  "위반",
  "처벌",
  "적발",
  "행정처분",
  "시정명령",
  "징계",
];
