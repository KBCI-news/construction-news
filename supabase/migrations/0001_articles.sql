-- KBCI 뉴스 articles 저장 테이블
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  link text unique not null,
  original_link text,
  title text not null,
  description text,
  pub_date timestamptz not null,
  source_host text,
  categories text[] not null default '{}',
  collected_at timestamptz not null default now()
);

create index if not exists articles_pub_date_idx
  on public.articles (pub_date desc);

create index if not exists articles_categories_gin_idx
  on public.articles using gin (categories);

-- 30일 지난 기사 자동 삭제용 함수
create or replace function public.purge_old_articles()
returns void
language sql
as $$
  delete from public.articles
  where pub_date < now() - interval '30 days';
$$;

-- RLS 활성화 (서비스 키만 접근 가능하게 — 익명 접근 차단)
alter table public.articles enable row level security;
-- (정책 없음 = 서비스 롤만 통과)
