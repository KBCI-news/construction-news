-- 경제지표 — 값은 수집된 기사에서 자동 추출하고 항상 출처 기사를 함께 보관한다.
-- 사람이 확인할 수 없는 숫자는 사내 게시물에 쓸 수 없기 때문이다.
create table if not exists public.indicators (
  key text primary key,
  label text not null,
  value text,
  unit text,
  as_of timestamptz,
  source_host text,
  source_link text,
  source_title text,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.indicators enable row level security;

insert into public.indicators (key, label, unit, sort_order) values
  ('base_rate',        '기준금리',        '%',  1),
  ('usd_krw',          '원/달러 환율',    '원', 2),
  ('household_delinq', '가계대출 연체율', '%',  3),
  ('bank_delinq',      '은행 연체율',     '%',  4),
  ('card_delinq',      '카드 연체율',     '%',  5),
  ('savings_delinq',   '저축은행 연체율', '%',  6)
on conflict (key) do nothing;
