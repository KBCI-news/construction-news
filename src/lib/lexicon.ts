import { nfm } from "@/lib/match";

// ---------------------------------------------------------------------------
// 데스크 — "우리가 왜 이 기사를 보는가". 기사는 여러 데스크에 동시 소속될 수 있다.
// (기존 primaryCategory 고정 우선순위가 법령 기사를 finance로 흡수해
//  /category/law 에서 지워버리던 결함을 없애기 위해 다중 소속으로 바꿨다)
// ---------------------------------------------------------------------------
export type DeskId =
  | "collection"
  | "debtor"
  | "npl"
  | "creditinfo"
  | "survey"
  | "lending"
  | "edoc"
  | "own"
  | "peers"
  | "labor"
  | "macro";

export type Desk = {
  id: DeskId;
  label: string;
  // 화면에 상주하는 정의 한 줄 — 신규 담당자 온보딩 비용을 화면이 흡수한다
  definition: string;
  // 색은 항상 텍스트 라벨과 함께 쓴다 (흑백 인쇄·색맹 대응)
  className: string;
};

export const DESKS: Desk[] = [
  {
    id: "collection",
    label: "채권추심",
    definition: "추심 업무의 법·감독·제재와 실무 동향",
    className: "text-red-700",
  },
  {
    id: "debtor",
    label: "채무자보호",
    definition: "채무조정·회생파산, 채무자 권리 확대",
    className: "text-orange-700",
  },
  {
    id: "npl",
    label: "부실채권",
    definition: "연체율·NPL 매각 시장 — 위임 물량의 선행지표",
    className: "text-amber-700",
  },
  {
    id: "creditinfo",
    label: "정보보호",
    definition: "개인(신용)정보 보호·유출·규제, 마이데이터",
    className: "text-teal-700",
  },
  {
    id: "survey",
    label: "조사",
    definition: "신용조사·임대차조사·권리조사 등 조사 업무",
    className: "text-cyan-800",
  },
  {
    id: "lending",
    label: "대출",
    definition: "가계·개인사업자 대출과 여신 규제 — 추심 물량의 선행지표",
    className: "text-indigo-700",
  },
  {
    id: "edoc",
    label: "전자문서",
    definition: "문서 전자화·스캔·보관, 전자계약·전자결재, 공인전자문서",
    className: "text-blue-700",
  },
  {
    id: "own",
    label: "KB·자사",
    definition: "자사 및 KB그룹 언급 전량",
    className: "text-[#7A5E08]",
  },
  {
    id: "peers",
    label: "경쟁사",
    definition: "신용정보사·F&I·CB 등 동종업계 동향",
    className: "text-slate-700",
  },
  {
    id: "labor",
    label: "노동",
    definition: "근로·안전·콜센터 인력 법제",
    className: "text-violet-700",
  },
  {
    id: "macro",
    label: "거시",
    definition: "금리·가계부채·연체 환경",
    className: "text-green-800",
  },
];

export const getDesk = (id: string): Desk | undefined =>
  DESKS.find((d) => d.id === id);

export const deskLabel = (id: string): string => getDesk(id)?.label ?? id;

// ---------------------------------------------------------------------------
// 사건 종류 — "무슨 일이 일어났는가". 데스크와 직교한다.
// GNB의 "법·제도"는 데스크가 아니라 kind 필터로 구현해, 어느 데스크 소속이든
// 법령 기사가 누락되지 않게 한다.
// ---------------------------------------------------------------------------
export type KindId =
  | "regulation"
  | "legislation"
  | "judgment"
  | "market"
  | "stat"
  | "incident"
  | "company"
  | "tech";

export const KIND_LABELS: Record<KindId, string> = {
  regulation: "감독·제재",
  legislation: "입법·개정",
  judgment: "판결",
  market: "시장·거래",
  stat: "지표·통계",
  incident: "사고·유출",
  company: "기업",
  tech: "기술·보안",
};

export const LEGAL_KINDS: KindId[] = ["regulation", "legislation", "judgment"];

