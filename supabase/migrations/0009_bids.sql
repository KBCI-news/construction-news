-- 입찰공고(나라장터) — 사업 기회 모니터링.
-- 뉴스와 성격이 다르다. 기사는 "읽고 마는" 것이지만 공고는 마감이 있는
-- 액션 아이템이라, 마감 지난 공고까지 보존하고 별도 화면으로 뺀다.
create table if not exists public.bids (
  -- 공고번호+차수가 나라장터의 자연키다. 재공고는 차수가 올라간다.
  bid_key text primary key,
  bid_no text not null,
  bid_ord text not null default '00',

  title text not null,
  -- 업무구분(용역/물품/공사) — API 오퍼레이션 단위와 1:1
  work_div text,
  -- 공고종류(일반공고/긴급공고/재공고 등)
  notice_kind text,
  -- 계약방법(일반경쟁/제한경쟁/협상에의한계약 등)
  contract_method text,
  -- 공고기관 / 수요기관 — 실제 발주처는 수요기관이다
  notice_agency text,
  demand_agency text,
  region text,

  -- 금액(원). 추정가격과 배정예산은 서로 다른 수치라 따로 둔다.
  presmpt_price bigint,
  budget_amount bigint,

  notice_dt timestamptz,
  begin_dt timestamptz,
  close_dt timestamptz,
  opening_dt timestamptz,

  detail_url text,
  ref_no text,

  -- 우리 사업 분야 태깅 (scan/archive/lease/rights) — 복수 소속 가능
  areas text[] not null default '{}',
  matched_terms text[] not null default '{}',
  -- 매칭 강도 0~100. 확정 키워드(strong)면 높게 잡는다.
  relevance smallint not null default 0,

  raw jsonb,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기본 정렬: 공고일 최신순
create index if not exists bids_notice_dt_idx on public.bids (notice_dt desc nulls last);
-- 마감 임박 정렬
create index if not exists bids_close_dt_idx on public.bids (close_dt asc nulls last);
-- 분야 필터
create index if not exists bids_areas_gin_idx on public.bids using gin (areas);
-- 제목 부분검색 (0004에서 이미 켜지지만 단독 적용도 가능하게 둔다)
create extension if not exists pg_trgm;
create index if not exists bids_title_trgm_idx
  on public.bids using gin (title gin_trgm_ops);

alter table public.bids enable row level security;
-- (정책 없음 = 서비스 롤만 통과. 화면은 서버 라우트를 거친다)

-- 수집 실행 이력 — "1시간마다 진짜 돌고 있나"를 화면에서 확인할 수 있어야 한다
create table if not exists public.bid_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  window_from timestamptz,
  window_to timestamptz,
  scanned integer not null default 0,
  matched integer not null default 0,
  upserted integer not null default 0,
  ok boolean not null default true,
  detail text
);

create index if not exists bid_runs_ran_at_idx on public.bid_runs (ran_at desc);

alter table public.bid_runs enable row level security;

-- 정리: 마감 1년 지난 공고와 90일 지난 실행 이력.
-- 공고는 과거 낙찰 이력 조회에 쓰이므로 기사(30일)보다 훨씬 길게 남긴다.
create or replace function public.purge_old_bids()
returns void
language sql
as $$
  delete from public.bids
  where coalesce(close_dt, notice_dt) < now() - interval '365 days';

  delete from public.bid_runs
  where ran_at < now() - interval '90 days';
$$;
