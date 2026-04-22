export type Category = {
  id: string;
  label: string;
  keywords: string[];
};

export const CATEGORIES: Category[] = [
  {
    id: "debt-collection",
    label: "채권추심",
    keywords: [
      "채권추심",
      "추심",
      "신용정보회사",
      "개인채무자보호법",
      "채무조정",
      "부실채권",
      "NPL",
    ],
  },
  {
    id: "credit-investigation",
    label: "신용조사",
    keywords: ["신용조사", "신용정보", "신용평가", "마이데이터"],
  },
  {
    id: "e-document",
    label: "공인전자문서",
    keywords: [
      "공인전자문서",
      "전자문서",
      "공전소",
      "전자서명",
      "전자문서법",
    ],
  },
  {
    id: "finance-law",
    label: "금융법령",
    keywords: [
      "신용정보법",
      "금융소비자보호법",
      "채권추심법",
      "전자금융거래법",
      "전자금융감독규정",
      "개인정보보호법",
      "여신전문금융업법",
    ],
  },
  {
    id: "labor-law",
    label: "노동법",
    keywords: [
      "근로기준법",
      "노동법",
      "최저임금",
      "노란봉투법",
      "중대재해처벌법",
      "산업안전보건법",
    ],
  },
  {
    id: "kbci",
    label: "KB금융그룹",
    keywords: [
      "KB신용정보",
      "KB금융",
      "KB국민은행",
      "KB국민카드",
    ],
  },
];

export const getCategory = (id: string): Category | undefined =>
  CATEGORIES.find((c) => c.id === id);

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
