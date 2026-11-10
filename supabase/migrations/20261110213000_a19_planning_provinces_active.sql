-- A19 follow-up: the province chooser offers the four provinces Jaga serves, not all 77.
--
-- Found by reading the live answer rather than the code: `my_planning_provinces()` as written in
-- 20261110180100 asked only "is_admin() or planning_covers_province()", and `provinces` holds
-- every province in Thailand - the other 73 are there on purpose, so that a visitor tapping one
-- is told Jaga does not cover it yet instead of being shown nothing (safety rule 10). So an admin
-- opening /authority/highway-paths was offered a chooser of 77 buttons, 73 of which lead to an
-- empty page.
--
-- `status = 'active'` is exactly the four (90, 94, 95, 96). An office is unaffected either way -
-- its coverage can only be in a province Jaga serves - so this changes nothing about who may read
-- what; it is the difference between a usable chooser and an unusable one.
--
-- Written as a separate migration rather than an edit because 20261110180100 is applied.

create or replace function public.my_planning_provinces()
returns table (province_code text, name_th text, name_en text)
language sql stable security definer set search_path = '' as $fn$
  select p.code, p.name_th, p.name_en
    from public.provinces p
   where p.status = 'active'
     and (public.is_admin() or public.planning_covers_province(p.code))
   order by p.code
$fn$;

comment on function public.my_planning_provinces() is
  'The provinces this account may open the highway-paths page for: the four Jaga serves, filtered '
  'to the ones a planning office covers (all four for an admin). A19, 10 Nov 2026.';
