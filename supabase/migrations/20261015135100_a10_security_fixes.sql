-- A10 security review, database fixes (docs/security-review-2026.md).
--
-- 1. A repeat SOS matched only by phone number or device id no longer moves the open case or
--    adopts the caller as its sender. Only the same account, or the case's own key (the token the
--    sender's phone keeps), may change where a case is and who follows it. A phone or device match
--    still merges (safety rule 1): the new position is added to the case's history and the teams
--    are told, but the case stays where it is; a position more than `weak_far_m` away from the case
--    becomes a case of its own, counted for the spam flag like any other, and still delivered.
--    submit_sos also stops refusing a request whose battery or typed location does not fit a
--    column, and no longer rolls a request back if the priority or duplicate check fails.
-- 2. Reports are written only through submit_report; a reporter may add photos and a voice note to
--    a report still pending, and nothing else (no undoing an admin's "hidden", no new date).
-- 3. Teams change claims only through the dispatch functions (no direct writes to sos_claims).
-- 4. households_in_tambon, which handed out household phones without logging each one, is closed;
--    teams use authority_households and the logged reveal_household_phone.
-- 5. A team may reveal another unit's POC phone only when that unit is verified.
-- 6. Write grants nobody's policy uses are taken back, and TRUNCATE everywhere (RLS does not apply
--    to TRUNCATE).

-------------------------------------------------------------------------------
-- 1. submit_sos
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('sos_merge', '{"weak_far_m": 1000}'::jsonb,
   'A repeat request matched only by phone number or device id is merged into the open case when it is within weak_far_m metres of it, and becomes a case of its own beyond that. Either way the open case''s position is never moved by such a match.')
on conflict (key) do nothing;

drop function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint,
  text, text[], text, text, smallint);

