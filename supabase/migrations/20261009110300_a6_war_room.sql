-- A6 (1/n): what the admins' war room reads and does (spec 6.4 and 9, safety rules 1, 5 and 6).
--
-- Nothing here widens what an admin may see. Under spec 9 an admin already reads profiles, exact
-- SOS locations and details, reports and coverage; these functions only shape that into one
-- screen and compute the waiting times the monitor is judged on. They check public.is_admin()
-- themselves, because a few of them cross into owner-only tables to count rows.
--
-- Two lines are held deliberately:
--   * Watched places (saved_places) are returned as counts per tambon and nothing else. A watched
--     place, its label and the person named on it belong to its owner alone (spec 9 gives an
--     admin "none"), so no point, name or phone of one ever leaves these functions.
--   * No phone number is returned by anything here, only "there is a number". The existing logged
--     reveal_sos_phone(), reveal_poc_phone() and reveal_profile_phone() stay the only way to see
--     one, and every reveal is in audit_log (safety rule 5).

-------------------------------------------------------------------------------
-- How long a case may wait for an answer before the monitor shouts (spec 6.4: configurable).
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('sos_unclaimed_minutes',
   '{"minutes": 15}'::jsonb,
   'An open SOS no unit has accepted after this many minutes is called out on the admin war room. It changes nothing about delivery: the case is on every covering unit''s board from the second it arrives (safety rule 1).');

