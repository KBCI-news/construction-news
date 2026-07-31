-- 지표 시계열 — 연체율은 수준보다 추이가 중요하다.
create table if not exists public.indicator_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value numeric not null,
  as_of timestamptz not null,
  source_host text,
  source_link text,
  created_at timestamptz not null default now(),
  unique (key, as_of, value)
);

create index if not exists indicator_history_key_idx
  on public.indicator_history (key, as_of desc);

alter table public.indicator_history enable row level security;

-- 현재 확인된 값을 시계열 첫 점으로 옮긴다
insert into public.indicator_history (key, value, as_of, source_host, source_link)
select key, value::numeric, as_of, source_host, source_link
from public.indicators
where value is not null and as_of is not null
on conflict do nothing;

-- 환율은 30분 주기 뉴스 추출로는 늘 낡은 값이라 지표에서 제외한다
delete from public.indicators where key = 'usd_krw';
