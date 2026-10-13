-- 채점 크론의 "아직 안 묶인/안 채점된 기사" 조회용 부분 색인.
-- 소급분이 다 묶이고 나자 cluster_id IS NULL 조회가 날짜 색인으로 전체(7만 행)를 훑어
-- 8초 시간 초과 → 채점 크론 500. 부분 색인이면 비어 있어도 75ms.
create index if not exists articles_unclustered_idx on public.articles (pub_date desc) where cluster_id is null;
create index if not exists articles_unscored_idx on public.articles (pub_date desc) where scored_at is null;
