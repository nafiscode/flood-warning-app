-- A4: sending a flood report and an SOS (spec 4.5, 4.6; safety rules 1, 4, 6, 7).
--
-- Safety rule 1 lives here. An SOS is written only by submit_sos(), which never raises for a
-- rate limit, a missing phone, an unknown tambon or a repeat: it merges a repeat into the open
-- case, flags a flood of new cases as suspected spam, and always stores and returns the case.
-- A report, by contrast, is a signed-in feature (spec section 3) and may be refused.
--
-- A sender without an account gets a secret token for their own case, because they have no
-- session row-level security could match. Only its SHA-256 hash is stored, so the token works
-- like a password: a database dump does not hand out access to open cases.

create extension if not exists pgcrypto with schema extensions;

-------------------------------------------------------------------------------
-- Settings an admin can change without a deployment (spam thresholds, report limit).
-------------------------------------------------------------------------------
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  note text,
  updated_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.system_settings enable row level security;
create policy "system_settings: admins read" on public.system_settings for select to authenticated
  using (public.is_admin());
create policy "system_settings: admins write" on public.system_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.system_settings (key, value, note) values
  ('sos_spam_threshold',
   '{"per_device_24h": 6, "per_phone_24h": 6}'::jsonb,
   'New cases above this many in 24 hours are flagged suspected_spam. They are still created and delivered (safety rule 1).'),
  ('report_limit',
   '{"per_user_hour": 12}'::jsonb,
   'Flood reports one person may send per hour. Reports may be refused; an SOS never is.');

-- Read a number from a setting, with a fallback if the row or key is gone.
create function public.setting_int(p_key text, p_field text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value ->> p_field)::integer from public.system_settings s
                   where s.key = p_key), p_default)
$$;
revoke execute on function public.setting_int(text, text, integer) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The token a sender without an account follows their own case with. An SOS for someone at a
-- watched place (on_behalf, on_site_phone) was already prepared in the watched-places migration.
-------------------------------------------------------------------------------
alter table public.sos_requests
  -- sha256 of the sender's case token; null for a case only its signed-in sender can reach
  add column token_hash bytea;

create index sos_requests_token_idx on public.sos_requests (token_hash) where token_hash is not null;

-------------------------------------------------------------------------------
-- Token helpers
-------------------------------------------------------------------------------
create function public.sos_token_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select case when p_token is null or char_length(p_token) < 20 then null
              else extensions.digest(p_token, 'sha256') end
$$;
revoke execute on function public.sos_token_hash(text) from public, anon, authenticated;

-- The case a caller may act on: their own (signed in), or one whose token they hold.
-- Raises rather than returning null, so a wrong token can never touch someone else's case.
create function public.sos_for_caller(p_sos_id uuid, p_token text) returns public.sos_requests
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sos_requests;
begin
  select * into s from public.sos_requests where id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if s.requester_id is not null and s.requester_id = (select auth.uid()) then
    return s;
  end if;
  if s.token_hash is not null and p_token is not null
     and s.token_hash = public.sos_token_hash(p_token) then
    return s;
  end if;
  raise exception 'Not your request' using errcode = 'insufficient_privilege';
end $$;
revoke execute on function public.sos_for_caller(uuid, text) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Sending an SOS. Never raises for anything the sender can get wrong.
-- Returns the case, and the token when a new case was created (the sender keeps it on the phone).
-- A repeat while a case is open merges into it: new location, new details, a timeline entry.
-------------------------------------------------------------------------------
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
      insert into public.sos_contacts (sos_id, contact_phone) values (open_id, phone)
        on conflict (sos_id) do update set contact_phone = coalesce(sos_contacts.contact_phone, excluded.contact_phone);
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
revoke execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint) from public;
grant execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint)
  to anon, authenticated;

