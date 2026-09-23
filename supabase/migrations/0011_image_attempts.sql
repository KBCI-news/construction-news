-- 썸네일 채우기 시도 기록.
-- 실패를 기록하지 않아 og:image를 끝내 못 주는 상위 기사 60건이 매 회차
-- 같은 자리를 차지했고, 나머지 기사는 영영 차례가 오지 않았다
-- (2026-09-23 기준 3일치 2,787건 중 2,233건 이미지 없음).
alter table public.articles
  add column if not exists image_attempts smallint not null default 0,
  add column if not exists image_checked_at timestamptz;

-- 채우기 후보 조회: 이미지 없음 + 대표 기사 + 최근순
create index if not exists articles_image_backfill_idx
  on public.articles (is_rep, pub_date desc)
  where image_url is null;

notify pgrst, 'reload schema';
