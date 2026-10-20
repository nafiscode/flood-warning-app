-- A10: place checks (owner, 20 Oct 2026). Thin slice: a verified team or an admin can say that a
-- safe place is still as listed, and every card says when it was last checked and by whom.
--
-- Until now one admin wrote a safe place's whole truth, so the record was as fresh as the last
-- time they touched it. Two facts were flattened into the one word "verified": whether the
-- record is true (structural, keeps for a season) and whether the place is good right now
-- (open, full, water inside, perishes in hours). They are kept apart here.
--
-- A check never computes or publishes an alert and never notifies a resident (safety rule 2).
-- The point it was sent from and its author are personal data, read under RLS (rule 5).

-------------------------------------------------------------------------------
-- 1. What a check is
-------------------------------------------------------------------------------

-- Who is speaking. 'resident' is written by the later phase; the standing is stored on the row
-- so a person's role changing afterwards cannot rewrite what a past check was worth.
create type public.place_check_source as enum ('admin', 'team', 'resident');

-- Where the water is, seen from the doorway: nothing, around the building, inside it.
create type public.place_water as enum ('dry', 'around', 'inside');

-- Append-only: a row is never updated or deleted. Three people saying "full" at 14:00 is itself
-- the evidence, and the history is the audit trail.
create table public.place_checks (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.safe_places (id) on delete cascade,
  source public.place_check_source not null,
  author_id uuid references public.profiles (user_id) on delete set null,
  unit_id uuid references public.authority_units (id) on delete set null,
  -- What the place was like. Null means "did not say", never "no".
  open_state public.safe_place_status,
  water public.place_water,
  road public.road_access,
  needs text check (char_length(needs) <= 500),
  -- Where the sender was, and how far that is from the place: standing in the car park is a
  -- different fact from hearing it from somebody. Personal data (safety rule 5).
  point extensions.geometry(Point, 4326),
  distance_m real,
  created_at timestamptz not null default now()
);
create index place_checks_place_time_idx on public.place_checks (place_id, created_at desc);
create index place_checks_author_idx on public.place_checks (author_id, created_at desc);

-- The latest check only. The history stays in place_checks; these three columns are what a card
-- reads. `checked_at` is deliberately not `updated_at`: renaming a place is not checking it.
alter table public.safe_places
  add column checked_at timestamptz,
  add column checked_source public.place_check_source,
  add column checked_by_unit uuid references public.authority_units (id) on delete set null;

-------------------------------------------------------------------------------
-- 2. How long a check stays good
-------------------------------------------------------------------------------

-- Tightens with the level in force where the place is. Past the window a card keeps its status
-- and gains a grey "not checked since" marker: stale is a marker, never a downgrade and never
-- hidden (safety rule 3 says the same about an alert).
create function public.place_check_window(p_level public.alert_level)
returns interval
language sql immutable set search_path = '' as $$
  select case p_level
           when 'evacuate' then interval '2 hours'
           when 'warning' then interval '6 hours'
           when 'watch' then interval '24 hours'
           else interval '7 days'
         end
$$;
grant execute on function public.place_check_window(public.alert_level) to anon, authenticated;

-- The level in force in a tambon right now, or 'normal' when no alert covers it. Reads only
-- published alerts, so it can say nothing a resident cannot already see.
create function public.tambon_level(p_tambon text, p_hazard public.hazard_type default 'flood')
returns public.alert_level
language sql stable set search_path = '' as $$
  select coalesce(
    (select a.level
       from public.alerts a
       join public.alert_tambons at on at.alert_id = a.id
      where at.tambon = p_tambon
        and a.hazard_type = p_hazard
        and a.superseded_by is null
        and a.cancelled_at is null
      order by a.issued_at desc
      limit 1),
    'normal'::public.alert_level)
$$;
grant execute on function public.tambon_level(text, public.hazard_type) to anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The public card learns when the place was last checked
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
  -- When the condition was last confirmed, by whom, and when it goes stale. Never by whom by name.
  checked_at timestamptz, checked_source public.place_check_source, check_due_at timestamptz
)
language sql stable set search_path = '' as $$
  select sp.id, sp.name, sp.type, sp.status, sp.verification_status, r.distance_m,
         extensions.st_y(sp.point), extensions.st_x(sp.point), sp.freeboard_m,
         sp.flooded_2024, sp.flooded_2025, sp.capacity, sp.facilities, sp.needs, sp.updated_at,
         sp.checked_at, sp.checked_source,
         sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon, p_hazard))
  from public.rank_safe_places(extensions.st_makepoint(p_lon, p_lat), p_limit, p_hazard, p_parking) r
  join public.safe_places sp on sp.id = r.id
  order by r.rank_score desc, r.distance_m
$$;
grant execute on function public.safe_places_near(double precision, double precision, integer,
  boolean, public.hazard_type) to anon, authenticated;

-------------------------------------------------------------------------------
-- 4. Reading checks
-------------------------------------------------------------------------------
alter table public.place_checks enable row level security;

-- The author reads their own. Admins read everything. A verified team reads the checks on the
-- places it covers, which is what its round list is. Nobody else reads a row: the public gets
-- only what safe_places_near carries, and never who checked (safety rules 5 and 6).
create policy "place_checks: author reads own" on public.place_checks for select to authenticated
  using (author_id = (select auth.uid()));
