-- 태그 붙은 대표 기사만 담은 부분 색인 — 뉴스 화면의 모든 태그 조회가 이 두 색인을 탄다.
-- 날짜 색인으로 태그 없는 기사 2.8만 행을 걸러 가며 5.4초 걸리던 "채권추심 · 최신순"이 8ms.
-- 조회 쪽은 desks <> '{}' 를 조건에 함께 걸어야 색인 술어가 맞는다(피드 API 참고).
create index if not exists articles_tagged_rep_pub_idx
  on public.articles (pub_date desc) where is_rep and desks <> '{}';
create index if not exists articles_tagged_rep_imp_idx
  on public.articles (importance desc nulls last, pub_date desc) where is_rep and desks <> '{}';
