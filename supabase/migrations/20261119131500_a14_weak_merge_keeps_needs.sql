-- A supplies request merged into an open rescue lost everything it asked for.
--
-- NOT APPLIED to jaga-dev: this touches the SOS path, so it is the owner's call (CLAUDE.md: stop
-- and ask where a safety rule is involved). Everything below is ready to apply as it stands.
--
-- submit_sos() merges a repeat in one of two ways. A STRONG match (same account, or the same case
-- token) trusts the sender: the case's position moves and the needs, the note and what they have
-- left are all updated. A WEAK match - the same phone or device and nothing more - keeps the case
-- where it is, on purpose, because a shared phone may be a different household and a pin that
-- moved could send a boat to the wrong house.
--
-- The weak branch recorded the new position in the case's history and told the teams, and that was
-- all. It never touched the needs. So a family that sent a rescue SOS and then asked, from the
-- same phone, for medicine had the second request reduced to one line in the case's event log:
-- the case's needs stayed empty and nothing a team reads said medicine had been asked for.
--
-- Safety rule 1 says a repeat from the same device or phone merges into that case as an update.
-- An update that drops what the sender asked for is not one, so the needs now carry over on a
-- weak match too: added to the case's list and never replacing it, with the note and "what we
-- have left" only filling a gap. The reason the position is kept does not apply to a list of what
-- to bring - a longer list cannot send a team anywhere - and an extra item on it is a far smaller
-- harm than a missing request for medicine. The event line still records that the request came
-- from the same phone, so a dispatcher can see where the extra needs came from.
--
-- The one judgement to check: on a shared phone, one household's needs can join another's open
-- case. The alternative is the request vanishing. If you would rather it vanished, this file can
-- simply be deleted.
--
-- Nothing else in submit_sos changes; the body is 20261015141300's word for word otherwise. No SOS
-- is rejected, delayed or made to wait on anything by this (safety rule 1).
--
-- Found 19 Nov 2026 by tests/rls/supplies.test.ts, "stays a rescue when a supply request follows
-- an SOS, and gains the needs", which sends both requests from one device and so takes the weak
-- path.

create or replace function public.submit_sos(
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
         coalesce((uid is not null and s.requester_id = uid)
                  or (key_hash is not null and s.token_hash = key_hash), false)
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
    -- What they are asking for DOES carry over, even on a weak match: the needs are added to the
    -- case's list, never replacing it, and the note only fills a gap. A pin that moved could send
    -- a boat to the wrong house, which is why the position above is kept - a longer list of what
    -- to bring cannot do that, and dropping it loses the whole content of a supplies request
    -- (safety rule 1: a repeat from the same device or phone merges into the case as an update).
    if what = 'supplies' then
      update public.sos_requests s
         set needs = public.sos_clean_needs(s.needs || wanted),
             needs_note = coalesce(s.needs_note, wanted_note),
             supplies_left = coalesce(s.supplies_left, left_now)
       where s.id = open_id;
    end if;
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