// ---------------------------------------------------------------------------
// 키워드 사전
//   tier 0~3 = 업무 근접도 (0이 가장 가깝다)
//   query    = 네이버 검색 API로 실제 호출할지 (false면 판정·태깅 전용)
//   사전은 DB가 아니라 코드에 둔다 — 누가 언제 왜 넣었는지 diff로 남아야 한다.
// ---------------------------------------------------------------------------
export type Term = {
  term: string;
  tier: 0 | 1 | 2 | 3;
  desk: DeskId;
  query?: boolean;
  /**
   * 감독기관명처럼 "발신 주체" 신호로만 쓰는 term.
   * 검색 쿼리로는 쓰되 업무 근접도(Tier)·데스크 태깅에서는 제외한다.
   * (금감원 언급만으로 업무 근접 T0가 되면 모든 당국 기사가 과대평가된다)
   */
  authOnly?: boolean;
};

// 티어별 폴링 주기(분). 쿼리 사전과 판정 사전을 분리해, 사전을 3배로 늘리면서도
// 네이버 호출량은 오히려 줄인다.
export const POLL_MINUTES: Record<0 | 1 | 2 | 3, number> = {
  0: 30,
  1: 120,
  2: 360,
  3: 1440,
};

const t = (
  term: string,
  tier: 0 | 1 | 2 | 3,
  desk: DeskId,
  query = false,
): Term => ({ term, tier, desk, query });

