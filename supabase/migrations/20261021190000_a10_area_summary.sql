-- A10 (search): the province summary becomes an *area* summary, so a district can have a page too.
--
-- The owner's note, 21 Oct: people search "น้ำท่วมหาดใหญ่". Hat Yai is a district of Songkhla, which
-- Jaga covers, and it is searched far more than Songkhla itself - it is the city of the south and
-- its floods have their own history. A province page cannot answer that search, because the words
-- "หาดใหญ่" appear nowhere on it.
--
-- So `province_public_summary(p_province)` is replaced by `area_public_summary(p_code)`, which takes
-- either a 2-digit province code or a 4-digit district code and answers the same shape. The joins
-- change with the length and nothing else does:
--
--   * the gauges standing inside that area, by its own outline rather than the province's;
--   * how many safe places it has, counted on the leading digits of the tambon code;
--   * how many tambons it has - moved in here from a separate query, because the column to filter
--     on differs between the two (province_code or district_code) and the caller should not care;
--   * for a district only, its tambons by name. A district has five to fifteen, so they fit on a
--     page and are the most useful thing on it: somebody looking for Hat Yai is usually looking for
--     one part of Hat Yai. A province has over a hundred and the list would be noise.
--
-- Still `security invoker`, for the reason the last migration gives: everything read here is
-- readable by anon in its own right, and running as the caller is what keeps the safe-place count
-- equal to the public map's rather than equal to a promise in a comment.

create function public.area_public_summary(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with area as (
    -- One row, the outline to test gauges against: a province for a 2-digit code, a district for 4.
    select pr.geom from public.provinces pr where length(p_code) = 2 and pr.code = p_code
    union all
    select di.geom from public.districts di where length(p_code) = 4 and di.code = p_code
  )
  select jsonb_build_object(
    'code', p_code,
    'generatedAt', now(),
    'tambons', (
      select count(*) from public.tambons t where left(t.code, length(p_code)) = p_code
    ),
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
        join area a on extensions.st_contains(a.geom, s.point)
      ),
      '[]'::jsonb
    ),
    -- A district's own tambons, by name. Null for a province, so the page knows not to draw a list.
    'tambonList', case when length(p_code) = 4 then coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('code', t.code, 'nameTh', t.name_th, 'nameEn', t.name_en)
                 order by t.code
               )
        from public.tambons t where t.district_code = p_code
      ),
      '[]'::jsonb
    ) end,
    'places', jsonb_build_object(
      'total', (
        select count(*)
        from public.safe_places sp
        where sp.tambon is not null and left(sp.tambon, length(p_code)) = p_code
      ),
      'verified', (
        select count(*)
        from public.safe_places sp
        where sp.tambon is not null and left(sp.tambon, length(p_code)) = p_code
          and sp.verification_status = 'verified'
      )
    )
  )
$$;

comment on function public.area_public_summary(text) is
  'Aggregate public picture of one covered province (2-digit DOPA code) or district (4-digit) for '
  'its /flood/<place> page: the river gauges standing in it, how many tambons and safe places it '
  'has, and for a district its tambons by name. Counted under the caller''s own row-level security '
  'so the figures match the public map. No personal data, and nothing here can publish an alert.';

grant execute on function public.area_public_summary(text) to anon, authenticated;

-- Superseded by the above, two migrations after it was added and before anything shipped using it.
drop function if exists public.province_public_summary(text);
