-- A6, the rest: report moderation, safe places, the access log, handover notes, announcements,
-- exports and merging duplicate SOS (docs/spec.md 6.4 and 6.5).
--
-- The rules every part follows:
--   * admins only, checked here and not only by the page (safety rule 5);
--   * every act an admin takes is written to audit_log, with what changed;
--   * no phone number, no reporter and no requester identity is in any list or any export;
--   * nothing here can make a request for help disappear (safety rule 1): a merged SOS stays
--     open and comes back to the boards by itself if the case it was merged into ends first.

-------------------------------------------------------------------------------
-- 1. Report moderation (spec 6.5). "Approved" is what lets a report count in the public map's
--    hexagons; "hidden" keeps it from the public and from the teams' feed. Nothing is deleted.
-------------------------------------------------------------------------------
create function public.admin_reports_queue(
  p_status public.moderation_status default 'pending', p_limit integer default 60
)
returns table (
  report_id uuid, created_at timestamptz, hazard_type public.hazard_type,
  tambon text, tambon_th text, tambon_en text,
  depth_ref public.depth_ref, trend public.water_trend, road_access public.road_access,
  note text, photos integer, has_voice boolean,
  moderation_status public.moderation_status, anonymous boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select rp.id, rp.created_at, rp.hazard_type, rp.tambon, t.name_th, t.name_en,
         rp.depth_ref, rp.trend, rp.road_access, rp.text,
         cardinality(rp.photos), rp.voice_url is not null,
         rp.moderation_status, rp.reporter_id is null
    from public.reports rp
    left join public.tambons t on t.code = rp.tambon
   where rp.moderation_status = p_status
   order by rp.created_at desc
   limit least(greatest(p_limit, 1), 200);
end $$;
revoke execute on function public.admin_reports_queue(public.moderation_status, integer)
  from public, anon;
grant execute on function public.admin_reports_queue(public.moderation_status, integer)
  to authenticated;

create function public.admin_moderate_report(p_report uuid, p_status public.moderation_status)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.moderation_status;
begin
  perform public.admin_only();
  select r.moderation_status into v_old from public.reports r where r.id = p_report for update;
  if not found then
    raise exception 'No such report' using errcode = 'no_data_found';
  end if;
  if v_old = p_status then
    return;
  end if;
  update public.reports set moderation_status = p_status where id = p_report;
  perform public.log_access('report_moderated', 'reports', p_report::text,
                            jsonb_build_object('from', v_old, 'to', p_status));
end $$;
revoke execute on function public.admin_moderate_report(uuid, public.moderation_status)
  from public, anon;
grant execute on function public.admin_moderate_report(uuid, public.moderation_status)
  to authenticated;

-------------------------------------------------------------------------------
-- 2. Safe places (spec 6.5): read by district (rejected ones included), change, add.
--    A place is never deleted from a screen: "rejected" takes it off the public list and keeps
--    the record of why it was there.
-------------------------------------------------------------------------------
create function public.admin_safe_places(p_district text, p_only text default null)
returns table (
  place_id uuid, name jsonb, type public.safe_place_type,
  lat double precision, lon double precision, tambon text, tambon_th text, tambon_en text,
  capacity integer, parking boolean, score real, flags jsonb, source text,
  verification_status public.verification_status, status public.safe_place_status,
  needs text, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select sp.id, sp.name, sp.type,
         extensions.st_y(sp.point)::double precision, extensions.st_x(sp.point)::double precision,
         sp.tambon, t.name_th, t.name_en,
         sp.capacity, sp.parking, sp.score,
         coalesce(sp.score_components -> 'flags', '[]'::jsonb), sp.facilities ->> 'source',
         sp.verification_status, sp.status, sp.needs, sp.updated_at
    from public.safe_places sp
    join public.tambons t on t.code = sp.tambon
   where t.district_code = p_district
     and (p_only is null or sp.verification_status::text = p_only)
   order by t.code, sp.score desc nulls last, sp.id
   limit 500;
end $$;
revoke execute on function public.admin_safe_places(text, text) from public, anon;
grant execute on function public.admin_safe_places(text, text) to authenticated;

create function public.admin_safe_place_update(
  p_place uuid,
  p_name_th text,
  p_name_en text,
  p_capacity integer,
  p_needs text,
  p_status public.safe_place_status,
  p_verification public.verification_status
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old public.safe_places;
  v_name jsonb;
  v_needs text := nullif(left(btrim(coalesce(p_needs, '')), 500), '');
begin
  perform public.admin_only();
  select sp.* into old from public.safe_places sp where sp.id = p_place for update;
  if not found then
    raise exception 'No such safe place' using errcode = 'no_data_found';
  end if;
  if btrim(coalesce(p_name_th, '')) = '' then
    raise exception 'A safe place needs its Thai name' using errcode = 'check_violation';
  end if;
  if p_capacity is not null and p_capacity < 0 then
    raise exception 'Capacity cannot be negative' using errcode = 'check_violation';
  end if;
  v_name := old.name || jsonb_build_object('th', left(btrim(p_name_th), 200))
            || case when btrim(coalesce(p_name_en, '')) = '' then '{}'::jsonb
                    else jsonb_build_object('en', left(btrim(p_name_en), 200)) end;
  update public.safe_places
     set name = v_name, capacity = p_capacity, needs = v_needs, status = p_status,
         verification_status = p_verification,
         verified_by = case when p_verification = old.verification_status then old.verified_by
                            when p_verification = 'unverified' then null
                            else (select auth.uid()) end,
         updated_at = now()
   where id = p_place;
  perform public.log_access('safe_place_updated', 'safe_places', p_place::text, jsonb_build_object(
    'status', jsonb_build_array(old.status, p_status),
    'verification', jsonb_build_array(old.verification_status, p_verification),
    'capacity', jsonb_build_array(old.capacity, p_capacity),
    'needs_changed', old.needs is distinct from v_needs,
    'name_changed', old.name is distinct from v_name));
end $$;
revoke execute on function public.admin_safe_place_update(uuid, text, text, integer, text,
  public.safe_place_status, public.verification_status) from public, anon;
grant execute on function public.admin_safe_place_update(uuid, text, text, integer, text,
  public.safe_place_status, public.verification_status) to authenticated;

create function public.admin_safe_place_add(
  p_name_th text,
  p_name_en text,
  p_type public.safe_place_type,
  p_lat double precision,
  p_lon double precision,
  p_capacity integer default null,
  p_verified boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_point extensions.geometry;
  v_tambon text;
  v_id uuid;
begin
  perform public.admin_only();
  if btrim(coalesce(p_name_th, '')) = '' then
    raise exception 'A safe place needs its Thai name' using errcode = 'check_violation';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'A safe place needs a position' using errcode = 'check_violation';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  select t.code into v_tambon from public.tambons t
   where extensions.st_contains(t.geom, v_point) limit 1;
  -- Outside the four provinces a place would never be offered to anyone; a slip of the
  -- coordinates (latitude and longitude swapped) lands here too.
  if v_tambon is null then
    raise exception 'That position is not inside a tambon Jaga covers'
      using errcode = 'check_violation';
  end if;
  insert into public.safe_places (name, type, point, tambon, capacity, parking, facilities,
                                  verification_status, verified_by)
  values (jsonb_build_object('th', left(btrim(p_name_th), 200))
            || case when btrim(coalesce(p_name_en, '')) = '' then '{}'::jsonb
                    else jsonb_build_object('en', left(btrim(p_name_en), 200)) end,
          p_type, v_point, v_tambon, p_capacity, p_type = 'high_ground_parking',
          jsonb_build_object('source', 'admin'),
          case when p_verified then 'verified'::public.verification_status
               else 'unverified'::public.verification_status end,
          case when p_verified then (select auth.uid()) end)
  returning id into v_id;
  perform public.log_access('safe_place_added', 'safe_places', v_id::text,
                            jsonb_build_object('tambon', v_tambon, 'type', p_type));
  return v_id;
end $$;
revoke execute on function public.admin_safe_place_add(text, text, public.safe_place_type,
  double precision, double precision, integer, boolean) from public, anon;
grant execute on function public.admin_safe_place_add(text, text, public.safe_place_type,
  double precision, double precision, integer, boolean) to authenticated;

-------------------------------------------------------------------------------
-- 3. The access log, for reading (spec 6.5). Reading the log is not itself logged: it holds no
--    personal data beyond who did what, and a log of log-reads would bury the rest.
-------------------------------------------------------------------------------
create function public.admin_audit_log(
  p_action text default null, p_before bigint default null, p_limit integer default 100
)
returns table (
  log_id bigint, ts timestamptz, actor_name text, action text, entity text, entity_id text,
  details jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select l.id, l.ts, p.display_name, l.action, l.entity, l.entity_id, l.details
    from public.audit_log l
    left join public.profiles p on p.user_id = l.actor
   where (p_action is null or l.action = p_action)
     and (p_before is null or l.id < p_before)
   order by l.id desc
   limit least(greatest(p_limit, 1), 500);
end $$;
revoke execute on function public.admin_audit_log(text, bigint, integer) from public, anon;
grant execute on function public.admin_audit_log(text, bigint, integer) to authenticated;

-- The kinds of act in the last 90 days, for the filter.
create function public.admin_audit_actions()
returns table (action text, times integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select l.action, count(*)::integer
    from public.audit_log l
   where l.ts > now() - interval '90 days'
   group by l.action
   order by l.action;
end $$;
revoke execute on function public.admin_audit_actions() from public, anon;
grant execute on function public.admin_audit_actions() to authenticated;

-------------------------------------------------------------------------------
-- 4. Handover notes (spec 6.5): a shift log. Written through the table's own policy (an admin,
--    as themselves, append-only); read here with the author's name.
-------------------------------------------------------------------------------
create function public.admin_handover(p_limit integer default 100)
returns table (note_id bigint, created_at timestamptz, author_name text, note text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select h.id, h.created_at, p.display_name, h.note
    from public.handover_notes h
    left join public.profiles p on p.user_id = h.author_id
   order by h.created_at desc, h.id desc
   limit least(greatest(p_limit, 1), 500);
end $$;
revoke execute on function public.admin_handover(integer) from public, anon;
grant execute on function public.admin_handover(integer) to authenticated;

-------------------------------------------------------------------------------
-- 5. Announcements now have a screen, so posting and withdrawing one go in the log like any
--    other admin act. Same signatures as A7's; only the logging is new.
-------------------------------------------------------------------------------
create or replace function public.admin_announce(
  p_messages jsonb,
  p_tambons text[] default null,
  p_ends_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.admin_only();
  if p_messages is null or btrim(coalesce(p_messages ->> 'th', '')) = '' then
    raise exception 'An announcement needs Thai text' using errcode = 'check_violation';
  end if;
  insert into public.announcements (messages, tambons, ends_at, created_by)
  values (p_messages, p_tambons, p_ends_at, (select auth.uid()))
  returning id into v_id;
  perform public.log_access('announcement_posted', 'announcements', v_id::text, jsonb_build_object(
    'tambons', coalesce(array_length(p_tambons, 1), 0), 'ends_at', p_ends_at));
  return v_id;
end $$;

create or replace function public.admin_announce_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  update public.announcements set cancelled_at = now() where id = p_id and cancelled_at is null;
  if found then
    perform public.log_access('announcement_cancelled', 'announcements', p_id::text, '{}'::jsonb);
  end if;
end $$;

-------------------------------------------------------------------------------
-- 6. Exports (spec 6.5). Each one is logged with how many rows left the database.
--    No export carries a phone number, a name, a device id, free text, a photo or a voice note.
--    The anonymized SOS export also drops the case id, rounds the position to about a kilometre
--    and the time to the hour, so a row cannot be matched to a household.
-------------------------------------------------------------------------------
create function public.admin_export_sos(p_days integer default 30, p_anonymized boolean default true)
returns table (
  sos_id text, created_at timestamptz, closed_at timestamptz, kind text, status text,
  hazard_type text, tambon text, province text, lat double precision, lon double precision,
  people_count integer, depth_ref text, merged boolean, minutes_to_accept integer
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 400);
  n integer;
begin
  perform public.admin_only();
  select count(*) into n from public.sos_requests s
   where s.created_at > now() - make_interval(days => v_days);
  perform public.log_access('export', 'sos_requests', null, jsonb_build_object(
    'days', v_days, 'anonymized', coalesce(p_anonymized, true), 'rows', n));
  return query
  select case when coalesce(p_anonymized, true) then null else s.id::text end,
         case when coalesce(p_anonymized, true) then date_trunc('hour', s.created_at)
              else s.created_at end,
         case when coalesce(p_anonymized, true) then date_trunc('hour', s.closed_at)
              else s.closed_at end,
         s.kind::text, s.status::text, s.hazard_type::text, s.tambon, left(s.tambon, 2),
         case when coalesce(p_anonymized, true)
              then round(extensions.st_y(s.point)::numeric, 2)::double precision
              else extensions.st_y(s.point)::double precision end,
         case when coalesce(p_anonymized, true)
              then round(extensions.st_x(s.point)::numeric, 2)::double precision
              else extensions.st_x(s.point)::double precision end,
         s.people_count::integer, s.depth_ref::text, s.duplicate_of is not null,
         (select (extract(epoch from (min(c.claimed_at) - s.created_at)) / 60)::integer
            from public.sos_claims c where c.sos_id = s.id)
    from public.sos_requests s
   where s.created_at > now() - make_interval(days => v_days)
   order by s.created_at;
end $$;
revoke execute on function public.admin_export_sos(integer, boolean) from public, anon;
grant execute on function public.admin_export_sos(integer, boolean) to authenticated;

create function public.admin_export_reports(p_days integer default 30)
returns table (
  report_id text, created_at timestamptz, hazard_type text, tambon text, province text,
  lat double precision, lon double precision, depth_ref text, trend text, road_access text,
  moderation_status text, photos integer
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 400);
  n integer;
begin
  perform public.admin_only();
  select count(*) into n from public.reports r
   where r.created_at > now() - make_interval(days => v_days);
  perform public.log_access('export', 'reports', null,
                            jsonb_build_object('days', v_days, 'rows', n));
  return query
  select r.id::text, r.created_at, r.hazard_type::text, r.tambon, left(r.tambon, 2),
         extensions.st_y(r.point)::double precision, extensions.st_x(r.point)::double precision,
         r.depth_ref::text, r.trend::text, r.road_access::text, r.moderation_status::text,
         cardinality(r.photos)
    from public.reports r
   where r.created_at > now() - make_interval(days => v_days)
   order by r.created_at;
end $$;
revoke execute on function public.admin_export_reports(integer) from public, anon;
grant execute on function public.admin_export_reports(integer) to authenticated;

-- Alerts: one row per alert, with its tambons as a list and the outline they make together.
create function public.admin_export_alerts(p_days integer default 30)
returns table (
  alert_id text, issued_at timestamptz, ended_at timestamptz, level text, hazard_type text,
  drill boolean, state text, next_update_at timestamptz, reason text, tambons text[],
  geometry jsonb
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 400);
  n integer;
begin
  perform public.admin_only();
  select count(*) into n from public.alerts a
   where a.issued_at > now() - make_interval(days => v_days);
  perform public.log_access('export', 'alerts', null,
                            jsonb_build_object('days', v_days, 'rows', n));
  return query
  select a.id::text, a.issued_at,
         coalesce(a.cancelled_at,
                  (select s.issued_at from public.alerts s where s.id = a.superseded_by)),
         a.level::text, a.hazard_type::text, a.is_drill,
         case when a.cancelled_at is not null then 'cancelled'
              when a.superseded_by is not null then 'superseded' else 'in_force' end,
         a.next_update_at, a.reason,
         coalesce((select array_agg(at.tambon order by at.tambon)
                     from public.alert_tambons at where at.alert_id = a.id), '{}'),
         (select extensions.st_asgeojson(extensions.st_union(t.geom_web), 5)::jsonb
            from public.alert_tambons at join public.tambons t on t.code = at.tambon
           where at.alert_id = a.id)
    from public.alerts a
   where a.issued_at > now() - make_interval(days => v_days)
   order by a.issued_at;
end $$;
revoke execute on function public.admin_export_alerts(integer) from public, anon;
grant execute on function public.admin_export_alerts(integer) to authenticated;

-------------------------------------------------------------------------------
-- 7. Merging duplicate SOS (spec 6.4).
--
--    A merged case is not closed and not deleted. It leaves the boards (every board already
--    skips a case with duplicate_of set), its sender is shown the team that took the case it was
--    merged into, and it can be un-merged at any time. If the main case ends while a merged one
--    is still open, the merged one returns to the boards by itself: a wrong merge must never be
--    the reason someone is not reached (safety rule 1).
-------------------------------------------------------------------------------
create function public.admin_sos_duplicates()
returns table (
  sos_id uuid, created_at timestamptz, status public.sos_status, kind text,
  tambon_th text, tambon_en text, people_count integer, claimed boolean,
  other_id uuid, other_created_at timestamptz, other_status public.sos_status,
  other_people_count integer, other_claimed boolean, distance_m integer, merged boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select s.id, s.created_at, s.status, s.kind::text, t.name_th, t.name_en,
         s.people_count::integer,
         exists (select 1 from public.sos_claims c where c.sos_id = s.id and c.released_at is null),
         o.id, o.created_at, o.status, o.people_count::integer,
         exists (select 1 from public.sos_claims c where c.sos_id = o.id and c.released_at is null),
         extensions.st_distance(s.point::extensions.geography, o.point::extensions.geography)::integer,
         s.duplicate_of is not null
    from public.sos_requests s
    join public.sos_requests o on o.id = coalesce(s.duplicate_of, s.possible_duplicate_of)
    left join public.tambons t on t.code = s.tambon
   where s.closed_at is null
     and s.status in ('received', 'assigned', 'en_route', 'on_site')
     and (s.duplicate_of is not null
          or (o.closed_at is null and o.status in ('received', 'assigned', 'en_route', 'on_site')
              and o.duplicate_of is null))
   order by s.duplicate_of is not null, s.created_at desc
   limit 200;
end $$;
revoke execute on function public.admin_sos_duplicates() from public, anon;
grant execute on function public.admin_sos_duplicates() to authenticated;

create function public.admin_sos_merge(p_duplicate uuid, p_into uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.sos_requests;
  m public.sos_requests;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform public.admin_only();
  if p_duplicate = p_into then
    raise exception 'A case cannot be merged into itself' using errcode = 'check_violation';
  end if;
  select s.* into d from public.sos_requests s where s.id = p_duplicate for update;
  select s.* into m from public.sos_requests s where s.id = p_into for update;
  if d.id is null or m.id is null then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  if d.closed_at is not null or d.status not in ('received', 'assigned', 'en_route', 'on_site')
     or m.closed_at is not null or m.status not in ('received', 'assigned', 'en_route', 'on_site') then
    raise exception 'Both cases must be open' using errcode = 'check_violation';
  end if;
  if d.duplicate_of is not null or m.duplicate_of is not null then
    raise exception 'One of these cases is already merged' using errcode = 'check_violation';
  end if;
  if d.kind <> m.kind then
    raise exception 'A rescue and a supply request are never the same case'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sos_requests x where x.duplicate_of = d.id) then
    raise exception 'Other cases are merged into this one; merge the other way round'
      using errcode = 'check_violation';
  end if;
  -- A team already holding the duplicate is on its way to it: that is not a duplicate to hide.
  if exists (select 1 from public.sos_claims c where c.sos_id = d.id and c.released_at is null) then
    raise exception 'A team holds that case; ask them to hand it back first'
      using errcode = 'check_violation';
  end if;
  update public.sos_requests set duplicate_of = m.id where id = d.id;
  insert into public.sos_events (sos_id, event, actor_id, note)
  values (d.id, 'merged_into', (select auth.uid()), v_note),
         (m.id, 'merged_from', (select auth.uid()), v_note);
  perform public.log_access('sos_merged', 'sos_requests', d.id::text,
                            jsonb_build_object('into', m.id, 'note', v_note));
end $$;
revoke execute on function public.admin_sos_merge(uuid, uuid, text) from public, anon;
grant execute on function public.admin_sos_merge(uuid, uuid, text) to authenticated;

create function public.admin_sos_unmerge(p_sos uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_was uuid;
begin
  perform public.admin_only();
  select s.duplicate_of into v_was from public.sos_requests s where s.id = p_sos for update;
  if v_was is null then
    raise exception 'That case is not merged' using errcode = 'no_data_found';
  end if;
  update public.sos_requests set duplicate_of = null where id = p_sos;
  insert into public.sos_events (sos_id, event, actor_id)
  values (p_sos, 'unmerged', (select auth.uid()));
  perform public.log_access('sos_unmerged', 'sos_requests', p_sos::text,
                            jsonb_build_object('was', v_was));
end $$;
revoke execute on function public.admin_sos_unmerge(uuid) from public, anon;
grant execute on function public.admin_sos_unmerge(uuid) to authenticated;

-- The main case ended: anything merged into it that is still open goes back to the boards.
create function public.sos_release_merged() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('rescued', 'safe_cancelled', 'dismissed')
     and old.status not in ('rescued', 'safe_cancelled', 'dismissed') then
    with back as (
      update public.sos_requests c set duplicate_of = null
       where c.duplicate_of = new.id and c.closed_at is null
         and c.status in ('received', 'assigned', 'en_route', 'on_site')
      returning c.id
    )
    insert into public.sos_events (sos_id, event, note)
    select b.id, 'unmerged_main_closed', new.id::text from back b;
  end if;
  return null;
exception when others then
  -- Never let this bookkeeping stop a case from being closed.
  return null;
end $$;
revoke execute on function public.sos_release_merged() from public, anon, authenticated;
create trigger sos_requests_release_merged after update of status on public.sos_requests
  for each row execute function public.sos_release_merged();

-- The sender of a merged case is shown the team that holds the case it was merged into.
-- Same signature and gate as A5's; only the case whose claim is read changes.
create or replace function public.sos_responder(p_sos_id uuid, p_token text default null)
returns table (unit_id uuid, unit_name text, org_name text, eta_band public.eta_band,
               eta_given_at timestamptz, accepted_at timestamptz, phone_available boolean,
               searching boolean, exhausted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sos_requests;
  v_case uuid;
begin
  s := public.sos_for_caller(p_sos_id, p_token);
  v_case := coalesce(s.duplicate_of, s.id);
  select cl.unit_id, u.unit_name, o.name, cl.eta_band, cl.eta_given_at, cl.claimed_at,
         (case when u.poc_phone_to_requester
                 then exists (select 1 from public.authority_unit_contacts ct
                               where ct.unit_id = u.id and ct.poc_phone is not null)
               else o.official_phone is not null end),
         false, false
    into unit_id, unit_name, org_name, eta_band, eta_given_at, accepted_at, phone_available,
         searching, exhausted
    from public.sos_claims cl
    join public.authority_units u on u.id = cl.unit_id
    join public.organizations o on o.id = u.org_id
   where cl.sos_id = v_case and cl.released_at is null;

  if unit_id is null then
    searching := true;
    exhausted := coalesce((select d.exhausted from public.sos_offer_now(v_case) d), true);
    phone_available := false;
  end if;
  -- The phone of the team is revealed per case; a merged sender asks through the main case's
  -- sender or the hotlines, so the button is not offered here.
  if s.duplicate_of is not null then
    phone_available := false;
  end if;
  return next;
end $$;

-------------------------------------------------------------------------------
-- 8. One call per export, as one JSON value. The API returns at most 1,000 rows of a table
--    function, which would cut a season's export short without saying so; a single value is
--    not cut, and the export is logged once.
-------------------------------------------------------------------------------
create function public.admin_export(
  p_what text, p_days integer default 30, p_anonymized boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform public.admin_only();
  if p_what = 'sos' then
    select jsonb_agg(to_jsonb(x)) into v_rows from public.admin_export_sos(p_days, p_anonymized) x;
  elsif p_what = 'reports' then
    select jsonb_agg(to_jsonb(x)) into v_rows from public.admin_export_reports(p_days) x;
  elsif p_what = 'alerts' then
    select jsonb_agg(to_jsonb(x)) into v_rows from public.admin_export_alerts(p_days) x;
  else
    raise exception 'Unknown export' using errcode = 'check_violation';
  end if;
  return coalesce(v_rows, '[]'::jsonb);
end $$;
revoke execute on function public.admin_export(text, integer, boolean) from public, anon;
grant execute on function public.admin_export(text, integer, boolean) to authenticated;