export const TERMS: Term[] = [
  // --- collection : 채권추심 ---
  t("채권추심", 0, "collection", true),
  t("채권추심법", 0, "collection", true),
  t("불법추심", 0, "collection", true),
  t("채권추심회사", 0, "collection", true),
  t("채권추심업", 0, "collection", true),
  t("위임직채권추심인", 0, "collection", true),
  t("채권추심 가이드라인", 0, "collection", true),
  t("매입채권추심", 0, "collection", true),
  t("추심위탁", 1, "collection", true),
  t("채권양도", 1, "collection", true),
  t("소멸시효", 1, "collection", true),
  t("지급명령", 1, "collection", true),
  t("채권압류", 1, "collection", true),
  t("강제집행", 1, "collection", true),
  t("대부업", 1, "collection", true),
  t("불법사금융", 1, "collection", true),
  t("채무자대리인", 1, "collection", true),
  t("추심 유예", 1, "collection", true),
  t("민사집행법", 1, "collection", true),
  t("시효중단", 1, "collection"),
  t("시효연장", 1, "collection"),
  t("가압류", 1, "collection"),
  t("대위변제", 1, "collection"),
  t("구상권", 1, "collection"),
  t("채권양도통지", 1, "collection"),
  t("추심수수료", 1, "collection"),
  t("무담보채권", 1, "collection"),
  t("담보부채권", 1, "collection"),
  t("채무불이행자", 1, "collection"),
  t("추심연락", 1, "collection"),
  t("상거래채권", 1, "collection"),
  t("채권관리", 1, "collection"),
  t("대부채권 매각", 1, "collection"),

  // --- debtor : 채무자보호 ---
  t("개인채무자보호법", 0, "debtor", true),
  t("채무조정", 0, "debtor", true),
  t("개인회생", 1, "debtor", true),
  t("개인파산", 1, "debtor", true),
  t("신용회복위원회", 1, "debtor", true),
  t("신속채무조정", 1, "debtor", true),
  t("새출발기금", 1, "debtor", true),
  t("프리워크아웃", 1, "debtor"),
  t("개인워크아웃", 1, "debtor"),
  t("면책", 1, "debtor"),
  t("회생절차", 1, "debtor"),
  t("서울회생법원", 1, "debtor"),
  t("채무자회생법", 1, "debtor"),
  t("채무조정 요청권", 1, "debtor"),
  t("상환유예", 1, "debtor"),
  t("연체이자 감면", 1, "debtor"),
  t("신용사면", 1, "debtor"),
  t("이자제한법", 1, "debtor"),
  t("법정최고금리", 1, "debtor"),
  t("다중채무자", 1, "debtor"),
  t("취약차주", 1, "debtor"),

  // --- npl : 부실채권 ---
  t("부실채권", 0, "npl", true),
  t("NPL 매각", 0, "npl", true),
  t("연체율", 1, "npl", true),
  t("고정이하여신", 1, "npl", true),
  t("부실채권 매각", 1, "npl", true),
  t("상각채권", 1, "npl", true),
  t("대손충당금", 1, "npl"),
  t("대손상각", 1, "npl"),
  t("NPL 시장", 1, "npl"),
  t("연체채권", 1, "npl"),
  t("가계대출 연체율", 1, "npl"),
  t("저축은행 연체율", 1, "npl"),
  t("카드 연체율", 1, "npl"),
  t("유동화전문회사", 1, "npl"),
  t("자산유동화", 1, "npl"),
  t("배드뱅크", 1, "npl"),
  t("NPL 비율", 1, "npl"),

  // --- creditinfo : 신용정보 ---
  t("신용정보법", 0, "creditinfo", true),
  t("신용정보업", 0, "creditinfo", true),
  t("개인정보 유출", 0, "creditinfo", true),
  t("신용정보", 1, "creditinfo", true),
  t("마이데이터", 1, "creditinfo", true),
  t("개인정보보호법", 1, "creditinfo", true),
  t("개인정보보호위원회", 1, "creditinfo", true),
  t("가명정보", 1, "creditinfo", true),
  t("신용평가", 1, "creditinfo", true),
  t("대안신용평가", 1, "creditinfo", true),
  t("신용정보업감독규정", 1, "creditinfo"),
  t("신용정보관리보호인", 1, "creditinfo"),
  t("본인신용정보관리업", 1, "creditinfo"),
  t("한국신용정보원", 1, "creditinfo"),
  t("신용정보원", 1, "creditinfo"),
  t("전송요구권", 1, "creditinfo"),
  t("데이터전문기관", 1, "creditinfo"),
  t("데이터 결합", 1, "creditinfo"),
  t("개인신용평점", 1, "creditinfo"),
  t("정보활용동의", 1, "creditinfo"),
  t("익명정보", 1, "creditinfo"),
  t("정보주체", 1, "creditinfo"),
  t("개인정보 과징금", 1, "creditinfo"),
  t("신용정보 유출", 1, "creditinfo"),

  // --- survey : 조사 (신용조사·임대차·권리조사) ---
  t("신용조사", 0, "survey", true),
  t("임대차조사", 0, "survey", true),
  t("권리조사", 0, "survey", true),
  t("현장조사", 1, "survey", true),
  t("임대차 실태조사", 1, "survey", true),
  t("전세사기", 1, "survey", true),
  t("확정일자", 1, "survey"),
  t("전입세대열람", 1, "survey"),
  t("등기부등본", 1, "survey"),
  t("등기사항증명서", 1, "survey"),
  t("근저당권", 1, "survey"),
  t("선순위 임차인", 1, "survey"),
  t("대항력", 1, "survey"),
  t("우선변제권", 1, "survey"),
  t("보증금 반환", 1, "survey"),
  t("전세보증금", 1, "survey"),
  t("임대차보호법", 1, "survey", true),
  t("주택임대차", 1, "survey"),
  t("상가임대차", 1, "survey"),
  t("권리분석", 1, "survey"),
  t("부동산 경매", 1, "survey"),
  t("공매", 1, "survey"),
  t("배당요구", 1, "survey"),
  t("신용조회", 1, "survey"),
  t("재산조사", 1, "survey"),
  t("소재파악", 1, "survey"),

  // --- lending : 대출·여신 (추심 물량의 선행지표) ---
  t("가계대출", 1, "lending", true),
  t("가계부채", 1, "lending", true),
  t("대출규제", 1, "lending", true),
  t("주택담보대출", 1, "lending", true),
  t("신용대출", 1, "lending", true),
  t("개인사업자대출", 1, "lending", true),
  t("자영업자 대출", 1, "lending", true),
  t("대출금리", 2, "lending", true),
  t("DSR", 1, "lending"),
  t("스트레스DSR", 1, "lending"),
  t("LTV", 1, "lending"),
  t("DTI", 1, "lending"),
  t("여신심사", 1, "lending"),
  t("총량규제", 1, "lending"),
  t("정책대출", 1, "lending"),
  t("디딤돌대출", 1, "lending"),
  t("버팀목대출", 1, "lending"),
  t("보금자리론", 1, "lending"),
  t("중도상환수수료", 1, "lending"),
  t("대환대출", 1, "lending"),
  t("햇살론", 1, "lending"),
  t("서민금융", 1, "lending"),
  t("소상공인 대출", 1, "lending"),

  // --- edoc : 전자문서 ---
  t("공인전자문서", 0, "edoc", true),
  t("공인전자문서센터", 0, "edoc", true),
  t("전자문서법", 0, "edoc", true),
  t("전자문서", 1, "edoc", true),
  t("전자금융거래법", 1, "edoc", true),
  t("전자금융감독규정", 1, "edoc", true),
  t("전자서명", 1, "edoc", true),
  t("전자고지", 1, "edoc", true),
  t("공인전자문서중계자", 1, "edoc"),
  t("전자화문서", 1, "edoc"),
  t("유통증명서", 1, "edoc"),
  t("공인전자주소", 1, "edoc"),
  t("모바일 전자고지", 1, "edoc"),
  t("전자서명인증사업자", 1, "edoc"),
  t("온라인 송달", 1, "edoc"),
  t("전자소송", 1, "edoc"),
  t("전자계약", 1, "edoc", true),
  t("타임스탬프", 1, "edoc"),
  // 실제 사업 영역: 종이문서 전자화·스캔·보관·전자결재
  t("문서 전자화", 0, "edoc", true),
  t("종이문서", 1, "edoc", true),
  t("전자결재", 1, "edoc", true),
  t("문서보관", 1, "edoc", true),
  t("기록물관리", 1, "edoc", true),
  t("스캔본", 1, "edoc"),
  t("신뢰스캔", 1, "edoc"),
  t("전자화 대상문서", 1, "edoc"),
  t("문서 보존", 1, "edoc"),
  t("보존연한", 1, "edoc"),
  t("원본대조", 1, "edoc"),
  t("문서 파기", 1, "edoc"),
  t("전자문서 유통", 1, "edoc"),
  t("전자문서산업", 2, "edoc"),

  // --- own : KB·자사 ---
  t("KB신용정보", 0, "own", true),
  t("KB금융", 1, "own", true),
  t("KB국민은행", 1, "own", true),
  t("KB국민카드", 1, "own", true),
  t("KB금융지주", 1, "own"),
  t("KB캐피탈", 1, "own"),
  t("KB저축은행", 1, "own"),
  t("KB손해보험", 1, "own"),
  t("KB증권", 1, "own"),
  t("KB라이프", 1, "own"),
  t("KB데이타시스템", 1, "own"),

  // --- peers : 경쟁사 ---
  t("고려신용정보", 1, "peers", true),
  t("나이스신용정보", 1, "peers", true),
  t("미래신용정보", 1, "peers", true),
  t("SGI신용정보", 1, "peers", true),
  t("신한신용정보", 1, "peers", true),
  t("우리신용정보", 1, "peers"),
  t("하나신용정보", 1, "peers"),
  t("IBK신용정보", 1, "peers"),
  t("MG신용정보", 1, "peers"),
  t("새한신용정보", 1, "peers"),
  t("솔림신용정보", 1, "peers"),
  t("우리금융에프앤아이", 1, "peers"),
  t("하나에프앤아이", 1, "peers"),
  t("대신에프앤아이", 1, "peers"),
  t("키움에프앤아이", 1, "peers"),
  t("유암코", 1, "peers"),
  t("연합자산관리", 1, "peers"),
  t("NICE평가정보", 1, "peers"),
  t("코리아크레딧뷰로", 1, "peers"),
  t("KCB", 1, "peers"),
  t("한국기업데이터", 1, "peers"),

  // --- labor : 노동 ---
  t("근로기준법", 1, "labor", true),
  t("노란봉투법", 1, "labor", true),
  t("중대재해처벌법", 1, "labor", true),
  t("산업안전보건법", 2, "labor"),
  t("고용노동부", 2, "labor"),
  t("통상임금", 2, "labor"),
  t("직장 내 괴롭힘", 2, "labor"),
  t("감정노동", 2, "labor"),
  t("고객응대근로자", 2, "labor"),
  t("콜센터 상담원", 2, "labor"),
  t("파견근로", 2, "labor"),
  t("최저임금", 2, "labor"),
  t("정년연장", 2, "labor"),
  t("계속고용", 2, "labor"),
  t("근로시간 개편", 2, "labor"),

  // --- macro : 거시 (지표 공급원. 광범위 키워드는 T2로 낮춰 노이즈를 억제) ---
  t("기준금리", 1, "macro", true),
  t("금융통화위원회", 3, "macro"),
  t("금통위", 3, "macro"),
  t("소비자물가", 3, "macro"),
  t("코픽스", 3, "macro"),
  t("예금금리", 3, "macro"),
  t("부동산 PF", 3, "macro"),
  t("한계기업", 3, "macro"),
  t("가계신용", 3, "macro"),

  // --- 감독기관 축 (기존 사전에 통째로 누락돼 있던 축) ---
  // authOnly: 검색은 하되 업무 근접도/데스크에는 기여하지 않는다.
  // 업권 접점이 없는 당국 기사는 가드레일이 55점으로 묶는다.
  { term: "금융위원회", tier: 2, desk: "macro", query: true, authOnly: true },
  { term: "금융감독원", tier: 2, desk: "macro", query: true, authOnly: true },
  { term: "공정거래위원회", tier: 2, desk: "macro", query: true, authOnly: true },
  { term: "금융보안원", tier: 2, desk: "edoc", query: true, authOnly: true },
  // 복합 AND 쿼리 — 기관명 단독 검색의 노이즈를 억제한다
  t("금감원 채권추심", 0, "collection", true),
  t("금융위 신용정보", 0, "creditinfo", true),
  t("개인정보보호위원회 과징금", 0, "creditinfo", true),
];

