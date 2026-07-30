-- 큐레이션 엔진: 중요도 점수/근거, 데스크·종류 태깅, 보도 클러스터를 서버에 저장한다.
-- (기존에는 브라우저가 1000건을 받아 매 페이지마다 재계산했다)

alter table public.articles
  add column if not exists importance smallint,
  add column if not exists importance_tier text,
  add column if not exists importance_parts jsonb,
  add column if not exists reasons jsonb,
  add column if not exists urgent boolean not null default false,
  add column if not exists desks text[] not null default '{}',
  add column if not exists kinds text[] not null default '{}',
  add column if not exists matched_terms text[] not null default '{}',
  add column if not exists cluster_id text,
  add column if not exists cluster_hosts smallint not null default 1,
  add column if not exists is_rep boolean not null default true,
  add column if not exists scored_at timestamptz;

-- 피드 기본 정렬: 중요도 → 최신
create index if not exists articles_importance_idx
  on public.articles (importance desc nulls last, pub_date desc);

-- 데스크/종류 배열 교집합 필터
create index if not exists articles_desks_gin_idx on public.articles using gin (desks);
create index if not exists articles_kinds_gin_idx on public.articles using gin (kinds);

-- 채점 대기 대상 조회 (scored_at is null 우선)
create index if not exists articles_scored_at_idx
  on public.articles (scored_at nulls first, pub_date desc);

-- 클러스터 대표만 노출할 때
create index if not exists articles_cluster_idx on public.articles (cluster_id, is_rep);

-- 제목 부분검색(자체 아카이브 검색) — 네이버 실시간 조회에 의존하지 않게 한다
create extension if not exists pg_trgm;
create index if not exists articles_title_trgm_idx
  on public.articles using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 브리핑(게시판 부착용 산출물) — 담기 → 정렬 → 코멘트 → 발행
-- ---------------------------------------------------------------------------
create sequence if not exists public.brief_no_seq;

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  no integer not null default nextval('public.brief_no_seq'),
  title text not null default '주요 뉴스 요약',
  note text,
  editor text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brief_items (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  article_link text not null,
  position smallint not null default 0,
  comment text,
  created_at timestamptz not null default now(),
  unique (brief_id, article_link)
);

create index if not exists brief_items_brief_idx
  on public.brief_items (brief_id, position);

alter table public.briefs enable row level security;
alter table public.brief_items enable row level security;

-- 30일 정리에서 브리핑에 채택된 기사는 제외한다 — 발행 이력이 깨지면 안 된다
create or replace function public.purge_old_articles()
returns void
language sql
as $$
  delete from public.articles a
  where a.pub_date < now() - interval '30 days'
    and not exists (
      select 1 from public.brief_items bi where bi.article_link = a.link
    );
$$;
