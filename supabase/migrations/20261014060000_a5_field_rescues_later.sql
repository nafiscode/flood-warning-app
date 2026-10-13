-- Field rescues, the three things left open on 14 Oct (the owner: "build them").
--
--  1. Recording with no signal. A boat crew is often out of coverage exactly where it finds
--     people. The phone now keeps the record - position, time, number, photo, all taken at the
--     place - and sends it when the signal returns. The rule "at the moment, at the place" still
--     holds for the taking; what changes is that a record arriving late is accepted for a day
--     and ALWAYS waits for an admin, because the server cannot vouch for a time it did not see.
--  2. Telling the admins. A record that is held now reaches the admins' phones once, and their
--     bell shows how many are waiting.
--  3. (The impact page's separate line is in the app, not here.)

update public.system_settings
   set value = value || jsonb_build_object('queue_hours', 24)
 where key = 'field_rescues';

alter table public.field_rescues add column admins_notified_at timestamptz;

-------------------------------------------------------------------------------
-- 1. The same function as before, with a late arrival accepted and held.
-------------------------------------------------------------------------------
create or replace function public.authority_record_field_rescue(
  p_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_accuracy_m real,
  -- When the phone took the position. "At the moment" is checked against the server's clock.
  p_located_at timestamptz,
  p_people integer,
  p_vulnerable jsonb,
  p_phone text,
  p_photos text[],
  p_note text default null
) returns table (status public.field_rescue_status, holds text[], evidence text[], points integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  cfg jsonb := coalesce((select s.value from public.system_settings s where s.key = 'field_rescues'),
                        '{}'::jsonb);
  n_report_m integer := coalesce((cfg ->> 'report_m')::integer, 2000);
  n_sos_m integer := coalesce((cfg ->> 'sos_m')::integer, 1000);
  n_prone numeric := coalesce((cfg ->> 'flood_prone_pct')::numeric, 20);
  n_repeat_m integer := coalesce((cfg ->> 'repeat_m')::integer, 200);
  n_repeat_h integer := coalesce((cfg ->> 'repeat_hours')::integer, 24);
  n_cap integer := coalesce((cfg ->> 'daily_cap')::integer, 10);
  n_acc real := coalesce((cfg ->> 'max_accuracy_m')::real, 200);
  n_match integer := coalesce((cfg ->> 'match_sos_m')::integer, 300);
  n_age integer := coalesce((cfg ->> 'max_age_minutes')::integer, 15);
  n_queue_h integer := coalesce((cfg ->> 'queue_hours')::integer, 24);
  v_point extensions.geometry;
  v_tambon text;
  v_unit uuid;
  v_covers boolean;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_photos text[];
  v_evidence text[] := '{}';
  v_holds text[] := '{}';
  v_status public.field_rescue_status;
  v_points integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'The position of the rescue is required' using errcode = 'check_violation';
  end if;
  -- A record made where there was no signal arrives late, with the time the phone took the
  -- position. It is accepted for a day, and always goes to an admin (below): the server cannot
  -- vouch for a time it did not see.
  if p_located_at is null or p_located_at < now() - make_interval(hours => n_queue_h)
     or p_located_at > now() + interval '2 minutes' then
    raise exception 'The position must be taken now, at the place of the rescue'
      using errcode = 'check_violation';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'A phone number for the rescued person is required'
      using errcode = 'check_violation';
  end if;
  if p_people is null or p_people not between 1 and 200 then
    raise exception 'Say how many people were rescued' using errcode = 'check_violation';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  select t.code into v_tambon from public.tambons t
   where extensions.st_contains(t.geom, v_point) limit 1;
  if v_tambon is null then
    raise exception 'That position is outside the area Jaga covers' using errcode = 'check_violation';
  end if;

  -- The caller's verified team. Someone with several teams records for the one the photo was
  -- filed under (photos are kept as <unit>/<rescue>/<file>).
  select u.id, exists (select 1 from public.authority_coverage c
                        where c.unit_id = u.id and c.tambon = v_tambon)
    into v_unit, v_covers
    from public.authority_units u
   where u.user_id = uid and u.status = 'verified'
     and u.id::text = split_part(coalesce(p_photos[1], ''), '/', 1)
   limit 1;
  if v_unit is null then
    raise exception 'Only a verified team can record a rescue' using errcode = 'insufficient_privilege';
  end if;

  -- A photo that was never uploaded is not evidence of anything.
  select coalesce(array_agg(o.name order by o.name), '{}') into v_photos
    from (select o.name from storage.objects o
           where o.bucket_id = 'field-media'
             and o.name = any (coalesce(p_photos, '{}'))
             and o.name like v_unit::text || '/' || p_id::text || '/%'
           order by o.name limit 3) o;
  if cardinality(v_photos) = 0 then
    raise exception 'A photo of the rescue is required' using errcode = 'check_violation';
  end if;

  -- Reasons to expect a flood here.
  if exists (select 1 from public.alerts a join public.alert_tambons at on at.alert_id = a.id
              where at.tambon = v_tambon and not a.is_drill
                and a.superseded_by is null and a.cancelled_at is null
                and a.level in ('watch', 'warning', 'evacuate')) then
    v_evidence := array_append(v_evidence, 'alert_in_force');
  end if;
  if exists (select 1 from public.standing_flood_reports() r
              where extensions.st_dwithin(r.point::extensions.geography,
                                          v_point::extensions.geography, n_report_m)) then
    v_evidence := array_append(v_evidence, 'flood_report_near');
  end if;
  if exists (select 1 from public.sos_requests s
              where s.created_at > now() - interval '72 hours'
                and extensions.st_dwithin(s.point::extensions.geography,
                                          v_point::extensions.geography, n_sos_m)) then
    v_evidence := array_append(v_evidence, 'sos_near');
  end if;
  if exists (select 1 from public.hazard_by_tambon h
              where h.tambon_code = v_tambon
                and coalesce(h.high_pct, 0) + coalesce(h.medium_pct, 0) + coalesce(h.low_pct, 0)
                    >= n_prone) then
    v_evidence := array_append(v_evidence, 'flood_prone_area');
  end if;

  -- Reasons to have a person look first.
  if cardinality(v_evidence) = 0 then
    v_holds := array_append(v_holds, 'no_flood_evidence');
  end if;
  if not v_covers then
    v_holds := array_append(v_holds, 'outside_coverage');
  end if;
  if p_accuracy_m is null or p_accuracy_m > n_acc then
    v_holds := array_append(v_holds, 'vague_position');
  end if;
  if exists (select 1 from public.field_rescues f
              where f.unit_id = v_unit and f.status <> 'rejected'
                and f.created_at > now() - make_interval(hours => n_repeat_h)
                and extensions.st_dwithin(f.point::extensions.geography,
                                          v_point::extensions.geography, n_repeat_m)) then
    v_holds := array_append(v_holds, 'repeat_nearby');
  end if;
  if (select count(*) from public.field_rescues f
       where f.unit_id = v_unit and f.created_at > now() - interval '24 hours') >= n_cap then
    v_holds := array_append(v_holds, 'many_today');
  end if;
  if exists (select 1 from public.field_rescue_contacts c
               join public.field_rescues f on f.id = c.rescue_id
              where c.contact_phone = v_phone and f.status <> 'rejected'
                and f.created_at > now() - interval '30 days') then
    v_holds := array_append(v_holds, 'phone_used_before');
  end if;
  if p_located_at < now() - make_interval(mins => n_age) then
    v_holds := array_append(v_holds, 'sent_later');
  end if;
  -- Someone here did ask through the app: that request is where this rescue belongs.
  if exists (select 1 from public.sos_requests s
              where s.closed_at is null and s.status in ('received', 'assigned', 'en_route', 'on_site')
                and extensions.st_dwithin(s.point::extensions.geography,
                                          v_point::extensions.geography, n_match)) then
    v_holds := array_append(v_holds, 'open_request_here');
  end if;

  v_status := case when cardinality(v_holds) = 0 then 'counted' else 'pending' end;
  insert into public.field_rescues (id, unit_id, recorded_by, point, accuracy_m, tambon,
                                    people_count, vulnerable_flags, note, photos, status, checks)
  values (p_id, v_unit, uid, v_point, p_accuracy_m, v_tambon, p_people,
          coalesce(p_vulnerable, '{}'::jsonb), nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          v_photos, v_status,
          jsonb_build_object('evidence', to_jsonb(v_evidence), 'holds', to_jsonb(v_holds),
                             'located_at', p_located_at));
  insert into public.field_rescue_contacts (rescue_id, contact_phone) values (p_id, v_phone);
  if v_status = 'counted' then
    v_points := public.award_field_points(p_id);
  end if;
  perform public.log_access('field_rescue_recorded', 'field_rescues', p_id::text,
    jsonb_build_object('unit', v_unit, 'status', v_status, 'holds', to_jsonb(v_holds),
                       'evidence', to_jsonb(v_evidence), 'people', p_people));
  return query select v_status, v_holds, v_evidence, v_points;
end $$;

-------------------------------------------------------------------------------
-- 2a. The admins' bell: how many are waiting, and the newest, so the bell knows when there is
--     something new. Counts only; nothing to log.
-------------------------------------------------------------------------------
create function public.admin_field_waiting()
returns table (waiting integer, newest_id uuid, newest_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select count(*)::integer,
         (select f.id from public.field_rescues f where f.status = 'pending'
           order by f.created_at desc limit 1),
         max(f.created_at)
    from public.field_rescues f
   where f.status = 'pending';
end $$;
revoke execute on function public.admin_field_waiting() from public, anon;
grant execute on function public.admin_field_waiting() to authenticated;

-------------------------------------------------------------------------------
-- 2b. The admins' phones, for one held record, once. Asked by Jaga's own server with the push
--     gate's token (as push_due is): a team's session must never be handed the admins' push
--     addresses. It names the team and the tambon, never the place or the person.
-------------------------------------------------------------------------------
create function public.push_field_held(p_token text, p_rescue uuid)
returns table (endpoint text, keys jsonb, locale text, unit_name text,
               tambon_th text, tambon_en text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.field_rescues f set admins_notified_at = now()
   where f.id = p_rescue and f.status = 'pending' and f.admins_notified_at is null;
  get diagnostics fresh = row_count;
  if fresh = 0 then
    return;
  end if;
  return query
  select ps.endpoint, ps.keys, ps.locale, u.unit_name, t.name_th, t.name_en
    from public.field_rescues f
    join public.authority_units u on u.id = f.unit_id
    join public.tambons t on t.code = f.tambon
    join public.profiles p on p.role in ('admin', 'super_admin')
    join public.push_subscriptions ps on ps.user_id = p.user_id
   where f.id = p_rescue;
end $$;
revoke execute on function public.push_field_held(text, uuid) from public;
grant execute on function public.push_field_held(text, uuid) to anon, authenticated;