// 네이버 검색으로 실제 호출할 term만
export const QUERY_TERMS: Term[] = TERMS.filter((x) => x.query);

// 정규화 캐시 — 매 기사마다 사전을 재정규화하지 않는다
export type PreparedTerm = Term & { norm: string };

export const PREPARED_TERMS: PreparedTerm[] = TERMS.map((x) => ({
  ...x,
  norm: nfm(x.term),
}));

// ---------------------------------------------------------------------------
// 행위성 사전 — "무엇이 실제로 일어났는가". 등급이 높을수록 확정적 사건.
// ---------------------------------------------------------------------------
export type ActGrade = {
  value: number;
  label: string;
  kind: KindId;
  terms: string[];
};

export const ACT_GRADES: ActGrade[] = [
  {
    value: 1.0,
    label: "제재·집행",
    kind: "regulation",
    terms: [
      "과징금", "과태료", "제재", "행정처분", "시정명령", "기관경고",
      "경영유의", "영업정지", "등록취소", "인가취소", "검사 착수",
      "종합검사", "현장점검", "압수수색", "기소", "구속", "적발",
      "제재심의위원회",
    ],
  },
  {
    value: 0.9,
    label: "확정·시행",
    kind: "legislation",
    // "시행령"·"시행규칙"은 행위가 아니라 법령의 종류를 가리키는 명사이므로 제외한다.
    // (부분문자열 매칭이라 "시행령 개정안 입법예고"까지 확정으로 오판했다)
    terms: [
      "공포", "의결", "확정", "통과", "가결", "제정", "부칙",
      "고시 개정", "감독규정 개정", "국무회의", "관보 게재",
    ],
  },
  {
    value: 0.85,
    label: "사법",
    kind: "judgment",
    terms: [
      "대법원", "판결", "선고", "위헌", "각하", "확정판결", "판례",
      "손해배상 인정",
    ],
  },
  {
    value: 0.6,
    label: "입법진행",
    kind: "legislation",
    terms: [
      "개정안", "입법예고", "발의", "상정", "추진", "공청회", "초안",
      "유권해석", "행정지도", "가이드라인", "업무계획", "로드맵",
    ],
  },
  {
    value: 0.5,
    label: "시장행위",
    kind: "market",
    terms: [
      "매각", "입찰", "인수", "합병", "유동화", "출자", "인가 신청",
      "사업 진출", "철수", "구조조정",
    ],
  },
  {
    value: 0.4,
    label: "수치발표",
    kind: "stat",
    terms: ["사상 최대", "급증", "급감", "역대", "돌파", "집계", "발표"],
  },
];

