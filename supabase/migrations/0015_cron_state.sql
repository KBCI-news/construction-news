-- 크론 단계별 마지막 실행 시각. GitHub Actions 스케줄이 3~7시간에 한 번만 울려(10-08~10-13
-- 실측) 수집·묶음·썸네일이 멈춰 있었다. 화면이 열릴 때마다 /api/cron/tick 이 이 표를 보고
-- 오래된 단계 하나를 돌린다 — 직원이 쓰는 동안은 늘 신선하다.
create table if not exists public.cron_state (
  key text primary key,
  ran_at timestamptz not null default '1970-01-01',
  claimed_at timestamptz,
  note text
);
insert into public.cron_state (key) values ('collect'), ('score'), ('images')
on conflict (key) do nothing;