-------------------------------------------------------------------------------
-- The gate. Called from inside the definer functions below, which run as the owner, so it stays
-- unreachable for clients themselves.
-------------------------------------------------------------------------------
create function public.admin_only() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
end $$;
revoke execute on function public.admin_only() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The counters along the top of the war room. Counts only: no row of personal data is returned,
-- so there is nothing to log.
-------------------------------------------------------------------------------
create function public.admin_overview()
returns table (
  people integer, people_new_7d integer, people_with_home integer,
  watched_places integer, watched_notify integer,
  units_verified integer, units_pending integer,
  tambons_covered integer, tambons_total integer, tambons_uncovered integer,
  sos_open integer, sos_waiting integer, sos_overdue integer, sos_working integer,
  sos_24h integer, sos_closed_24h integer, sos_spam_open integer,
  oldest_waiting_at timestamptz,
  reports_72h integer, reports_pending integer,
  unclaimed_minutes integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mins integer := public.setting_int('sos_unclaimed_minutes', 'minutes', 15);
begin
  perform public.admin_only();
  return query
  with open_cases as (
    select s.id, s.created_at, s.tambon,
           exists (select 1 from public.sos_claims c
                   where c.sos_id = s.id and c.released_at is null) as claimed
    from public.sos_requests s
    where s.status in ('received', 'assigned', 'en_route') and s.duplicate_of is null
  ),
  covered as (
    select distinct c.tambon
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where u.status = 'verified'
  )
  select
    (select count(*) from public.profiles)::integer,
    (select count(*) from public.profiles where created_at > now() - interval '7 days')::integer,
    (select count(*) from public.profiles where home_point is not null)::integer,
    (select count(*) from public.saved_places)::integer,
    (select count(*) from public.saved_places where notify)::integer,
    (select count(*) from public.authority_units where status = 'verified')::integer,
    (select count(*) from public.authority_units where status = 'pending')::integer,
    (select count(*) from covered)::integer,
    (select count(*) from public.tambons)::integer,
    (select count(*) from public.tambons t
      where not exists (select 1 from covered c where c.tambon = t.code))::integer,
    (select count(*) from open_cases)::integer,
    (select count(*) from open_cases where not claimed)::integer,
    (select count(*) from open_cases
      where not claimed and created_at < now() - make_interval(mins => v_mins))::integer,
    (select count(*) from open_cases where claimed)::integer,
    (select count(*) from public.sos_requests
      where created_at > now() - interval '24 hours')::integer,
    (select count(*) from public.sos_requests
      where closed_at > now() - interval '24 hours')::integer,
    (select count(*) from public.sos_review r
      join public.sos_requests s on s.id = r.sos_id
      where r.suspected_spam and r.spam_dismissed_at is null
        and s.status in ('received', 'assigned', 'en_route'))::integer,
    (select min(created_at) from open_cases where not claimed),
    (select count(*) from public.reports
      where created_at > now() - interval '72 hours')::integer,
    (select count(*) from public.reports where moderation_status = 'pending')::integer,
    v_mins;
end $$;

-------------------------------------------------------------------------------
-- The case board. One row per SOS, with where it is, who holds it and how long it has waited.
--
-- Spec 9 asks for an admin's read of SOS locations and details to be logged. The board is polled
-- while the war room is open, so writing a row per read would bury the log it is meant to keep;
-- one row per admin per ten minutes marks the watch instead, and every phone reveal is still
-- logged on its own.
-------------------------------------------------------------------------------
create function public.admin_sos_board(p_hours integer default 72)
returns table (
  sos_id uuid, created_at timestamptz, closed_at timestamptz,
  status public.sos_status, hazard_type public.hazard_type,
  lat double precision, lon double precision, accuracy_m real, location_text text,
  tambon text, tambon_th text, tambon_en text, district_th text, district_en text,
  province_code text, province_th text,
  people_count smallint, vulnerable_flags jsonb, depth_ref public.depth_ref,
  injuries text, note text, photos integer, has_voice boolean, battery_pct smallint,
  on_behalf boolean, on_behalf_note text,
  has_phone boolean, requester_id uuid, requester_name text,
  priority_score real, suspected_spam boolean, spam_dismissed_at timestamptz,
  duplicate_of uuid, possible_duplicate_of uuid, merged_in integer,
  claim_unit_id uuid, claim_unit_name text, claim_org text, claimed_at timestamptz,
  last_event text, last_event_at timestamptz,
  units_covering integer
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if not exists (
    select 1 from public.audit_log
    where actor = (select auth.uid()) and action = 'read_sos_board'
      and ts > now() - interval '10 minutes'
  ) then
    perform public.log_access('read_sos_board', 'sos_requests', null,
                              jsonb_build_object('hours', p_hours));
  end if;
  return query
  select
    s.id, s.created_at, s.closed_at, s.status, s.hazard_type,
    round(extensions.st_y(s.point)::numeric, 5)::double precision,
    round(extensions.st_x(s.point)::numeric, 5)::double precision,
    s.location_accuracy_m, s.location_text,
    s.tambon, t.name_th, t.name_en, d.name_th, d.name_en, t.province_code, pv.name_th,
    s.people_count, s.vulnerable_flags, s.depth_ref,
    s.injuries, s.text, cardinality(s.photos), s.voice_url is not null, s.battery_pct,
    s.on_behalf, s.on_behalf_note,
    exists (select 1 from public.sos_contacts sc
            where sc.sos_id = s.id
              and (sc.contact_phone is not null or sc.on_site_phone is not null)),
    s.requester_id, p.display_name,
    s.priority_score,
    coalesce(r.suspected_spam, false), r.spam_dismissed_at,
    s.duplicate_of, s.possible_duplicate_of,
    (select count(*)::integer from public.sos_events e
     where e.sos_id = s.id and e.event = 'merged_update'),
    cl.unit_id, u.unit_name, o.name, cl.claimed_at,
    le.event, le.created_at,
    (select count(distinct c.unit_id)::integer
     from public.authority_coverage c
     join public.authority_units au on au.id = c.unit_id
     where c.tambon = s.tambon and au.status = 'verified')
  from public.sos_requests s
  left join public.tambons t on t.code = s.tambon
  left join public.districts d on d.code = t.district_code
  left join public.provinces pv on pv.code = t.province_code
  left join public.profiles p on p.user_id = s.requester_id
  left join public.sos_review r on r.sos_id = s.id
  left join public.sos_claims cl on cl.sos_id = s.id and cl.released_at is null
  left join public.authority_units u on u.id = cl.unit_id
  left join public.organizations o on o.id = u.org_id
  left join lateral (
    select e.event, e.created_at from public.sos_events e
    where e.sos_id = s.id order by e.created_at desc limit 1
  ) le on true
  where s.created_at > now() - make_interval(hours => greatest(p_hours, 1))
     or s.status in ('received', 'assigned', 'en_route')
  order by s.created_at desc;
end $$;

-------------------------------------------------------------------------------
-- Everything that has happened to one case, for the panel that opens on a card. The timeline is
-- already readable by an admin through sos_events; this adds the unit's name.
-------------------------------------------------------------------------------
create function public.admin_sos_history(p_sos_id uuid)
returns table (
  at timestamptz, event text, note text, unit_name text, actor_name text, photos integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select e.created_at, e.event, e.note, u.unit_name, p.display_name, cardinality(e.photos)
  from public.sos_events e
  left join public.authority_units u on u.id = e.unit_id
  left join public.profiles p on p.user_id = e.actor_id
  where e.sos_id = p_sos_id
  order by e.created_at;
end $$;

-------------------------------------------------------------------------------
-- Who has registered. The phone is never returned, only whether there is one; a number is read
-- through reveal_profile_phone(), which logs it.
-------------------------------------------------------------------------------
create function public.admin_people(
  p_search text default null, p_limit integer default 50, p_offset integer default 0
)
returns table (
  user_id uuid, display_name text, role public.user_role, preferred_locale text,
  created_at timestamptz,
  home_tambon text, tambon_th text, tambon_en text, district_th text, province_th text,
  lat double precision, lon double precision,
  has_phone boolean, phone_verified boolean, has_line boolean,
  watched_places integer, sos_sent integer, reports_sent integer,
  total_rows integer
)
language plpgsql security definer set search_path = '' as $$
declare
  q text := nullif(btrim(coalesce(p_search, '')), '');
  n integer;
begin
  perform public.admin_only();
  select count(*) into n
  from public.profiles pr
  left join public.tambons t on t.code = pr.home_tambon
  where q is null
     or pr.display_name ilike '%' || q || '%'
     or t.name_th ilike '%' || q || '%'
     or t.name_en ilike '%' || q || '%';
  perform public.log_access('read_people', 'profiles', null,
                            jsonb_build_object('count', n, 'search', q is not null));
  return query
  select
    pr.user_id, pr.display_name, pr.role, pr.preferred_locale, pr.created_at,
    pr.home_tambon, t.name_th, t.name_en, d.name_th, pv.name_th,
    round(extensions.st_y(pr.home_point)::numeric, 5)::double precision,
    round(extensions.st_x(pr.home_point)::numeric, 5)::double precision,
    c.phone is not null, coalesce(c.phone_verified, false), pr.line_user_id is not null,
    (select count(*)::integer from public.saved_places sp where sp.user_id = pr.user_id),
    (select count(*)::integer from public.sos_requests s where s.requester_id = pr.user_id),
    (select count(*)::integer from public.reports rp where rp.reporter_id = pr.user_id),
    n
  from public.profiles pr
  left join public.tambons t on t.code = pr.home_tambon
  left join public.districts d on d.code = t.district_code
  left join public.provinces pv on pv.code = t.province_code
  left join public.profile_contacts c on c.user_id = pr.user_id
  where q is null
     or pr.display_name ilike '%' || q || '%'
     or t.name_th ilike '%' || q || '%'
     or t.name_en ilike '%' || q || '%'
  order by pr.created_at desc
  limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
end $$;

-------------------------------------------------------------------------------
-- Home pins for the map: where people say they live, with no name attached. An admin may read
-- profiles.home_point under spec 9; the map plots exactly that and nothing more.
-------------------------------------------------------------------------------
create function public.admin_people_points(p_limit integer default 4000)
returns table (lat double precision, lon double precision, tambon text, role public.user_role)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  perform public.log_access('read_people_points', 'profiles', null, '{}'::jsonb);
  return query
  select round(extensions.st_y(pr.home_point)::numeric, 5)::double precision,
         round(extensions.st_x(pr.home_point)::numeric, 5)::double precision,
         pr.home_tambon, pr.role
  from public.profiles pr
  where pr.home_point is not null
  order by pr.created_at desc
  limit least(greatest(p_limit, 1), 10000);
end $$;

-------------------------------------------------------------------------------
-- Watched places, as counts per tambon and never as rows (spec 9: an admin reads none of them).
-- It answers "how many people are being looked out for here", which is what the war room needs,
-- without naming a place or a person.
-------------------------------------------------------------------------------
create function public.admin_watched_by_tambon()
returns table (
  tambon text, tambon_th text, tambon_en text, district_th text, province_code text,
  places integer, notify integer, owners integer, homes integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  with w as (
    select sp.tambon, count(*)::integer as places,
           count(*) filter (where sp.notify)::integer as notify,
           count(distinct sp.user_id)::integer as owners
    from public.saved_places sp where sp.tambon is not null group by sp.tambon
  ),
  h as (
    select pr.home_tambon as tambon, count(*)::integer as homes
    from public.profiles pr where pr.home_tambon is not null group by pr.home_tambon
  )
  select t.code, t.name_th, t.name_en, d.name_th, t.province_code,
         coalesce(w.places, 0), coalesce(w.notify, 0), coalesce(w.owners, 0),
         coalesce(h.homes, 0)
  from public.tambons t
  join public.districts d on d.code = t.district_code
  left join w on w.tambon = t.code
  left join h on h.tambon = t.code
  where coalesce(w.places, 0) > 0 or coalesce(h.homes, 0) > 0
  order by coalesce(w.places, 0) + coalesce(h.homes, 0) desc;
end $$;

-------------------------------------------------------------------------------
-- Recent flood reports, for the map layer and the moderation count. An admin already reads the
-- exact location and the reporter (spec 9); the reporter's name is left out all the same, because
-- the war room has no use for it.
-------------------------------------------------------------------------------
create function public.admin_reports_recent(p_hours integer default 72)
returns table (
  report_id uuid, created_at timestamptz, hazard_type public.hazard_type,
  lat double precision, lon double precision, tambon text, tambon_th text,
  depth_ref public.depth_ref, trend public.water_trend, road_access public.road_access,
  moderation_status public.moderation_status, photos integer, anonymous boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select rp.id, rp.created_at, rp.hazard_type,
         round(extensions.st_y(rp.point)::numeric, 5)::double precision,
         round(extensions.st_x(rp.point)::numeric, 5)::double precision,
         rp.tambon, t.name_th,
         rp.depth_ref, rp.trend, rp.road_access,
         rp.moderation_status, cardinality(rp.photos), rp.reporter_id is null
  from public.reports rp
  left join public.tambons t on t.code = rp.tambon
  where rp.created_at > now() - make_interval(hours => greatest(p_hours, 1))
  order by rp.created_at desc
  limit 1000;
end $$;

-------------------------------------------------------------------------------
-- The units that could take a case in this tambon, for the assign panel. No phone: the admin
-- asks for the contact through reveal_poc_phone(), which logs it.
-------------------------------------------------------------------------------
create function public.admin_units_for_tambon(p_tambon text)
returns table (
  unit_id uuid, unit_name text, org_name text, org_type public.org_type,
  capabilities public.authority_capability[], status public.authority_status,
  open_cases integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select u.id, u.unit_name, o.name, o.type, u.capabilities, u.status,
         (select count(*)::integer from public.sos_claims c
          join public.sos_requests s on s.id = c.sos_id
          where c.unit_id = u.id and c.released_at is null
            and s.status in ('received', 'assigned', 'en_route'))
  from public.authority_units u
  join public.authority_coverage c on c.unit_id = u.id
  join public.organizations o on o.id = u.org_id
  where c.tambon = p_tambon and u.status = 'verified'
  group by u.id, u.unit_name, o.name, o.type, u.capabilities, u.status
  order by u.unit_name;
end $$;

-------------------------------------------------------------------------------
-- What an admin can do from the board (spec 6.4). Each one writes its own event on the case and
-- its own line in the audit log. None of them can reject, hide or delete a case (safety rule 1).
--
-- Assigning does not notify anyone yet: web push and LINE arrive in A7, and the dispatch relay of
-- 5.2 in A5. Until then the war room's own screen tells the admin to call the unit.
-------------------------------------------------------------------------------
create function public.admin_sos_assign(
  p_sos_id uuid, p_unit_id uuid, p_note text default null
) returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  st public.sos_status;
  held uuid;
begin
  perform public.admin_only();
  select s.tambon, s.status into t, st from public.sos_requests s where s.id = p_sos_id;
  if not found then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  if st not in ('received', 'assigned', 'en_route') then
    raise exception 'This case is closed' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.authority_units u where u.id = p_unit_id
                 and u.status = 'verified') then
    raise exception 'That unit is not verified' using errcode = 'check_violation';
  end if;
  if t is null or not public.unit_covers(p_unit_id, t) then
    raise exception 'That unit does not cover this tambon' using errcode = 'check_violation';
  end if;
  select c.unit_id into held from public.sos_claims c
   where c.sos_id = p_sos_id and c.released_at is null;
  if held is not null and held <> p_unit_id then
    raise exception 'Another unit holds this case' using errcode = 'unique_violation';
  end if;
  if held is null then
    insert into public.sos_claims (sos_id, unit_id) values (p_sos_id, p_unit_id);
  end if;
  update public.sos_requests s set status = 'assigned'
   where s.id = p_sos_id and s.status = 'received';
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'assigned_by_admin', (select auth.uid()), p_unit_id, left(p_note, 1000));
  perform public.log_access('assign_sos', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('unit_id', p_unit_id));
  select s.status into st from public.sos_requests s where s.id = p_sos_id;
  return st;
end $$;

-- Hand a case back to the relay: the unit that holds it is not moving, or asked to be let go.
create function public.admin_sos_release(p_sos_id uuid, p_reason text)
returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  unit uuid;
begin
  perform public.admin_only();
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A release needs a reason' using errcode = 'check_violation';
  end if;
  update public.sos_claims c
     set released_at = now(), release_reason = left(p_reason, 500)
   where c.sos_id = p_sos_id and c.released_at is null
  returning c.unit_id into unit;
  if unit is null then
    raise exception 'Nobody holds this case' using errcode = 'no_data_found';
  end if;
  update public.sos_requests s set status = 'received'
   where s.id = p_sos_id and s.status in ('assigned', 'en_route');
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'released_by_admin', (select auth.uid()), unit, left(p_reason, 1000));
  perform public.log_access('release_sos', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('unit_id', unit));
  return (select s.status from public.sos_requests s where s.id = p_sos_id);
end $$;

-- A line in the case's history: what the admin tried, who they called, what they were told.
create function public.admin_sos_note(p_sos_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'An empty note' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.sos_requests s where s.id = p_sos_id) then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  insert into public.sos_events (sos_id, event, actor_id, note)
  values (p_sos_id, 'admin_note', (select auth.uid()), left(p_note, 1000));
  perform public.log_access('note_sos', 'sos_requests', p_sos_id::text, '{}'::jsonb);
end $$;

-- The spam flag, both ways (spec 6.4: reviewed, reversible, logged). The case itself is never
-- touched: a flagged SOS stays on every covering unit's board and keeps its place in the queue
-- (safety rule 1). The flag only says what the admins think of it.
create function public.admin_sos_spam(
  p_sos_id uuid, p_spam boolean, p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if not exists (select 1 from public.sos_requests s where s.id = p_sos_id) then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  insert into public.sos_review (sos_id, suspected_spam, spam_reason,
                                 spam_dismissed_by, spam_dismissed_at)
  values (p_sos_id, p_spam, left(p_reason, 500),
          case when p_spam then null else (select auth.uid()) end,
          case when p_spam then null else now() end)
  on conflict (sos_id) do update
    set suspected_spam = p_spam,
        spam_reason = coalesce(left(p_reason, 500), sos_review.spam_reason),
        spam_dismissed_by = case when p_spam then null else (select auth.uid()) end,
        spam_dismissed_at = case when p_spam then null else now() end;
  insert into public.sos_events (sos_id, event, actor_id, note)
  values (p_sos_id, case when p_spam then 'flagged_spam' else 'spam_dismissed' end,
          (select auth.uid()), left(p_reason, 1000));
  perform public.log_access(case when p_spam then 'flag_spam' else 'dismiss_spam' end,
                            'sos_requests', p_sos_id::text,
                            jsonb_build_object('spam', p_spam));
end $$;

-------------------------------------------------------------------------------
-- Only signed-in callers may even try; each function then checks is_admin() for itself.
-------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_overview()',
    'public.admin_sos_board(integer)',
    'public.admin_sos_history(uuid)',
    'public.admin_people(text, integer, integer)',
    'public.admin_people_points(integer)',
    'public.admin_watched_by_tambon()',
    'public.admin_reports_recent(integer)',
    'public.admin_units_for_tambon(text)',
    'public.admin_sos_assign(uuid, uuid, text)',
    'public.admin_sos_release(uuid, text)',
    'public.admin_sos_note(uuid, text)',
    'public.admin_sos_spam(uuid, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