export const PREPARED_ACT = ACT_GRADES.map((g) => ({
  ...g,
  norms: g.terms.map(nfm),
}));

// ---------------------------------------------------------------------------
// 발신 주체 사전 — 누가 말했는가. A1(정책 결정권) > A2(집행·유관) > A3(협회·연구)
// ---------------------------------------------------------------------------
export type AuthGrade = { value: number; label: string; terms: string[] };

export const AUTH_GRADES: AuthGrade[] = [
  {
    value: 1.0,
    label: "금융당국",
    terms: [
      "금융위원회", "금융위", "금융감독원", "금감원", "개인정보보호위원회",
      "개보위", "공정거래위원회", "대법원", "헌법재판소", "법무부",
      "금융정보분석원", "국회 정무위원회",
    ],
  },
  {
    value: 0.65,
    label: "유관기관",
    terms: [
      "한국은행", "금통위", "과학기술정보통신부", "고용노동부",
      "한국신용정보원", "금융보안원", "KISA", "한국인터넷진흥원",
      "신용회복위원회", "한국자산관리공사", "캠코", "예금보험공사",
      "금융결제원", "제재심의위원회",
    ],
  },
  {
    value: 0.35,
    label: "협회·연구",
    terms: [
      "신용정보협회", "여신금융협회", "은행연합회", "저축은행중앙회",
      "대부금융협회", "한국금융연구원", "KDI", "자본시장연구원",
    ],
  },
];

