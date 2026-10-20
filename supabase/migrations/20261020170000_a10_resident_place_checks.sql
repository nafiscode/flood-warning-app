-- A10: a resident can say what a safe place is like, from the place's own point on the map
-- (owner, 20 Oct: "from each safe place point on map also can be the good place where the normal
-- users can verify the places"). This is the second half of the place-checks decision of the same
-- day, brought forward from after launch because the map pin is where people already look.
--
-- THE RULE THIS FILE EXISTS TO ENFORCE: a resident's check never changes the place's status.
-- `place_check_resident` writes a row in `place_checks` and touches `safe_places` not at all,
-- so the badge on a card can only ever be moved by an admin or by a team covering that place.
-- A false "closed" turns people away from a dry shelter and a false "open" sends somebody into
-- a flooded one, so neither direction may apply itself. What residents say is shown instead as
-- its own attributed line, and it reaches the teams' round list, which is where somebody who
-- can act will see it.
--
-- Signed in only (the owner's choice of 20 Oct): a check is not a cry for help, so the argument
-- for no door at all - which is why an SOS has none - does not apply here.

-------------------------------------------------------------------------------
-- 1. Sending one
-------------------------------------------------------------------------------
create function public.place_check_resident(
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
  recent integer;
begin
  if uid is null then
    raise exception 'Sign in to check a place' using errcode = 'insufficient_privilege';
  end if;
  select sp.* into v_place from public.safe_places sp where sp.id = p_place;
  if not found or v_place.verification_status = 'rejected' then
    raise exception 'No such safe place' using errcode = 'no_data_found';
  end if;
  if p_open is null or p_open = 'unknown' then
    raise exception 'A check has to say whether the place is open'
      using errcode = 'check_violation';
  end if;
  -- Unlike an SOS, a check may be refused: refusing one costs nobody their life. Two limits,
  -- because they stop different things - somebody working through the whole map, and somebody
  -- saying the same thing about one place over and over to make it look like many people.
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
  -- Deliberately no update of public.safe_places. See the note at the top of this file.
  perform public.log_access('place_checked', 'safe_places', p_place::text, jsonb_build_object(
    'check', v_id, 'source', 'resident', 'said', p_open,
    'water', p_water, 'road', p_road,
    'distance_m', case when v_distance is null then null else round(v_distance) end));
  return v_id;
end $$;
revoke execute on function public.place_check_resident(uuid, public.safe_place_status,
  public.place_water, public.road_access, text, double precision, double precision)
  from public, anon;
grant execute on function public.place_check_resident(uuid, public.safe_place_status,
  public.place_water, public.road_access, text, double precision, double precision)
  to authenticated;

-------------------------------------------------------------------------------
-- 2. What residents have said, as a count and nothing else
-------------------------------------------------------------------------------

-- How long a resident's answer is worth showing. Shorter than an official check's window,
-- because this is a crowd reading a situation, not a team's record: twelve hours at most, and
-- the place's own window whenever that is shorter (6 h under a warning, 2 h under an evacuate).
create function public.resident_say_window(p_level public.alert_level)
returns interval
language sql immutable set search_path = '' as $$
  select least(interval '12 hours', public.place_check_window(p_level))
$$;
grant execute on function public.resident_say_window(public.alert_level) to anon, authenticated;

-- Counts of DISTINCT people, never rows, so one person repeating themselves counts once. No
-- identity, no position, no free text: what the public may see about a report is a count
-- (safety rule 6), and the same holds here.
--
-- `disputed` is true when at least two different people say something other than what the card
-- says. One person is shown ("1 person said...") but never called a dispute: two independent
-- accounts is the smallest number that is not one person having a bad day.
create function public.residents_said(sp public.safe_places)
returns jsonb
language sql stable set search_path = '' as $$
  with said as (
    select c.open_state, count(distinct c.author_id) as people
      from public.place_checks c
     where c.place_id = sp.id
       and c.source = 'resident'
       and c.open_state is not null
       and c.created_at > now() - public.resident_say_window(public.tambon_level(sp.tambon))
     group by c.open_state
  ), latest as (
    select max(c.created_at) as at
      from public.place_checks c
     where c.place_id = sp.id and c.source = 'resident'
       and c.created_at > now() - public.resident_say_window(public.tambon_level(sp.tambon))
  )
  select case when not exists (select 1 from said) then null else jsonb_build_object(
    'counts', (select jsonb_object_agg(open_state, people) from said),
    'people', (select sum(people) from said),
    'latest', (select at from latest),
    'disputed', coalesce((select sum(people) from said where open_state <> sp.status) >= 2, false)
  ) end
$$;
grant execute on function public.residents_said(public.safe_places) to anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The card and the teams' round list carry it
-------------------------------------------------------------------------------
-- Output columns change, so the function is dropped and written again.
drop function public.safe_places_near(double precision, double precision, integer, boolean,
                                      public.hazard_type);
create function public.safe_places_near(
  p_lat double precision,
  p_lon double precision,
  p_limit integer default 3,
  p_parking boolean default false,
  p_hazard public.hazard_type default 'flood'
) returns table (
  id uuid, name jsonb, type public.safe_place_type, status public.safe_place_status,
  verification_status public.verification_status, distance_m double precision,
  lat double precision, lon double precision, freeboard_m real,
  flooded_2024 boolean, flooded_2025 boolean, capacity integer, facilities jsonb, needs text,
  updated_at timestamptz,
  checked_at timestamptz, checked_source public.place_check_source, check_due_at timestamptz,
  -- Counts of people only, never who they are.
  residents_said jsonb
)
language sql stable set search_path = '' as $$
  select sp.id, sp.name, sp.type, sp.status, sp.verification_status, r.distance_m,
         extensions.st_y(sp.point), extensions.st_x(sp.point), sp.freeboard_m,
         sp.flooded_2024, sp.flooded_2025, sp.capacity, sp.facilities, sp.needs, sp.updated_at,
         sp.checked_at, sp.checked_source,
         sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon, p_hazard)),
         public.residents_said(sp)
  from public.rank_safe_places(extensions.st_makepoint(p_lon, p_lat), p_limit, p_hazard, p_parking) r
  join public.safe_places sp on sp.id = r.id
  order by r.rank_score desc, r.distance_m
$$;
grant execute on function public.safe_places_near(double precision, double precision, integer,
  boolean, public.hazard_type) to anon, authenticated;

-- The teams' round list is where a resident's answer reaches somebody who can act on it: a
-- place residents are disputing rises to the top, above even one nobody has been to.
drop function public.authority_places();
create function public.authority_places()
returns table (
  place_id uuid, name jsonb, type public.safe_place_type, tambon text,
  tambon_th text, tambon_en text,
  lat double precision, lon double precision,
  status public.safe_place_status, verification_status public.verification_status,
  capacity integer, needs text,
  checked_at timestamptz, checked_source public.place_check_source, check_due_at timestamptz,
  level public.alert_level, mine boolean, residents_said jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Only a verified team or an admin can see the round list'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select sp.id, sp.name, sp.type, sp.tambon, t.name_th, t.name_en,
         extensions.st_y(sp.point), extensions.st_x(sp.point),
         sp.status, sp.verification_status, sp.capacity, sp.needs,
         sp.checked_at, sp.checked_source,
         sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon)),
         public.tambon_level(sp.tambon),
         exists (select 1 from public.authority_units u
                  where u.id = sp.checked_by_unit and u.user_id = (select auth.uid())),
         public.residents_said(sp)
    from public.safe_places sp
    left join public.tambons t on t.code = sp.tambon
   where sp.verification_status <> 'rejected'
     and sp.tambon is not null
     and (public.is_admin() or public.covers_tambon(sp.tambon))
   order by coalesce((public.residents_said(sp) ->> 'disputed')::boolean, false) desc,
            (sp.checked_at is not null),
            sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon)),
            sp.id;
end $$;
revoke execute on function public.authority_places() from public, anon;
grant execute on function public.authority_places() to authenticated;

-------------------------------------------------------------------------------
-- 4. The limits, so an admin can change them without a release
-------------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('place_check_limit', jsonb_build_object('per_user_hour', 10, 'per_place_half_hour', 1))
on conflict (key) do nothing;
