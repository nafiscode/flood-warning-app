-- A10 (search): what one covered province looks like right now, for its own public page.
--
-- Four pages at /flood/<province> exist so that somebody searching "น้ำท่วม ปัตตานี" can find
-- Jaga at all. Until now a crawler saw one map page with no province in its text, and the map is
-- drawn in the browser, so there was nothing about Pattani on any page a search engine could read.
--
-- Two things on such a page cannot be assembled from the tables a visitor may already read:
--
-- 1. Which river gauges stand in this province. `stations` is public and so is `station_status()`,
--    but a station carries a point, not a province code, so placing it needs a spatial join -
--    which PostgREST cannot express and which must not be done by sending every tambon outline to
--    a phone.
-- 2. How many safe places the province has. `safe_places` rows are covered data: the exact point
--    of a shelter and who recorded it are readable only by admins and by authorities covering that
--    tambon (safety rule 5). A count is not - it is exactly the kind of aggregate the public map
--    has always been allowed to show (safety rule 6) - but counting needs a row read.
--
-- So one function, returning only an aggregate and only what was already public per gauge. It adds
-- no number that a person could not read off the map today; it adds the province it belongs to.
--
-- It cannot raise or publish anything (safety rule 2): it is `stable` and reads, and a gauge
-- reading here is a measurement with no level attached, exactly as the map shows it.

create function public.province_public_summary(p_province text)
returns jsonb
language sql
stable
-- `safe_places` is behind row-level security and must stay there: nothing but the two counts
-- below leaves this function, no point, no name and no recorder. The gauges come from
-- `station_status()`, which is already granted to anon and already hides the gauge levels.
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'province', p_province,
    'generatedAt', now(),
    'gauges', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', st.code,
                   'name', st.name,
                   'basin', st.basin,
                   'status', st.status,
                   'value', st.value,
                   'observedAt', st.observed_at,
                   'rise3h', st.rise_3h,
                   'bank', st.bank_m
                 )
                 order by st.code
               )
        from public.station_status() st
        join public.stations s on s.id = st.id
        join public.provinces pr
          on pr.code = p_province and extensions.st_contains(pr.geom, s.point)
      ),
      '[]'::jsonb
    ),
    'places', jsonb_build_object(
      'total', (
        select count(*)
        from public.safe_places sp
        where sp.tambon is not null and left(sp.tambon, 2) = p_province
      ),
      'open', (
        select count(*)
        from public.safe_places sp
        where sp.tambon is not null and left(sp.tambon, 2) = p_province
          and sp.status = 'open'
      )
    )
  )
$$;

comment on function public.province_public_summary(text) is
  'Aggregate public picture of one covered province for its /flood/<province> page: the river '
  'gauges standing in it (as station_status() already shows them) and how many safe places it '
  'has. No exact location, no personal data, nothing that can publish an alert.';

grant execute on function public.province_public_summary(text) to anon, authenticated;