// 부분문자열 충돌 방어 — 짧은 약칭이 무관한 단어 안에 들어가는 경우를 무효화한다.
// 예: "금융위임장"에는 "금융위"가 포함되지만 금융위원회 기사가 아니다.
export const TERM_COLLISIONS: { term: string; voidedBy: string[] }[] = [
  { term: "금융위", voidedBy: ["금융위임장"] },
  { term: "발표", voidedBy: ["발표회", "신곡 발표"] },
  // "등기부등본"이 홍보 노이즈 "기부"에 걸려 권리조사 기사가 75% 감점됐다
  { term: "기부", voidedBy: ["등기부", "기부채납", "기부채무"] },
  { term: "수상", voidedBy: ["수상한", "수상스키", "수상운송"] },
  { term: "증정", voidedBy: ["실증정"] },
];

export const PREPARED_COLLISIONS = TERM_COLLISIONS.map((c) => ({
  norm: nfm(c.term),
  voidedByNorms: c.voidedBy.map(nfm),
}));

export const PREPARED_AUTH = AUTH_GRADES.map((g) => ({
  ...g,
  norms: g.terms.map(nfm),
}));

// ---------------------------------------------------------------------------
// 노이즈 감점 — 곱셈으로 중첩 적용. 수집 자체를 막지 않고 순위만 떨어뜨린다.
// ---------------------------------------------------------------------------
export type NoiseRule = { factor: number; label: string; terms: string[] };

export const NOISE_RULES: NoiseRule[] = [
  {
    factor: 0.25,
    label: "홍보·생활정보",
    terms: [
      "이벤트", "출시 기념", "무료 상담", "특판", "카드 혜택", "경품",
      "증정", "채용 공고", "MOU", "업무협약", "봉사활동", "후원",
      "기부", "수상", "우수기업 선정",
    ],
  },
  {
    factor: 0.3,
    label: "시세성",
    terms: [
      "특징주", "목표주가", "상한가", "하한가", "장중", "코스피 마감",
      "시간외", "투자의견", "종목 추천", "개장시황", "마감시황",
      "강보합", "약보합", "혼조세", "증시 전망", "코스피 지수",
      "코스닥 지수", "시황", "개장", "지수 하락", "지수 상승",
    ],
  },
  {
    factor: 0.7,
    label: "묶음성",
    terms: ["종합", "브리핑", "이 시각", "일지"],
  },
];

export const PREPARED_NOISE = NOISE_RULES.map((r) => ({
  ...r,
  norms: r.terms.map(nfm),
}));

