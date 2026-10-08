-- A4 fix: adding a phone to an existing case.
--
-- Both functions used "insert ... on conflict (sos_id) do update". In plpgsql the conflict target
-- is substituted like any expression, and submit_sos has an output parameter named sos_id, so the
-- column reference was ambiguous and a repeat SOS carrying a phone number failed. Rule 1 allows
-- no such hole, so the phone is now added with an update, then an insert if there was no row.
-- Only these two bodies change; everything else in 20261008110925_a4_reports_and_sos.sql stands.

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
  p_battery_pct smallint default null
) returns table (sos_id uuid, token text, merged boolean, status public.sos_status, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  device text := nullif(left(coalesce(p_device_id, ''), 100), '');
  phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  site_phone text := nullif(regexp_replace(coalesce(p_on_site_phone, ''), '[^0-9+]', '', 'g'), '');
  pt extensions.geometry(Point, 4326);
  t text;
  open_id uuid;
  new_token text;
  recent integer;
  threshold integer;
  spam boolean := false;
begin
  -- A phone that doesn't fit the column's shape is dropped, never a reason to refuse.
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

  -- A case still open for this sender: same account, same device, or same phone.
  select s.id into open_id
  from public.sos_requests s
  left join public.sos_contacts c on c.sos_id = s.id
  where s.status in ('received', 'assigned', 'en_route')
    and s.duplicate_of is null
    and ((uid is not null and s.requester_id = uid)
         or (device is not null and s.device_id = device)
         or (phone is not null and (c.contact_phone = phone or c.on_site_phone = phone)))
  order by s.created_at desc
  limit 1;

  if open_id is not null then
    update public.sos_requests s
       set point = pt,
           location_accuracy_m = coalesce(p_accuracy_m, s.location_accuracy_m),
           location_text = coalesce(nullif(p_location_text, ''), s.location_text),
           tambon = coalesce(t, s.tambon),
           battery_pct = coalesce(p_battery_pct, s.battery_pct),
           device_id = coalesce(s.device_id, device),
           requester_id = coalesce(s.requester_id, uid),
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
    update public.sos_requests set priority_score = public.sos_priority(open_id) where id = open_id;
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
     on_behalf, on_behalf_note, battery_pct, token_hash)
  values
    (uid, device, pt, p_accuracy_m, nullif(p_location_text, ''), t,
     coalesce(p_on_behalf, false), nullif(p_on_behalf_note, ''), p_battery_pct,
     public.sos_token_hash(new_token))
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
  update public.sos_requests set priority_score = public.sos_priority(open_id) where id = open_id;
  perform public.flag_possible_duplicate(open_id);

  return query
    select s.id, new_token, false, s.status, s.created_at from public.sos_requests s where s.id = open_id;
end $$;

create or replace function public.sos_add_details(
  p_sos_id uuid,
  p_token text default null,
  p_hazard_type public.hazard_type default null,
  p_people_count smallint default null,
  p_vulnerable_flags jsonb default null,
  p_depth_ref public.depth_ref default null,
  p_injuries text default null,
  p_text text default null,
  p_phone text default null,
  p_battery_pct smallint default null
) returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if phone is not null and phone !~ '^\+?[0-9]{8,15}$' then phone := null; end if;
  update public.sos_requests
     set hazard_type = coalesce(p_hazard_type, hazard_type),
         people_count = coalesce(p_people_count, people_count),
         vulnerable_flags = coalesce(p_vulnerable_flags, vulnerable_flags),
         depth_ref = coalesce(p_depth_ref, depth_ref),
         injuries = coalesce(nullif(p_injuries, ''), injuries),
         text = coalesce(nullif(p_text, ''), text),
         battery_pct = coalesce(p_battery_pct, battery_pct)
   where id = s.id;
  if phone is not null then
    update public.sos_contacts c set contact_phone = phone where c.sos_id = s.id;
    if not found then
      insert into public.sos_contacts (sos_id, contact_phone) values (s.id, phone);
    end if;
  end if;
  insert into public.sos_events (sos_id, event, actor_id) values (s.id, 'details_added', (select auth.uid()));
  update public.sos_requests set priority_score = public.sos_priority(s.id) where id = s.id;
  return (select status from public.sos_requests where id = s.id);
end $$;
