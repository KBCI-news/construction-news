-- 채점 크론의 "밀린 묶음" 조회(cluster_id IS NULL AND (desks <> '{}' OR keep))용 부분 색인.
-- 0016 의 articles_unclustered_idx 는 cluster_id IS NULL 만 걸러, 원래 묶지 않는 일반 기사
-- 2만 3천여 행이 함께 들어 있었다. 결과가 0건이어도 그걸 다 훑느라 8.6초 → 시간 초과로
-- 채점 크론 500(10/19). 조회 조건과 같은 부분 색인이면 1.4ms.
create index if not exists articles_unclustered_tagged_idx
  on public.articles (pub_date desc)
  where cluster_id is null and (desks <> '{}'::text[] or keep);
