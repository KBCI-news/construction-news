-- (key, as_of) 부분 유니크 인덱스는 PostgREST upsert의 중재자로 쓸 수 없어
-- (WHERE 절 없는 ON CONFLICT 대상이 못 된다) ECOS 적재가 폴백 경로로 빠졌고,
-- 그 폴백이 source_kind를 떼고 저장해 공식 통계가 news로 들어갔다.
-- 중복 방지는 (key, as_of, value) 전체 유니크 제약이 이미 담당한다.
drop index if exists public.indicator_history_official_uniq;

-- 잘못 라벨링된 ECOS 점 복구 — 출처 호스트가 그대로 남아 있어 식별 가능
update public.indicator_history
set source_kind = 'official'
where source_host = 'ecos.bok.or.kr' and source_kind <> 'official';

-- 0007에서 추가한 컬럼을 PostgREST 스키마 캐시가 아직 모르는 상태였다
notify pgrst, 'reload schema';
