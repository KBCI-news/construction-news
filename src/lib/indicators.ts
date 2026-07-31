import { stripHtml } from "@/lib/format";

// 수집된 기사에서 경제지표 수치를 뽑아낸다.
// 외부 유료 API 없이 우리가 이미 가진 데이터만 쓰되, 잘못된 수치를 게시판에
// 올리는 것이 아무것도 안 보여주는 것보다 나쁘므로 문맥 검증을 강하게 건다.
//
// 실제 수집 데이터에는 영국·미국 기준금리, 특정 은행(BNK)·지역(제주·울산)
// 연체율이 섞여 있다. 문맥 조건을 통과하지 못하면 값을 버린다.

export type IndicatorKey =
  | "base_rate"
  | "usd_krw"
  | "household_delinq"
  | "bank_delinq"
  | "card_delinq"
  | "savings_delinq";

export type IndicatorHit = { key: IndicatorKey; value: string };

type Rule = {
  key: IndicatorKey;
  patterns: RegExp[];
  /** 이 중 하나는 반드시 문맥에 있어야 한다 */
  require: RegExp;
  /** 하나라도 있으면 버린다 */
  exclude?: RegExp;
  min: number;
  max: number;
  digits: number;
};

// 해외 중앙은행 — 한국 기준금리로 오인되면 안 된다
const FOREIGN =
  /(영국|영란|잉글랜드은행|BOE|미국|연준|연방준비|Fed|FOMC|유럽|ECB|일본은행|BOJ|중국|인민은행|호주|캐나다|스위스|대만|인도)/i;

// 전체 집계가 아닌 개별사·지역 수치
const LOCAL_OR_SINGLE =
  /(제주|울산|부산|대구|광주|전북|경남|강원|충북|충남|전남|경북|BNK|DGB|JB|iM|아이엠|신한은행|국민은행|하나은행|우리은행|농협은행|기업은행|지방은행|자영업자)/;

const RULES: Rule[] = [
  {
    key: "base_rate",
    patterns: [
      /기준금리[^0-9%]{0,14}?(\d(?:\.\d{1,2})?)\s*%/,
      /기준금리를?[^0-9%]{0,14}?연\s*(\d(?:\.\d{1,2})?)\s*%/,
    ],
    // 한국은행 맥락일 때만 인정
    require: /(한국은행|한은|금융통화위원회|금통위)/,
    exclude: FOREIGN,
    min: 0.25,
    max: 6,
    digits: 2,
  },
  {
    key: "usd_krw",
    patterns: [
      /(?:원[·/]?달러\s*환율|환율)[^0-9]{0,16}?(1[,.]?\d{3}(?:\.\d)?)\s*원/,
      /달러당[^0-9]{0,10}?(1[,.]?\d{3}(?:\.\d)?)\s*원/,
    ],
    require: /(원[·/]?달러|서울外|서울 외환|환율)/,
    // "고정 환율 기준 43억 원" 같은 환산 표현 배제
    exclude: /(환율 기준|환산|고정 환율)/,
    min: 900,
    max: 2000,
    digits: 1,
  },
  {
    key: "household_delinq",
    patterns: [/가계(?:대출)?\s*연체율[^0-9%]{0,14}?(\d(?:\.\d{1,2})?)\s*%/],
    require: /(금융감독원|금감원|한국은행|한은|전체|전국|국내은행|은행권)/,
    exclude: LOCAL_OR_SINGLE,
    min: 0.05,
    max: 15,
    digits: 2,
  },
  {
    key: "bank_delinq",
    patterns: [
      /(?:국내은행|은행권|은행)\s*(?:원화대출\s*)?연체율[^0-9%]{0,14}?(\d(?:\.\d{1,2})?)\s*%/,
    ],
    require: /(금융감독원|금감원|국내은행|은행권)/,
    exclude: LOCAL_OR_SINGLE,
    min: 0.05,
    max: 10,
    digits: 2,
  },
  {
    key: "card_delinq",
    patterns: [/카드(?:사)?\s*연체율[^0-9%]{0,14}?(\d(?:\.\d{1,2})?)\s*%/],
    require: /(금융감독원|금감원|카드사|여신금융|전업카드)/,
    exclude: LOCAL_OR_SINGLE,
    min: 0.05,
    max: 15,
    digits: 2,
  },
  {
    key: "savings_delinq",
    patterns: [/저축은행\s*연체율[^0-9%]{0,14}?(\d(?:\.\d{1,2})?)\s*%/],
    require: /(금융감독원|금감원|저축은행중앙회|업권|전체)/,
    exclude: LOCAL_OR_SINGLE,
    min: 0.05,
    max: 30,
    digits: 2,
  },
];

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ""));

export function extractIndicators(
  title: string,
  description?: string | null,
): IndicatorHit[] {
  const text = `${stripHtml(title)} ${stripHtml(description ?? "")}`;
  const out: IndicatorHit[] = [];

  for (const rule of RULES) {
    if (!rule.require.test(text)) continue;
    if (rule.exclude?.test(text)) continue;

    for (const re of rule.patterns) {
      const m = text.match(re);
      if (!m?.[1]) continue;
      const n = toNumber(m[1]);
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) continue;
      const value =
        rule.key === "usd_krw"
          ? n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })
          : String(Number(n.toFixed(rule.digits)));
      out.push({ key: rule.key, value });
      break;
    }
  }
  return out;
}