create policy "place_checks: admins read" on public.place_checks for select to authenticated
  using (public.is_admin());
create policy "place_checks: teams read their coverage" on public.place_checks
  for select to authenticated
  using (exists (select 1 from public.safe_places sp
                  where sp.id = place_id and sp.tambon is not null
                    and public.covers_tambon(sp.tambon)));

-- Writing goes only through place_check_send below, so a row can never claim a standing its
-- author does not have, and the place's own columns can never drift from the check.
revoke insert, update, delete on public.place_checks from authenticated, anon;

-------------------------------------------------------------------------------
-- 5. The round list: the places a team covers, the ones longest unchecked first
-------------------------------------------------------------------------------
create function public.authority_places()
returns table (
  place_id uuid, name jsonb, type public.safe_place_type, tambon text,
  tambon_th text, tambon_en text,
  lat double precision, lon double precision,
  status public.safe_place_status, verification_status public.verification_status,
  capacity integer, needs text,
  checked_at timestamptz, checked_source public.place_check_source, check_due_at timestamptz,
  level public.alert_level, mine boolean
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
         -- Was the last check this team's own? The list is a round, so it helps to see which
         -- ones somebody else has already walked.
         exists (select 1 from public.authority_units u
                  where u.id = sp.checked_by_unit and u.user_id = (select auth.uid()))
    from public.safe_places sp
    left join public.tambons t on t.code = sp.tambon
   where sp.verification_status <> 'rejected'
     and sp.tambon is not null
     and (public.is_admin() or public.covers_tambon(sp.tambon))
   -- Never checked first, then the longest overdue. A place in a tambon under a warning rises
   -- because its window is shorter, not because it is ranked specially.
   order by (sp.checked_at is not null),
            sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon)),
            sp.id;
end $$;
revoke execute on function public.authority_places() from public, anon;
grant execute on function public.authority_places() to authenticated;

-------------------------------------------------------------------------------
-- 6. Sending a check
-------------------------------------------------------------------------------
-- A team covering the place, or an admin. What they say about the condition is written onto the
-- place; the record (name, capacity, what it is suitable for) is not touched here - correcting
-- the record stays an admin's job through admin_safe_place_update, and a team's correction
-- becomes a suggestion in the later phase.
create function public.place_check_send(
  p_place uuid,
  p_open public.safe_place_status,
  p_water public.place_water default null,
  p_road public.road_access default null,
  p_needs text default null,
  -- Where the sender was. Optional: a team radioing in from the next tambon is still worth more
  -- than silence, and the distance says plainly how close they were.
  p_lat double precision default null,
  p_lon double precision default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_place public.safe_places;
  v_admin boolean := public.is_admin();
  v_source public.place_check_source;
  v_unit uuid;
  v_point extensions.geometry;
  v_distance real;
  v_needs text := nullif(left(btrim(coalesce(p_needs, '')), 500), '');
  v_id uuid;
begin
  select sp.* into v_place from public.safe_places sp where sp.id = p_place for update;
  if not found then
    raise exception 'No such safe place' using errcode = 'no_data_found';
  end if;
  if v_admin then
    v_source := 'admin';
  else
    select u.id into v_unit
      from public.authority_units u
      join public.authority_coverage c on c.unit_id = u.id
     where u.user_id = (select auth.uid()) and u.status = 'verified'
       and c.tambon = v_place.tambon
     limit 1;
    if v_unit is null then
      raise exception 'Only a team covering this place, or an admin, can check it'
        using errcode = 'insufficient_privilege';
    end if;
    v_source := 'team';
  end if;
  if p_open is null then
    raise exception 'A check has to say whether the place is open'
      using errcode = 'check_violation';
  end if;
  if p_lat is not null and p_lon is not null
     and p_lat between -90 and 90 and p_lon between -180 and 180 then
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
    v_distance := extensions.st_distance(v_point::extensions.geography,
                                         v_place.point::extensions.geography);
  end if;
  insert into public.place_checks (place_id, source, author_id, unit_id, open_state, water,
                                   road, needs, point, distance_m)
  values (p_place, v_source, (select auth.uid()), v_unit, p_open, p_water, p_road, v_needs,
          v_point, v_distance)
  returning id into v_id;
  -- The place carries only the latest check. `needs` is left alone when the check says nothing
  -- about it, so a two-tap confirm never wipes a note an admin wrote.
  update public.safe_places
     set status = p_open,
         needs = coalesce(v_needs, needs),
         checked_at = now(),
         checked_source = v_source,
         checked_by_unit = v_unit,
         updated_at = now()
   where id = p_place;
  perform public.log_access('place_checked', 'safe_places', p_place::text, jsonb_build_object(
    'check', v_id, 'source', v_source, 'unit', v_unit,
    'status', jsonb_build_array(v_place.status, p_open),
    'water', p_water, 'road', p_road,
    'distance_m', case when v_distance is null then null else round(v_distance) end));
  return v_id;
end $$;
revoke execute on function public.place_check_send(uuid, public.safe_place_status,
  public.place_water, public.road_access, text, double precision, double precision)
  from public, anon;
grant execute on function public.place_check_send(uuid, public.safe_place_status,
  public.place_water, public.road_access, text, double precision, double precision)
  to authenticated;
