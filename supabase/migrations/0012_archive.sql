-- 보관함: 30일 정리에서 제외할 기사(keep)와 그 기사를 어떤 검색어가 가져왔는지(query_terms).
-- KB신용정보 태그는 최근 30일이 아니라 5년치를 보여 주기로 해, 그 검색어로 수집된
-- 기사는 keep=true 로 남긴다. 네이버 요약(스니펫)에 검색어가 안 보이는 기사가 많아
-- 제목·요약 ilike 로는 못 찾던 것도 query_terms 로 찾는다.
alter table public.articles
  add column if not exists keep boolean not null default false,
  add column if not exists query_terms text[] not null default '{}';

create index if not exists articles_query_terms_idx on public.articles using gin (query_terms);
create index if not exists articles_keep_idx on public.articles (pub_date desc) where keep;

-- 수집 크론은 link 기준 upsert 로 덮어쓴다 — 보관 표시와 수집 검색어는 누적되어야 한다
create or replace function public.articles_merge_archive()
returns trigger
language plpgsql
as $$
begin
  -- 보관함 정리(keep 해제)처럼 의도한 갱신은 app.archive_raw=1 로 합치기를 건너뛴다
  if coalesce(current_setting('app.archive_raw', true), '') <> '1' then
    new.keep := old.keep or new.keep;
    new.query_terms := (
      select coalesce(array_agg(distinct t order by t), '{}')
      from unnest(old.query_terms || new.query_terms) as t
    );
  end if;
  return new;
end;
$$;

drop trigger if exists articles_merge_archive on public.articles;
create trigger articles_merge_archive
  before update on public.articles
  for each row execute function public.articles_merge_archive();

-- 보존: 태그 없는 일반 기사 30일, 태그 기사 3년, 보관(keep) 기사 5년.
-- 네이버 검색 색인이 15개월 안팎까지 내주므로 소급분을 다 담으려면 1년으론 모자란다.
create or replace function public.purge_old_articles()
returns void
language sql
as $$
  delete from public.articles a
  where (
      (a.keep and a.pub_date < now() - interval '5 years')
      or (not a.keep and a.desks <> '{}' and a.pub_date < now() - interval '1095 days')
      or (not a.keep and a.desks = '{}' and a.pub_date < now() - interval '30 days')
    )
    and not exists (
      select 1 from public.brief_items bi where bi.article_link = a.link
    );
$$;
