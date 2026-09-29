-- A1 (8/8): geography and SOS helpers, and the logged reveal functions (safety rule 5).

-------------------------------------------------------------------------------
-- Geography
-------------------------------------------------------------------------------
-- The tambon containing a point, or null outside the covered provinces.
create function public.tambon_for_point(p_point extensions.geometry) returns text
language sql stable set search_path = '' as $$
  select t.code from public.tambons t
  where extensions.st_intersects(t.geom, extensions.st_setsrid(p_point, 4326))
  order by t.code
  limit 1
$$;

-- All tambon codes under a province, district or tambon selection (authority coverage).
create function public.expand_coverage(p_level public.admin_level, p_code text) returns setof text
language sql stable set search_path = '' as $$
  select t.code from public.tambons t
  where case p_level
          when 'province' then t.province_code = p_code
          when 'district' then t.district_code = p_code
          else t.code = p_code
        end
  order by t.code
$$;

-- Top safe places from a point: for now the stored pipeline score plus distance (spec 4.3).
-- rank_score = 0.5 × score + 0.5 × closeness (1 at the point, 0 at 20 km or more).
-- Closed or rejected places and places not suitable for the hazard are left out.
create function public.rank_safe_places(
  p_point extensions.geometry,
  p_limit integer default 3,
  p_hazard public.hazard_type default 'flood'
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
    where sp.status <> 'closed'
      and sp.verification_status <> 'rejected'
      and p_hazard = any (sp.suitable_for)
      and extensions.st_dwithin(sp.point::extensions.geography,
                                extensions.st_setsrid(p_point, 4326)::extensions.geography, 50000)
  )
  select c.id, c.name, c.type, c.status, c.distance_m, c.score,
         0.5 * coalesce(c.score, 0) + 0.5 * greatest(0, 1 - c.distance_m / 20000.0) as rank_score
  from candidates c
  order by rank_score desc, c.distance_m
  limit greatest(1, least(p_limit, 20))
$$;

-------------------------------------------------------------------------------
-- SOS
-------------------------------------------------------------------------------
-- Priority from vulnerable flags, water depth, number of people and time waiting (spec 4.6).
-- Weights are a first guess, to tune with responders; the score only orders the case board.
create function public.sos_priority(p_sos_id uuid) returns real
language sql stable set search_path = '' as $$
  select (
      least(10, 2 * (select count(*) from jsonb_each(s.vulnerable_flags) f where f.value = 'true'::jsonb))
    + case s.depth_ref
        when 'ankle' then 1 when 'knee' then 2 when 'waist' then 4 when 'chest' then 6
        when 'above_head' then 8 when 'roof' then 10 else 0 end
    + least(10, 0.5 * coalesce(s.people_count, 1))
    + least(12, extract(epoch from (now() - s.created_at)) / 600.0)
  )::real
  from public.sos_requests s
  where s.id = p_sos_id
$$;

-- Flag a possible duplicate: another open case with the same phone, or within 300 m and 2 hours.
-- Only flags it for admins to merge; never drops or merges on its own (spec 4.6).
-- Called by the system (the A5 submit function), not by clients.
create function public.flag_possible_duplicate(p_sos_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  phone text;
  match uuid;
begin
  select * into s from public.sos_requests where id = p_sos_id;
  if not found then return null; end if;
  select contact_phone into phone from public.sos_contacts where sos_id = p_sos_id;

  select o.id into match
  from public.sos_requests o
  left join public.sos_contacts oc on oc.sos_id = o.id
  where o.id <> s.id
    and o.duplicate_of is null
    and o.status in ('received', 'assigned', 'en_route')
    and o.created_at <= s.created_at
    and ((phone is not null and oc.contact_phone = phone)
         or (abs(extract(epoch from (s.created_at - o.created_at))) <= 7200
             and extensions.st_dwithin(o.point::extensions.geography, s.point::extensions.geography, 300)))
  order by o.created_at
  limit 1;

  if match is not null then
    update public.sos_requests set possible_duplicate_of = match where id = s.id;
  end if;
  return match;
end $$;
revoke execute on function public.flag_possible_duplicate(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Logged reveals: the only way to read someone else's phone or household data
-------------------------------------------------------------------------------
create function public.log_access(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, p_details)
$$;
revoke execute on function public.log_access(text, text, text, jsonb) from public, anon, authenticated;

-- An SOS requester's phone: verified authorities covering the case's tambon, and admins.
create function public.reveal_sos_phone(p_sos_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  phone text;
begin
  select tambon into t from public.sos_requests where id = p_sos_id;
  if not found then return null; end if;
  if not (public.is_admin() or public.covers_tambon(t)) then
    raise exception 'Not allowed to see this phone number' using errcode = 'insufficient_privilege';
  end if;
  select contact_phone into phone from public.sos_contacts where sos_id = p_sos_id;
  perform public.log_access('reveal_phone', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('had_phone', phone is not null));
  return phone;
end $$;

-- Another unit's point-of-contact: admins, or verified authorities sharing coverage with it.
create function public.reveal_poc_phone(p_unit_id uuid) returns table (poc_name text, poc_phone text)
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or exists (
      select 1
      from public.authority_coverage theirs
      join public.authority_coverage mine on mine.tambon = theirs.tambon
      join public.authority_units u on u.id = mine.unit_id
      where theirs.unit_id = p_unit_id
        and u.user_id = (select auth.uid())
        and u.status = 'verified')) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $$;

-- Households in a tambon: admins, or verified authorities with rescue or coordination capability
-- covering it (decision f). Every call is logged with the number of households returned.
create function public.households_in_tambon(p_tambon text) returns setof public.households
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not (public.is_admin()
          or public.covers_tambon(p_tambon, array['rescue', 'coordination']::public.authority_capability[])) then
    raise exception 'Not allowed to see household data here' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into n from public.households where tambon = p_tambon;
  perform public.log_access('read_households', 'tambons', p_tambon, jsonb_build_object('count', n));
  return query select * from public.households where tambon = p_tambon;
end $$;

-- A user's own phone for admins (e.g. to call back an authority applicant).
create function public.reveal_profile_phone(p_user_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  phone text;
begin
  if not public.is_admin() then
    raise exception 'Not allowed to see this phone number' using errcode = 'insufficient_privilege';
  end if;
  select c.phone into phone from public.profile_contacts c where c.user_id = p_user_id;
  perform public.log_access('reveal_phone', 'profiles', p_user_id::text,
                            jsonb_build_object('had_phone', phone is not null));
  return phone;
end $$;

revoke execute on function public.reveal_sos_phone(uuid) from public, anon;
revoke execute on function public.reveal_poc_phone(uuid) from public, anon;
revoke execute on function public.households_in_tambon(text) from public, anon;
revoke execute on function public.reveal_profile_phone(uuid) from public, anon;
grant execute on function public.reveal_sos_phone(uuid) to authenticated;
grant execute on function public.reveal_poc_phone(uuid) to authenticated;
grant execute on function public.households_in_tambon(text) to authenticated;
grant execute on function public.reveal_profile_phone(uuid) to authenticated;
