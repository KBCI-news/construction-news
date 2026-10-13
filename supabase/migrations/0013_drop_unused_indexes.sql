-- 쓰이지 않는 색인 정리 — upsert 마다 색인 12개를 갱신하느라 500행에 4초가 걸렸다.
-- pg_stat_user_indexes 기준: categories GIN 0회, query_terms GIN 0회(태그가 keep 으로
-- 바뀌어 더는 안 씀), 제목 trigram GIN 31회(검색은 제목+요약 ilike 라 색인을 못 탄다).
drop index if exists public.articles_categories_gin_idx;
drop index if exists public.articles_query_terms_idx;
drop index if exists public.articles_title_trgm_idx;
