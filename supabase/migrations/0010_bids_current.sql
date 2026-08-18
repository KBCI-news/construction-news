-- 같은 공고번호에 차수(bidNtceOrd)가 여러 개 쌓인다. 정정·재공고·취소가
-- 모두 새 차수로 올라오기 때문이다. 목록에 차수를 전부 보여주면 같은 공고가
-- 여러 줄로 뜨고, 더 나쁘게는 이미 취소된 차수가 살아 있는 것처럼 보인다.
-- (실제로 '팔만대장경 DB구축' 공고가 등록·취소·재공고 3줄로 떴다)
--
-- 이력은 bids에 그대로 남기고, 화면은 공고번호별 최신 차수만 본다.
create or replace view public.bids_current as
select distinct on (bid_no) *
from public.bids
order by
  bid_no,
  -- 차수는 '00'/'000'처럼 자리수가 섞여 오므로 숫자로 비교한다
  coalesce(nullif(regexp_replace(bid_ord, '\D', '', 'g'), ''), '0')::int desc;
