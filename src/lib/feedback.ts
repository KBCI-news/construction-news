// 의견 접수 설문(네이버폼) 링크. 담당자가 상시 열어 두는 폼 하나를 쓴다.
// 비어 있으면 화면은 "설문 링크 준비 중"으로 표시되고 버튼이 잠긴다.
export const FEEDBACK_FORM_URL = "";

export const hasFeedbackForm = (): boolean => /^https?:\/\//.test(FEEDBACK_FORM_URL);
