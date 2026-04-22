export type Category = {
  id: string;
  label: string;
  keywords: string[];
};

export const CATEGORIES: Category[] = [
  {
    id: "debt-collection",
    label: "채권추심",
    keywords: ["채권추심", "추심", "신용정보회사"],
  },
  {
    id: "credit-investigation",
    label: "신용조사",
    keywords: ["신용조사", "신용정보"],
  },
  {
    id: "e-document",
    label: "공인전자문서",
    keywords: ["공인전자문서", "전자문서", "공전소"],
  },
  {
    id: "finance-law",
    label: "금융법령",
    keywords: ["신용정보법", "금융소비자보호법", "채권추심법"],
  },
  {
    id: "labor-law",
    label: "노동법",
    keywords: ["근로기준법", "노동법", "최저임금"],
  },
  {
    id: "kbci",
    label: "KB신용정보",
    keywords: ["KB신용정보"],
  },
];

export const getCategory = (id: string): Category | undefined =>
  CATEGORIES.find((c) => c.id === id);