create function public.submit_sos(
  p_lat double precision,
  p_lon double precision,
  p_accuracy_m real default null,
  p_location_text text default null,
  p_device_id text default null,
  p_phone text default null,
  p_on_behalf boolean default false,
  p_on_behalf_note text default null,
  p_on_site_phone text default null,
  p_battery_pct smallint default null,
  p_kind text default 'rescue',
  p_needs text[] default null,
  p_needs_note text default null,
  p_supplies_left text default null,
  p_people_count smallint default null,
  p_token text default null
) returns table (sos_id uuid, token text, merged boolean, status public.sos_status, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  device text := nullif(left(coalesce(p_device_id, ''), 100), '');
  phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  site_phone text := nullif(regexp_replace(coalesce(p_on_site_phone, ''), '[^0-9+]', '', 'g'), '');
  key_hash bytea := public.sos_token_hash(p_token);
  -- Values that do not fit a column are dropped, never a reason to refuse.
  battery smallint := case when p_battery_pct between 0 and 100 then p_battery_pct end;
  place_text text := nullif(left(btrim(coalesce(p_location_text, '')), 300), '');
  behalf_note text := nullif(left(btrim(coalesce(p_on_behalf_note, '')), 300), '');
  -- Anything that is not plainly a supply request is a rescue.
  what public.sos_kind := case when p_kind = 'supplies' then 'supplies' else 'rescue' end;
  wanted text[] := public.sos_clean_needs(p_needs);
  wanted_note text := nullif(left(btrim(coalesce(p_needs_note, '')), 500), '');
  left_now text := case when p_supplies_left in ('none', 'today', 'days') then p_supplies_left end;
  people smallint := case when p_people_count between 1 and 500 then p_people_count end;
  far_m integer := public.setting_int('sos_merge', 'weak_far_m', 1000);
  pt extensions.geometry(Point, 4326);
  t text;
  open_id uuid;
  open_kind public.sos_kind;
  open_point extensions.geometry(Point, 4326);
  strong boolean;
  away_m double precision;
  new_token text;
  recent integer;
  threshold integer;
  spam boolean := false;
begin
  if phone is not null and phone !~ '^\+?[0-9]{8,15}$' then phone := null; end if;
  if site_phone is not null and site_phone !~ '^\+?[0-9]{8,15}$' then site_phone := null; end if;

  if p_lat is not null and p_lon is not null
     and abs(p_lat) <= 90 and abs(p_lon) <= 180 then
    pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  end if;
  if pt is null then
    -- Should not happen: the form always sends a point (GPS, a pin, or the chosen area).
    raise exception 'An SOS needs a location' using errcode = 'invalid_parameter_value';
  end if;
  t := public.tambon_for_point(pt);

  -- A case still open for this sender: same account, the case's own key, same device, or same
  -- phone. A match by account or key is "strong" and is preferred.
  select s.id, s.kind, s.point,
         ((uid is not null and s.requester_id = uid) or (key_hash is not null and s.token_hash = key_hash))
    into open_id, open_kind, open_point, strong
  from public.sos_requests s
  left join public.sos_contacts c on c.sos_id = s.id
  where s.status in ('received', 'assigned', 'en_route', 'on_site')
    and s.duplicate_of is null
    and ((uid is not null and s.requester_id = uid)
         or (key_hash is not null and s.token_hash = key_hash)
         or (device is not null and s.device_id = device)
         or (phone is not null and (c.contact_phone = phone or c.on_site_phone = phone)))
  order by ((uid is not null and s.requester_id = uid)
            or (key_hash is not null and s.token_hash = key_hash)) desc,
           s.created_at desc
  limit 1;

  if open_id is not null and not strong then
    away_m := extensions.st_distance(open_point::extensions.geography, pt::extensions.geography);
    if away_m > far_m then
      -- Somewhere else: not this case. A new case below, flagged by the usual checks.
      open_id := null;
    end if;
  end if;

  if open_id is not null and strong then
    update public.sos_requests s
       set point = pt,
           location_accuracy_m = coalesce(p_accuracy_m, s.location_accuracy_m),
           location_text = coalesce(place_text, s.location_text),
           tambon = coalesce(t, s.tambon),
           battery_pct = coalesce(battery, s.battery_pct),
           device_id = coalesce(s.device_id, device),
           requester_id = coalesce(s.requester_id, uid),
           people_count = coalesce(people, s.people_count),
           needs = case when what = 'supplies'
                        then public.sos_clean_needs(s.needs || wanted) else s.needs end,
           needs_note = case when what = 'supplies'
                             then coalesce(wanted_note, s.needs_note) else s.needs_note end,
           supplies_left = case when what = 'supplies'
                                then coalesce(left_now, s.supplies_left) else s.supplies_left end,
           last_location_at = now()
     where s.id = open_id;
    insert into public.sos_locations (sos_id, point, accuracy_m) values (open_id, pt, p_accuracy_m);
    if phone is not null then
      update public.sos_contacts c set contact_phone = coalesce(c.contact_phone, phone)
       where c.sos_id = open_id;
      if not found then
        insert into public.sos_contacts (sos_id, contact_phone) values (open_id, phone);
      end if;
    end if;
    insert into public.sos_events (sos_id, event, actor_id, note)
      values (open_id, 'repeat_merged', uid, 'A new request from the same sender was added to this case.');
  elsif open_id is not null then
    -- Same phone or device only: the position goes into the case's history and the teams are
    -- told; where the case is, and who follows it, stay as they were.
    insert into public.sos_locations (sos_id, point, accuracy_m) values (open_id, pt, p_accuracy_m);
    insert into public.sos_events (sos_id, event, actor_id, note)
      values (open_id, 'repeat_merged', uid,
              format('Another request from the same phone or device, %s m from this case. The case position was kept.',
                     round(away_m)::integer));
  end if;

  if open_id is not null then
    if what = 'rescue' and open_kind = 'supplies' then
      -- They asked for food and water before; now they ask for rescue. The case says so.
      perform public.sos_escalate(open_id);
    end if;
    begin
      update public.sos_requests set priority_score = public.sos_priority(open_id) where id = open_id;
    exception when others then
      perform public.log_access('sos_priority_failed', 'sos_requests', open_id::text);
    end;
    return query
      select s.id, null::text, true, s.status, s.created_at from public.sos_requests s where s.id = open_id;
    return;
  end if;

  -- A new case. Count this sender's recent cases first: above the threshold the case is flagged
  -- for admins, and still created and delivered (safety rule 1).
  threshold := least(public.setting_int('sos_spam_threshold', 'per_device_24h', 6),
                     public.setting_int('sos_spam_threshold', 'per_phone_24h', 6));
  select count(*) into recent
  from public.sos_requests s
  left join public.sos_contacts c on c.sos_id = s.id
  where s.created_at > now() - interval '24 hours'
    and ((device is not null and s.device_id = device)
         or (phone is not null and c.contact_phone = phone)
         or (uid is not null and s.requester_id = uid));
  spam := recent >= threshold;

  new_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.sos_requests
    (requester_id, device_id, point, location_accuracy_m, location_text, tambon,
     on_behalf, on_behalf_note, battery_pct, token_hash,
     kind, needs, needs_note, supplies_left, people_count)
  values
    (uid, device, pt, p_accuracy_m, place_text, t,
     coalesce(p_on_behalf, false), behalf_note, battery,
     public.sos_token_hash(new_token),
     what,
     case when what = 'supplies' then wanted else '{}' end,
     case when what = 'supplies' then wanted_note end,
     case when what = 'supplies' then left_now end,
     people)
  returning id into open_id;

  if phone is not null or site_phone is not null then
    insert into public.sos_contacts (sos_id, contact_phone, on_site_phone)
      values (open_id, phone, site_phone);
  end if;
  insert into public.sos_locations (sos_id, point, accuracy_m) values (open_id, pt, p_accuracy_m);
  insert into public.sos_events (sos_id, event, actor_id) values (open_id, 'received', uid);
  insert into public.sos_review (sos_id, suspected_spam, spam_reason)
    values (open_id, spam,
            case when spam then format('%s requests from this sender in 24 hours', recent + 1) end);
  -- Neither check may cost a request: a failure is logged and the request stands.
  begin
    update public.sos_requests set priority_score = public.sos_priority(open_id) where id = open_id;
  exception when others then
    perform public.log_access('sos_priority_failed', 'sos_requests', open_id::text);
  end;
  begin
    perform public.flag_possible_duplicate(open_id);
  exception when others then
    perform public.log_access('sos_duplicate_check_failed', 'sos_requests', open_id::text);
  end;

  return query
    select s.id, new_token, false, s.status, s.created_at from public.sos_requests s where s.id = open_id;
end $$;

revoke execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint,
  text, text[], text, text, smallint, text) from public;