-------------------------------------------------------------------------------
-- The details the sender may add after sending (spec 4.6). Never required, never pre-selected:
-- a field left out keeps whatever the case already has.
-------------------------------------------------------------------------------
create function public.sos_add_details(
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
    insert into public.sos_contacts (sos_id, contact_phone) values (s.id, phone)
      on conflict (sos_id) do update set contact_phone = excluded.contact_phone;
  end if;
  insert into public.sos_events (sos_id, event, actor_id) values (s.id, 'details_added', (select auth.uid()));
  update public.sos_requests set priority_score = public.sos_priority(s.id) where id = s.id;
  return (select status from public.sos_requests where id = s.id);
end $$;

-- Photos and a voice note, once they are in storage (paths only, never the bytes).
create function public.sos_add_media(
  p_sos_id uuid, p_token text default null,
  p_photos text[] default null, p_voice_url text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  kept text[];
begin
  select array_agg(x) into kept from (
    select x from (
      select unnest(s.photos) as x
      union all
      select unnest(coalesce(p_photos, '{}'::text[]))
    ) all_photos
    where x is not null
    limit 3
  ) first_three;
  update public.sos_requests
     set photos = coalesce(kept, photos),
         voice_url = coalesce(nullif(p_voice_url, ''), voice_url)
   where id = s.id;
  insert into public.sos_events (sos_id, event, actor_id) values (s.id, 'media_added', (select auth.uid()));
end $$;

-- Where the sender is now, while the case is open and their app is open (every 5 minutes).
create function public.sos_add_location(
  p_sos_id uuid, p_token text default null,
  p_lat double precision default null, p_lon double precision default null,
  p_accuracy_m real default null, p_battery_pct smallint default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  pt extensions.geometry(Point, 4326);
begin
  if s.status not in ('received', 'assigned', 'en_route') then return; end if;
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then return; end if;
  pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  insert into public.sos_locations (sos_id, point, accuracy_m) values (s.id, pt, p_accuracy_m);
  update public.sos_requests
     set point = pt, location_accuracy_m = p_accuracy_m, last_location_at = now(),
         tambon = coalesce(public.tambon_for_point(pt), tambon),
         battery_pct = coalesce(p_battery_pct, battery_pct)
   where id = s.id;
end $$;

-- "I'm safe now" and "Confirm I was rescued" (spec 4.6). Both close the case; only the sender
-- may use them, and a closed case is never reopened here.
create function public.sos_close(
  p_sos_id uuid, p_token text default null, p_rescued boolean default false, p_note text default null
) returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  uid uuid := (select auth.uid());
begin
  if s.status not in ('received', 'assigned', 'en_route') then return s.status; end if;
  update public.sos_requests
     set status = case when p_rescued then 'rescued' else 'safe_cancelled' end::public.sos_status,
         closed_at = now()
   where id = s.id;
  insert into public.sos_events (sos_id, event, actor_id, note)
    values (s.id, case when p_rescued then 'rescued' else 'safe_cancelled' end, uid, nullif(p_note, ''));
  if p_rescued then
    insert into public.rescue_confirmations (sos_id, method, confirmed_by, note)
      values (s.id, 'requester', uid, nullif(p_note, ''));
  end if;
  return (select status from public.sos_requests where id = s.id);
end $$;

-- The sender's own view of their case: status, timeline, which unit is on it. The suspected-spam
-- flag and the reviewing admins stay out of it (spec section 9: "SOS suspected-spam flag: user none").
create function public.sos_timeline(p_sos_id uuid, p_token text default null)
returns table (
  status public.sos_status, created_at timestamptz, closed_at timestamptz,
  hazard_type public.hazard_type, lat double precision, lon double precision,
  has_phone boolean, unit_name text, org_name text, photos integer, has_voice boolean,
  events jsonb
)
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
begin
  return query
  select s.status, s.created_at, s.closed_at, s.hazard_type,
         extensions.st_y(s.point), extensions.st_x(s.point),
         exists (select 1 from public.sos_contacts c
                 where c.sos_id = s.id and c.contact_phone is not null),
         (select u.unit_name from public.sos_claims cl
            join public.authority_units u on u.id = cl.unit_id
           where cl.sos_id = s.id and cl.released_at is null limit 1),
         (select o.name from public.sos_claims cl
            join public.authority_units u on u.id = cl.unit_id
            join public.organizations o on o.id = u.org_id
           where cl.sos_id = s.id and cl.released_at is null limit 1),
         cardinality(s.photos), s.voice_url is not null,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'event', e.event, 'at', e.created_at, 'note', e.note,
                     'unit', eu.unit_name) order by e.created_at)
                   from public.sos_events e
                   left join public.authority_units eu on eu.id = e.unit_id
                   where e.sos_id = s.id), '[]'::jsonb);
end $$;

revoke execute on function public.sos_add_details(
  uuid, text, public.hazard_type, smallint, jsonb, public.depth_ref, text, text, text, smallint) from public;