// 말머리 — 정규화 전 원문 제목에서만 판정한다
export const HEADER_TAG_RE =
  /[[【(]\s*(부고|인사|동정|포토|사진|영상|표|게시판|카드뉴스|기고|칼럼|사설)\s*[\]】)]/;

// KB 계열 단순 시세 — 자사 뉴스로 오인되는 최대 노이즈원
export const KB_TICKER_RE = /kb(금융|국민은행|국민카드).{0,12}(주가|목표주가|배당|상승|하락)/;

// 자사 리스크 강제 승격 트리거 / 취소어
export const OWN_RISK_TERMS = [
  "제재", "과징금", "과태료", "소송", "피소", "유출", "압수수색",
  "징계", "논란", "의혹", "민원", "해킹", "전산장애", "횡령",
];
export const OWN_RISK_NULLIFIERS = [
  "리브모바일", "KB스타즈", "야구", "후원", "봉사", "이벤트",
  "경품", "목표주가", "특징주",
];

export const PREPARED_OWN_RISK = OWN_RISK_TERMS.map(nfm);
export const PREPARED_OWN_NULLIFIERS = OWN_RISK_NULLIFIERS.map(nfm);

// ---------------------------------------------------------------------------
// 매체 등급 — 업권·경제 전문지를 우대. 미등록은 감점 없이 중립(0.5).
// ---------------------------------------------------------------------------
export const SOURCE_TIERS: Record<string, number> = {
  "yna.co.kr": 1.0,
  "hankyung.com": 1.0,
  "mk.co.kr": 1.0,
  "sedaily.com": 1.0,
  "fnnews.com": 1.0,
  "edaily.co.kr": 1.0,
  "mt.co.kr": 1.0,
  "asiae.co.kr": 1.0,
  "view.asiae.co.kr": 1.0,
  "biz.chosun.com": 1.0,
  "etnews.com": 1.0,
  "dt.co.kr": 1.0,
  "lawtimes.co.kr": 1.0,
  "fntimes.com": 1.0,
  "thebell.co.kr": 1.0,
  "news.einfomax.co.kr": 1.0,
  "einfomax.co.kr": 1.0,
  "biz.heraldcorp.com": 0.8,
  "newsis.com": 0.8,
  "news1.kr": 0.8,
  "newspim.com": 0.8,
  "yonhapnewstv.co.kr": 0.8,
  "news.kbs.co.kr": 0.8,
  "ytn.co.kr": 0.8,
  "biz.sbs.co.kr": 0.8,
  "imnews.imbc.com": 0.8,
  "donga.com": 0.8,
  "joongang.co.kr": 0.8,
  "chosun.com": 0.8,
  "hani.co.kr": 0.8,
  "khan.co.kr": 0.8,
  "seoul.co.kr": 0.8,
  "kmib.co.kr": 0.8,
  "segye.com": 0.8,
  "munhwa.com": 0.8,
  "hankookilbo.com": 0.8,
  "etoday.co.kr": 0.8,
  "ajunews.com": 0.8,
  "dailian.co.kr": 0.8,
  "ebn.co.kr": 0.8,
  "g-enews.com": 0.8,
  // 암호화폐 전문 매체 — 우리 업권과 접점이 거의 없어 낮게 둔다
  "tokenpost.kr": 0.2,
  "blockmedia.co.kr": 0.2,
  "coinreaders.com": 0.2,
};

export const sourceTier = (host: string | null | undefined): number => {
  if (!host) return 0.5;
  const h = host.replace(/^www\./, "");
  return SOURCE_TIERS[h] ?? 0.5;
};

// ---------------------------------------------------------------------------
// 등급 임계값
// ---------------------------------------------------------------------------
export type ImportanceTier = "must" | "important" | "reference" | "archive";

export const tierOf = (score: number, urgent = false): ImportanceTier => {
  if (urgent || score >= 72) return "must";
  if (score >= 55) return "important";
  if (score >= 40) return "reference";
  return "archive";
};

export const TIER_LABELS: Record<ImportanceTier, string> = {
  must: "필수확인",
  important: "중요",
  reference: "참고",
  archive: "아카이브",
};