grant execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint,
  text, text[], text, text, smallint, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 2. Reports
-------------------------------------------------------------------------------
revoke insert, update on public.reports from authenticated, anon;
grant update (photos, voice_url) on public.reports to authenticated;
drop policy if exists "reports: users submit their own" on public.reports;
alter policy "reports: own media" on public.reports
  using (reporter_id = (select auth.uid()) and moderation_status = 'pending');

-------------------------------------------------------------------------------
-- 3. Claims
-------------------------------------------------------------------------------
revoke insert, update, delete on public.sos_claims from authenticated, anon;
drop policy if exists "sos_claims: verified unit claims in coverage" on public.sos_claims;
drop policy if exists "sos_claims: own unit releases" on public.sos_claims;

-------------------------------------------------------------------------------
-- 4. The old bulk household read
-------------------------------------------------------------------------------
revoke execute on function public.households_in_tambon(text) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 5. Another unit's POC phone: only a verified unit's
-------------------------------------------------------------------------------
create or replace function public.reveal_poc_phone(p_unit_id uuid)
returns table (poc_name text, poc_phone text)
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or (
      exists (select 1 from public.authority_units target
               where target.id = p_unit_id and target.status = 'verified')
      and exists (
        select 1
        from public.authority_coverage theirs
        join public.authority_coverage mine on mine.tambon = theirs.tambon
        join public.authority_units u on u.id = mine.unit_id
        where theirs.unit_id = p_unit_id
          and u.user_id = (select auth.uid())
          and u.status = 'verified'))) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $$;

-------------------------------------------------------------------------------
-- 6. Grants nobody's policy uses
-------------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

revoke insert, update, delete on public.announcements from anon;
revoke delete on public.announcements from authenticated;
revoke update on public.authority_coverage from authenticated;
revoke delete on public.authority_units from authenticated;
revoke update, delete on public.handover_notes from authenticated;
revoke insert, update, delete on public.notice_reads from anon;
revoke delete on public.organizations from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.rescue_confirmations from authenticated;
revoke insert, update, delete on public.sos_contacts from authenticated;
revoke insert, update, delete on public.sos_events from authenticated;
revoke insert, update, delete on public.sos_locations from authenticated;
revoke insert, update, delete on public.sos_offers from anon, authenticated;
revoke insert, delete on public.sos_requests from authenticated;
revoke insert, delete on public.sos_review from authenticated;
revoke insert, update, delete on public.system_settings from anon;
revoke insert, delete on public.system_settings from authenticated;
