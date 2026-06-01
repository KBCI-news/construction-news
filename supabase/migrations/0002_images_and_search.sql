-- 기사 대표 이미지(og:image) 저장 컬럼
alter table public.articles
  add column if not exists image_url text;

-- 사용자 검색어 로그 (인기 검색어 TOP N 집계용)
create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  created_at timestamptz not null default now()
);

create index if not exists search_logs_created_at_idx
  on public.search_logs (created_at desc);

alter table public.search_logs enable row level security;
-- (정책 없음 = 서비스 롤만 통과)

-- 최근 N일간 인기 검색어 TOP limit 집계
create or replace function public.top_search_queries(
  days integer default 7,
  result_limit integer default 10
)
returns table(query text, count bigint)
language sql
stable
as $$
  select query, count(*)::bigint as count
  from public.search_logs
  where created_at > now() - make_interval(days => days)
  group by query
  order by count desc, max(created_at) desc
  limit result_limit;
$$;

-- 90일 지난 검색 로그 정리(기존 purge_old_articles와 함께 호출)
create or replace function public.purge_old_search_logs()
returns void
language sql
as $$
  delete from public.search_logs
  where created_at < now() - interval '90 days';
$$;
