-- GNB를 일반 뉴스 카테고리로 개편하면서 카테고리 ID 체계가 바뀌었다.
-- 기존에 수집된 기사들은 옛 ID(debt-collection 등)로 저장돼 있어 새 ID와
-- 매칭되지 않으므로, 한 번에 새 ID로 재매핑한다.
--   debt-collection(채권추심)      -> finance
--   credit-investigation(신용조사) -> finance
--   kbci(KB)                        -> finance
--   e-document(전자문서)           -> industry
--   finance-law(법령)              -> law
--   labor-law(노동)                -> law
update public.articles a
set categories = sub.new_cats
from (
  select
    a2.id,
    array_agg(distinct nc) as new_cats
  from public.articles a2,
       lateral unnest(a2.categories) as oc,
       lateral (
         select case oc
           when 'debt-collection' then 'finance'
           when 'credit-investigation' then 'finance'
           when 'kbci' then 'finance'
           when 'e-document' then 'industry'
           when 'finance-law' then 'law'
           when 'labor-law' then 'law'
           else oc
         end
       ) as t(nc)
  group by a2.id
) sub
where a.id = sub.id
  and a.categories <> sub.new_cats;