revoke execute on function public.sos_add_media(uuid, text, text[], text) from public;
revoke execute on function public.sos_add_location(
  uuid, text, double precision, double precision, real, smallint) from public;
revoke execute on function public.sos_close(uuid, text, boolean, text) from public;
revoke execute on function public.sos_timeline(uuid, text) from public;
grant execute on function public.sos_add_details(
  uuid, text, public.hazard_type, smallint, jsonb, public.depth_ref, text, text, text, smallint)
  to anon, authenticated;
grant execute on function public.sos_add_media(uuid, text, text[], text) to anon, authenticated;
grant execute on function public.sos_add_location(
  uuid, text, double precision, double precision, real, smallint) to anon, authenticated;
grant execute on function public.sos_close(uuid, text, boolean, text) to anon, authenticated;
grant execute on function public.sos_timeline(uuid, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Flood reports (spec 4.5). A signed-in feature: a report may be refused, unlike an SOS.
-- The row could be inserted straight through row-level security; it goes through a function so
-- the tambon, the rate limit and the moderation state are decided in one place.
-------------------------------------------------------------------------------
create function public.submit_report(
  p_lat double precision,
  p_lon double precision,
  p_depth_ref public.depth_ref default null,
  p_trend public.water_trend default null,
  p_road_access public.road_access default null,
  p_text text default null,
  p_hazard_type public.hazard_type default 'flood'
) returns table (report_id uuid, tambon_code text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pt extensions.geometry(Point, 4326);
  recent integer;
begin
  if uid is null then
    raise exception 'Sign in to send a report' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then
    raise exception 'A report needs a location' using errcode = 'invalid_parameter_value';
  end if;
  select count(*) into recent from public.reports r
   where r.reporter_id = uid and r.created_at > now() - interval '1 hour';
  if recent >= public.setting_int('report_limit', 'per_user_hour', 12) then
    raise exception 'Too many reports in the last hour' using errcode = 'too_many_rows';
  end if;
  pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  insert into public.reports (reporter_id, hazard_type, point, tambon, depth_ref, trend, road_access, text)
  values (uid, coalesce(p_hazard_type, 'flood'), pt, public.tambon_for_point(pt),
          p_depth_ref, p_trend, p_road_access, nullif(p_text, ''))
  returning reports.id, reports.tambon into report_id, tambon_code;
  return next;
end $$;
revoke execute on function public.submit_report(
  double precision, double precision, public.depth_ref, public.water_trend, public.road_access,
  text, public.hazard_type) from public, anon;
grant execute on function public.submit_report(
  double precision, double precision, public.depth_ref, public.water_trend, public.road_access,
  text, public.hazard_type) to authenticated;

-- Photos and a voice note for one's own report. Row-level security already limits the update to
-- the reporter's own rows; this keeps the paths append-only and leaves moderation untouched.
create policy "reports: own media" on public.reports for update to authenticated
  using (reporter_id = (select auth.uid()))
  with check (reporter_id = (select auth.uid()) and moderation_status = 'pending');

-------------------------------------------------------------------------------
-- Media storage. Two private buckets; nothing in them is public, and a moderated report photo is
-- served later by the admin console through a signed link (A6), never by a public URL.
-- An SOS is often sent by someone with no account, so the upload is allowed under a case id that
-- exists and is young: the id is a random uuid the sender was just given and nobody else knows.
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sos-media', 'sos-media', false, 3145728,
   array['image/jpeg', 'image/webp', 'image/png', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']),
  ('report-media', 'report-media', false, 3145728,
   array['image/jpeg', 'image/webp', 'image/png', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'])
on conflict (id) do nothing;

create policy "sos-media: sender uploads under a young case" on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'sos-media'
    and exists (
      select 1 from public.sos_requests s
      where s.id::text = (storage.foldername(name))[1]
        and s.created_at > now() - interval '24 hours'
    )
  );
create policy "sos-media: covering authority and admin read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'sos-media'
    and exists (
      select 1 from public.sos_requests s
      where s.id::text = (storage.foldername(name))[1]
        and (public.is_admin() or public.covers_tambon(s.tambon))
    )
  );

create policy "report-media: reporter uploads under own report" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-media'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.reporter_id = (select auth.uid())
    )
  );
create policy "report-media: reporter, covering authority and admin read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-media'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and (r.reporter_id = (select auth.uid()) or public.is_admin() or public.covers_tambon(r.tambon))
    )
  );
