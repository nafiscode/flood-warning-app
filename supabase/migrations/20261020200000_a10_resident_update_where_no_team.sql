-- A10: where no team covers the tambon, a resident's check writes the status itself
-- (owner, 20 Oct: "keep it to go to the team that covers the area, if no team then should
-- directly update, no check").
--
-- This SUPERSEDES, for unteamed tambons only, the rule set earlier the same day that a
-- resident's check can never move the status. The owner's reason is the right one: a dispute
-- that reaches nobody is wasted, and the card would stay wrong for the whole season. Where a
-- verified team does cover the tambon nothing changes - the check tells people, and the place
-- rises to the top of that team's round.
--
-- Two things make this honest rather than merely automatic.
--
-- 1. The card never pretends Jaga or a team said it. `checked_source` is written as 'resident',
--    so the line reads "Reported by someone there at 14:20" (places.checkedBy.resident) and a
--    reader can weigh it. A later team or admin check overwrites both the status and the source.
--
-- 2. A resident's "closed" does not delete the place from the list. `rank_safe_places` drops
--    every closed place, so without this change one person could take the only shelter in an
--    unteamed tambon out of the top three entirely, with no team to put it back. A place closed
--    by a resident therefore stays in the ranking, carrying its status and who said it; a place
--    closed by an admin or a team is still dropped, as before.

-------------------------------------------------------------------------------
-- 1. Is anybody covering this tambon?
-------------------------------------------------------------------------------
-- Only a verified unit counts: a pending or suspended one cannot act on what it is told.
create function public.has_covering_team(p_tambon text)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.authority_coverage c
      join public.authority_units u on u.id = c.unit_id
     where c.tambon = p_tambon and u.status = 'verified'
  )
$$;
grant execute on function public.has_covering_team(text) to authenticated;

-------------------------------------------------------------------------------
-- 2. The resident's check, which now sometimes writes the status
-------------------------------------------------------------------------------
create or replace function public.place_check_resident(
  p_place uuid,
  p_open public.safe_place_status,
  p_water public.place_water default null,
  p_road public.road_access default null,
  p_note text default null,
  p_lat double precision default null,
  p_lon double precision default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_place public.safe_places;
  v_point extensions.geometry;
  v_distance real;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_id uuid;
  v_alone boolean;
  recent integer;
begin
  if uid is null then
    raise exception 'Sign in to check a place' using errcode = 'insufficient_privilege';
  end if;
  select sp.* into v_place from public.safe_places sp where sp.id = p_place for update;
  if not found or v_place.verification_status = 'rejected' then
    raise exception 'No such safe place' using errcode = 'no_data_found';
  end if;
  if p_open is null or p_open = 'unknown' then
    raise exception 'A check has to say whether the place is open'
      using errcode = 'check_violation';
  end if;
  select count(*) into recent from public.place_checks c
   where c.author_id = uid and c.source = 'resident'
     and c.created_at > now() - interval '1 hour';
  if recent >= public.setting_int('place_check_limit', 'per_user_hour', 10) then
    raise exception 'Too many checks in the last hour' using errcode = 'too_many_rows';
  end if;
  select count(*) into recent from public.place_checks c
   where c.author_id = uid and c.source = 'resident' and c.place_id = p_place
     and c.created_at > now() - interval '30 minutes';
  if recent >= public.setting_int('place_check_limit', 'per_place_half_hour', 1) then
    raise exception 'You have just checked this place' using errcode = 'too_many_rows';
  end if;
  if p_lat is not null and p_lon is not null
     and p_lat between -90 and 90 and p_lon between -180 and 180 then
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
    v_distance := extensions.st_distance(v_point::extensions.geography,
                                         v_place.point::extensions.geography);
  end if;
  insert into public.place_checks (place_id, source, author_id, open_state, water, road, needs,
                                   point, distance_m)
  values (p_place, 'resident', uid, p_open, p_water, p_road, v_note, v_point, v_distance)
  returning id into v_id;

  -- Nobody is coming to confirm it, so what the person standing there says becomes the status.
  -- A tambon the app does not place at all (tambon is null) counts as having nobody.
  v_alone := v_place.tambon is null or not public.has_covering_team(v_place.tambon);
  if v_alone then
    update public.safe_places
       set status = p_open,
           needs = coalesce(v_note, needs),
           checked_at = now(),
           checked_source = 'resident',
           checked_by_unit = null,
           updated_at = now()
     where id = p_place;
    perform public.log_access('place_status_by_resident', 'safe_places', p_place::text,
      jsonb_build_object('check', v_id, 'tambon', v_place.tambon,
                         'status', jsonb_build_array(v_place.status, p_open)));
  end if;

  perform public.log_access('place_checked', 'safe_places', p_place::text, jsonb_build_object(
    'check', v_id, 'source', 'resident', 'said', p_open, 'wrote_status', v_alone,
    'water', p_water, 'road', p_road,
    'distance_m', case when v_distance is null then null else round(v_distance) end));
  return v_id;
end $$;

-------------------------------------------------------------------------------
-- 3. A resident's "closed" must not erase the place from the list
-------------------------------------------------------------------------------
-- Same weights and same output as before; only the "closed" test changes. See the note at the
-- top: one person must not be able to take the only shelter in an unteamed tambon off the
-- top-three list, with nobody to put it back.
drop function public.rank_safe_places(extensions.geometry, integer, public.hazard_type, boolean);
create function public.rank_safe_places(
  p_point extensions.geometry,
  p_limit integer default 3,
  p_hazard public.hazard_type default 'flood',
  -- null: every kind; true: only high ground for parking cars; false: only places for people
  p_parking boolean default null
) returns table (
  id uuid, name jsonb, type public.safe_place_type, status public.safe_place_status,
  distance_m double precision, score real, rank_score double precision
)
language sql stable set search_path = '' as $$
  with candidates as (
    select sp.id, sp.name, sp.type, sp.status, sp.score,
           extensions.st_distance(sp.point::extensions.geography,
                                  extensions.st_setsrid(p_point, 4326)::extensions.geography) as distance_m
    from public.safe_places sp
    where not (sp.status = 'closed' and sp.checked_source is distinct from 'resident')
      and sp.verification_status <> 'rejected'
      and p_hazard = any (sp.suitable_for)
      and (p_parking is null or (sp.type = 'high_ground_parking') = p_parking)
      and extensions.st_dwithin(sp.point::extensions.geography,
                                extensions.st_setsrid(p_point, 4326)::extensions.geography, 50000)
  )
  select c.id, c.name, c.type, c.status, c.distance_m, c.score,
         0.5 * coalesce(c.score, 0) + 0.5 * greatest(0, 1 - c.distance_m / 20000.0) as rank_score
  from candidates c
  order by rank_score desc, c.distance_m
  limit greatest(1, least(p_limit, 20))
$$;
grant execute on function public.rank_safe_places(extensions.geometry, integer,
  public.hazard_type, boolean) to anon, authenticated;
