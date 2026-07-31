-- 지표 출처 구분 — 공식 통계(한국은행 ECOS 등)와 기사 추출값을 섞지 않는다.
-- 공식값이 한 번이라도 들어온 지표는 기사 추출이 덮어쓰지 못하게 한다.
alter table public.indicators
  add column if not exists source_kind text not null default 'news';

alter table public.indicator_history
  add column if not exists source_kind text not null default 'news';

-- 공식 통계는 (지표, 시점)당 값이 하나뿐이다. 기사 추출은 같은 날 다른 값이
-- 보도될 수 있어 값까지 포함한 기존 유니크 제약을 그대로 둔다.
create unique index if not exists indicator_history_official_uniq
  on public.indicator_history (key, as_of)
  where source_kind = 'official';

comment on column public.indicators.source_kind is 'official = 기관 원본 통계, news = 기사 자동 추출';
