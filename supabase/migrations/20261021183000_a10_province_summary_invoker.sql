-- A10 (search): the province summary drops `security definer`, and counts what the map counts.
--
-- Correcting 20261021180000_a10_province_summary.sql, written half an hour earlier. Two mistakes,
-- both found by calling the function as `anon` instead of trusting the comment above it.
--
-- 1. Its header said `safe_places` rows are covered data readable only by admins and authorities
--    in coverage. They are not. The policy is "safe_places: everyone reads unless rejected"
--    (20260929120600_access_rules.sql) and that is deliberate: a shelter people are meant to walk
--    to is not a secret, and the home screen hands anybody the nearest three. Safety rule 5's
--    covered data is SOS requesters, households, reporters and phone numbers - not shelters.
--
-- 2. Because of that wrong belief the function was `security definer`, which it never needed - and
--    `security definer` bypasses row-level security, so the count included safe places an admin
--    had **rejected**. The public map excludes those. The two would have disagreed, and the page
--    meant to be found by somebody looking for a shelter would have been the one overcounting.
--    (Not visible today: jaga-dev has no rejected rows, so both read 2,566. It would have appeared
--    the first time a place was rejected, which is exactly the kind of fault that waits.)
--
-- So: `security invoker` - the default, and all this ever needed. `provinces`, `stations` and
-- `safe_places` are each readable by anon under their own policies, and `station_status()` is
-- granted to anon, so the function runs on the caller's own rights and the caller's own row-level
-- security. Least privilege, and the count now matches the map by construction rather than by
-- a promise in a comment.
--
-- While here, `open` becomes `verified`. A safe place's `status` defaults to 'unknown' and is set
-- by a team checking in on it, so "open" reads 0 in all four provinces today and would have put a
-- bare zero on a public page - which breaks safety rule 10 the same way an all-clear does: it
-- says "no shelters are open" when the truth is "nobody has checked yet".

create or replace function public.province_public_summary(p_province text)
returns jsonb
language sql
stable
-- Deliberately security INVOKER (the default): see the header. Everything read here is readable
-- by anon in its own right, and running as the caller is what keeps the safe-place count equal to
-- what the public map shows.
security invoker
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
      'verified', (
        select count(*)
        from public.safe_places sp
        where sp.tambon is not null and left(sp.tambon, 2) = p_province
          and sp.verification_status = 'verified'
      )
    )
  )
$$;

comment on function public.province_public_summary(text) is
  'Aggregate public picture of one covered province for its /flood/<province> page: the river '
  'gauges standing in it (as station_status() already shows them) and how many safe places it '
  'has, counted under the caller''s own row-level security so the figure matches the public map. '
  'No personal data, and nothing here can publish or raise an alert.';

grant execute on function public.province_public_summary(text) to anon, authenticated;
