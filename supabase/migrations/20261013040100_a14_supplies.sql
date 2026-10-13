-- A14 (2/2): requests for food, water and other essentials (spec 4.10, decisions of 13 October).
--
-- Some people are not in danger and cannot leave: the house stands above the water, the road is
-- gone, and the food and drinking water run out. They do not need a boat to take them away; they
-- need someone to bring things. Such a request is the same record as an SOS with a different
-- `kind`, so it inherits everything an SOS already has - never refused, merged with the sender's
-- open case, sent from the offline queue, followed with a token and no account, a photo and the
-- sender's own word to close it.
--
-- What differs, and why:
--  * **Its own relay.** It is offered to teams that registered as distributors, then to
--    coordinators, then to the admins. Rescue teams see it on their board and may take it, but
--    their alarm never rings for it: a boat is not called off a rescue to carry rice.
--  * **A longer window.** Ten minutes a team by default, not sixty seconds.
--  * **It can turn into a rescue at any moment.** One tap by the sender, or a plain SOS from the
--    same phone, and the same case is a rescue case, back in the rescue relay at once.
--  * **Fewer points**, so that delivering never pays a team better than rescuing.
--
-- Jaga carries the request to a verified team. It holds no goods and collects none (spec 1).

-------------------------------------------------------------------------------
-- The request itself.
-------------------------------------------------------------------------------
alter table public.sos_requests
  add column kind public.sos_kind not null default 'rescue',
  -- What is asked for, from a fixed list so a team reads it at a glance in any language.
  add column needs text[] not null default '{}'
    check (needs <@ array['water', 'food', 'baby', 'medicine', 'clothes', 'hygiene', 'light', 'other']
           and cardinality(needs) <= 8),
  add column needs_note text check (char_length(needs_note) <= 500),
  -- How long what they have will last: nothing left, enough for today, enough for a few days.
  add column supplies_left text check (supplies_left in ('none', 'today', 'days'));

create index sos_requests_kind_open_idx on public.sos_requests (kind, created_at desc)
  where status in ('received', 'assigned', 'en_route', 'on_site');

-- The settings admins own: the window, and what a confirmed delivery is worth.
update public.system_settings
   set value = value || '{"supplies_seconds": 600}'::jsonb
 where key = 'dispatch_windows' and not value ? 'supplies_seconds';
update public.system_settings
   set value = value || '{"supplies_per_case": 5, "supplies_per_person": 1}'::jsonb
 where key = 'hero_points' and not value ? 'supplies_per_case';

-- The needs a caller sent, cut down to the ones that exist. Never a reason to refuse a request.
create function public.sos_clean_needs(p_needs text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct n order by n), '{}')
    from unnest(coalesce(p_needs, '{}')) n
   where n in ('water', 'food', 'baby', 'medicine', 'clothes', 'hygiene', 'light', 'other')
$$;

-- Running out entirely counts for something in the order of the board.
create or replace function public.sos_priority(p_sos_id uuid) returns real
language sql stable set search_path = '' as $$
  select (
      least(10, 2 * (select count(*) from jsonb_each(s.vulnerable_flags) f where f.value = 'true'::jsonb))
    + case s.depth_ref
        when 'ankle' then 1 when 'knee' then 2 when 'waist' then 4 when 'chest' then 6
        when 'above_head' then 8 when 'roof' then 10 else 0 end
    + least(10, 0.5 * coalesce(s.people_count, 1))
    + least(12, extract(epoch from (now() - s.created_at)) / 600.0)
    + case s.supplies_left when 'none' then 4 when 'today' then 2 else 0 end
  )::real
  from public.sos_requests s
  where s.id = p_sos_id
$$;

-------------------------------------------------------------------------------
-- The queue, for either kind. A rescue case is built exactly as before. A supply request asks
-- the distributors first and the coordinators second; teams with neither are not in its queue.
-------------------------------------------------------------------------------
create or replace function public.sos_build_offers(p_sos_id uuid, p_round smallint default 1,
                                                   p_skip_unit uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  first_tier public.authority_capability;
  made integer := 0;
begin
  select * into s from public.sos_requests where id = p_sos_id;
  if not found or s.tambon is null then
    return 0;
  end if;
  first_tier := case when s.kind = 'supplies' then 'supplies' else 'rescue' end;

  insert into public.sos_offers (sos_id, unit_id, tier, round, queue_pos)
  select p_sos_id, q.id, q.tier, p_round,
         (row_number() over (order by (q.tier = 'coordination'), q.on_duty desc,
                                      q.distance_m nulls last, q.open_cases, q.created_at))::smallint
    from (
      select u.id,
             (case when first_tier = any (u.capabilities) then first_tier::text
                   else 'coordination' end)::public.offer_tier as tier,
             u.on_duty,
             u.created_at,
             (select count(*)
                from public.sos_claims c
                join public.sos_requests s2 on s2.id = c.sos_id
               where c.unit_id = u.id and c.released_at is null
                 and s2.status in ('received', 'assigned', 'en_route', 'on_site')) as open_cases,
             (select min(extensions.st_distance(t.geom::extensions.geography,
                                                s.point::extensions.geography))
                from public.authority_coverage ac
                join public.tambons t on t.code = ac.tambon
               where ac.unit_id = u.id) as distance_m
        from public.authority_units u
       where u.status = 'verified'
         and (u.capabilities && array[first_tier, 'coordination']::public.authority_capability[])
         and (p_skip_unit is null or u.id <> p_skip_unit)
         and exists (select 1 from public.authority_coverage ac
                      where ac.unit_id = u.id and ac.tambon = s.tambon)
    ) q
  on conflict (sos_id, unit_id, round) do nothing;

  get diagnostics made = row_count;
  if made > 0 then
    update public.sos_requests r set dispatch_started_at = now() where r.id = p_sos_id;
  end if;
  return made;
end $$;

-- Who is being asked right now. Unchanged but for the window: every team asked about a supply
-- request holds it for the supplies window, coordinators included.
create or replace function public.sos_offer_now(p_sos_id uuid)
returns table (dispatch_unit uuid, dispatch_tier public.offer_tier, queue_pos smallint,
               offered_at timestamptz, expires_at timestamptz, exhausted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  started timestamptz;
  what public.sos_kind;
  at timestamptz;
  ends timestamptz;
  w_rescue integer := public.setting_int('dispatch_windows', 'rescue_seconds', 60);
  w_coord integer := public.setting_int('dispatch_windows', 'coordination_seconds', 90);
  w_supplies integer := public.setting_int('dispatch_windows', 'supplies_seconds', 600);
  o record;
  current_round smallint;
begin
  select r.dispatch_started_at, r.kind into started, what
    from public.sos_requests r where r.id = p_sos_id;
  if started is null then
    return;
  end if;
  select max(x.round) into current_round from public.sos_offers x where x.sos_id = p_sos_id;
  if current_round is null then
    return;
  end if;

  at := started;
  for o in select * from public.sos_offers x
            where x.sos_id = p_sos_id and x.round = current_round
            order by x.queue_pos loop
    -- Taken: nobody is being asked any more.
    if o.response = 'accepted' then
      return;
    end if;
    ends := at + make_interval(secs => case when what = 'supplies' then w_supplies
                                            when o.tier = 'rescue' then w_rescue
                                            else w_coord end);
    if o.response = 'declined' and o.responded_at is not null and o.responded_at < ends then
      -- A decline moves the case on at once, rather than burning the rest of the window.
      at := greatest(o.responded_at, at);
      continue;
    end if;
    if ends > now() then
      dispatch_unit := o.unit_id;
      dispatch_tier := o.tier;
      queue_pos := o.queue_pos;
      offered_at := at;
      expires_at := ends;
      exhausted := false;
      return next;
      return;
    end if;
    at := ends;
  end loop;

  -- The queue ran out: the case belongs to the admins' monitor, and stays open to every unit.
  dispatch_unit := null;
  dispatch_tier := null;
  queue_pos := null;
  offered_at := null;
  expires_at := null;
  exhausted := true;
  return next;
end $$;

-------------------------------------------------------------------------------
-- A supply request becomes a rescue. The team bringing things is set aside (it can accept
-- again), the case goes back to "received" and the rescue relay starts at once. Written to the
-- access log, so the admins see that it happened.
-------------------------------------------------------------------------------
create function public.sos_escalate(p_sos_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  held uuid;
  next_round smallint;
begin
  update public.sos_requests r set kind = 'rescue'
   where r.id = p_sos_id and r.kind = 'supplies'
     and (r.status in ('received', 'assigned', 'en_route', 'on_site')
          or (r.status = 'rescued' and r.closed_at is null));
  if not found then
    return false;
  end if;

  update public.sos_claims c
     set released_at = now(), release_reason = 'The requester now needs rescue'
   where c.sos_id = p_sos_id and c.released_at is null
   returning c.unit_id into held;
  update public.sos_requests r set status = 'received' where r.id = p_sos_id;

  insert into public.sos_events (sos_id, event, actor_id, unit_id)
  values (p_sos_id, 'needs_rescue', (select auth.uid()), held);
  update public.sos_requests set priority_score = public.sos_priority(p_sos_id) where id = p_sos_id;
  perform public.log_access('supply_request_escalated', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('unit', held));

  select (coalesce(max(o.round), 0) + 1)::smallint into next_round
    from public.sos_offers o where o.sos_id = p_sos_id;
  begin
    perform public.sos_build_offers(p_sos_id, next_round, null);
  exception when others then
    -- As on insert: a routing fault must never cost the request. It is open and on every board.
    perform public.log_access('dispatch_failed', 'sos_requests', p_sos_id::text,
                              jsonb_build_object('error', sqlerrm, 'at', 'escalate'));
  end;
  return true;
end $$;
revoke execute on function public.sos_escalate(uuid) from public, anon, authenticated;

-- The sender's own button: "It got worse, I need rescue".
create function public.sos_need_rescue(p_sos_id uuid, p_token text default null)
returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
begin
  perform public.sos_escalate(s.id);
  return (select r.status from public.sos_requests r where r.id = s.id);
end $$;
revoke execute on function public.sos_need_rescue(uuid, text) from public;
grant execute on function public.sos_need_rescue(uuid, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Sending. The signature grows, so the old function is dropped and made again; a rescue SOS
-- sent the old way behaves exactly as it did, with one repair: a case whose team has arrived
-- ("on_site") is still open, so a repeat now merges into it instead of opening a second case.
--
-- What is new when a sender already has an open case:
--  * a plain SOS into an open supply request turns that request into a rescue;
--  * a supply request into an open rescue case stays a rescue case and gains the needs.
-------------------------------------------------------------------------------
drop function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint);

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
  p_people_count smallint default null
) returns table (sos_id uuid, token text, merged boolean, status public.sos_status, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  device text := nullif(left(coalesce(p_device_id, ''), 100), '');
  phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  site_phone text := nullif(regexp_replace(coalesce(p_on_site_phone, ''), '[^0-9+]', '', 'g'), '');
  -- Anything that is not plainly a supply request is a rescue.
  what public.sos_kind := case when p_kind = 'supplies' then 'supplies' else 'rescue' end;
  wanted text[] := public.sos_clean_needs(p_needs);
  wanted_note text := nullif(left(btrim(coalesce(p_needs_note, '')), 500), '');
  left_now text := case when p_supplies_left in ('none', 'today', 'days') then p_supplies_left end;
  people smallint := case when p_people_count between 1 and 500 then p_people_count end;
  pt extensions.geometry(Point, 4326);
  t text;
  open_id uuid;
  open_kind public.sos_kind;
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
  select s.id, s.kind into open_id, open_kind
  from public.sos_requests s
  left join public.sos_contacts c on c.sos_id = s.id
  where s.status in ('received', 'assigned', 'en_route', 'on_site')
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
    if what = 'rescue' and open_kind = 'supplies' then
      -- They asked for food and water before; now they ask for rescue. The case says so.
      perform public.sos_escalate(open_id);
    end if;
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
     on_behalf, on_behalf_note, battery_pct, token_hash,
     kind, needs, needs_note, supplies_left, people_count)
  values
    (uid, device, pt, p_accuracy_m, nullif(p_location_text, ''), t,
     coalesce(p_on_behalf, false), nullif(p_on_behalf_note, ''), p_battery_pct,
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
  update public.sos_requests set priority_score = public.sos_priority(open_id) where id = open_id;
  perform public.flag_possible_duplicate(open_id);

  return query
    select s.id, new_token, false, s.status, s.created_at from public.sos_requests s where s.id = open_id;
end $$;

revoke execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint,
  text, text[], text, text, smallint) from public;
grant execute on function public.submit_sos(
  double precision, double precision, real, text, text, text, boolean, text, text, smallint,
  text, text[], text, text, smallint) to anon, authenticated;

-------------------------------------------------------------------------------
-- The sender's own view, now saying what kind of request it is and what was asked for.
-------------------------------------------------------------------------------
drop function public.sos_timeline(uuid, text);
create function public.sos_timeline(p_sos_id uuid, p_token text default null)
returns table (
  status public.sos_status, created_at timestamptz, closed_at timestamptz,
  hazard_type public.hazard_type, lat double precision, lon double precision,
  has_phone boolean, unit_name text, org_name text, photos integer, has_voice boolean,
  events jsonb,
  kind text, needs text[], needs_note text, supplies_left text
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
                   where e.sos_id = s.id), '[]'::jsonb),
         s.kind::text, s.needs, s.needs_note, s.supplies_left;
end $$;
revoke execute on function public.sos_timeline(uuid, text) from public;
grant execute on function public.sos_timeline(uuid, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The teams' board: the same rows with the kind and the needs, rescue cases read first.
-------------------------------------------------------------------------------
drop function public.authority_board(integer);
create function public.authority_board(p_hours integer default 72)
returns table (
  sos_id uuid, created_at timestamptz, status public.sos_status, hazard public.hazard_type,
  lat double precision, lon double precision, accuracy_m real, location_text text,
  tambon text, tambon_name_th text, tambon_name_en text,
  people_count smallint, vulnerable_flags jsonb, depth_ref public.depth_ref, injuries text,
  text_note text, photos text[], voice_url text, priority_score real, has_phone boolean,
  suspected_spam boolean, waiting_minutes integer,
  claimed_by uuid, claimed_by_name text, claimed_is_mine boolean,
  eta_band public.eta_band, eta_given_at timestamptz,
  offered_to uuid, offered_is_mine boolean, offer_expires_at timestamptz, offer_exhausted boolean,
  my_response public.offer_response,
  closed_at timestamptz, completed_at timestamptz, proof_count integer, can_confirm boolean,
  kind text, needs text[], needs_note text, supplies_left text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  wait_hours integer := public.setting_int('rescue_confirmation', 'fallback_hours', 12);
begin
  if not public.is_verified_authority() then
    raise exception 'Verified authorities only' using errcode = 'insufficient_privilege';
  end if;
  return query
  with mine as (
    select u.id from public.authority_units u
     where u.user_id = uid and u.status = 'verified'
  ),
  covered as (
    select distinct ac.tambon from public.authority_coverage ac
     where ac.unit_id in (select id from mine)
  )
  select s.id, s.created_at, s.status, s.hazard_type,
         extensions.st_y(s.point)::double precision,
         extensions.st_x(s.point)::double precision,
         s.location_accuracy_m, s.location_text,
         s.tambon, t.name_th, t.name_en,
         s.people_count, s.vulnerable_flags, s.depth_ref, s.injuries,
         s.text, s.photos, s.voice_url, s.priority_score,
         exists (select 1 from public.sos_contacts sc where sc.sos_id = s.id),
         coalesce(rv.suspected_spam, false),
         (extract(epoch from (now() - s.created_at)) / 60)::integer,
         cl.unit_id, cu.unit_name,
         coalesce(cl.unit_id in (select id from mine), false),
         cl.eta_band, cl.eta_given_at,
         d.dispatch_unit, coalesce(d.dispatch_unit in (select id from mine), false),
         d.expires_at, coalesce(d.exhausted, false),
         (select o.response from public.sos_offers o
           where o.sos_id = s.id and o.unit_id in (select id from mine)
           order by o.round desc limit 1),
         s.closed_at, cl.completed_at,
         coalesce(cardinality(cl.completion_photos), 0),
         coalesce(s.status = 'rescued' and s.closed_at is null
                  and cl.completed_at <= now() - make_interval(hours => greatest(wait_hours, 0))
                  and cu.user_id <> uid, false),
         s.kind::text, s.needs, s.needs_note, s.supplies_left
    from public.sos_requests s
    join covered c on c.tambon = s.tambon
    left join public.tambons t on t.code = s.tambon
    left join public.sos_review rv on rv.sos_id = s.id
    left join public.sos_claims cl on cl.sos_id = s.id and cl.released_at is null
    left join public.authority_units cu on cu.id = cl.unit_id
    left join lateral public.sos_offer_now(s.id) d on true
   where s.duplicate_of is null
     and (s.status in ('received', 'assigned', 'en_route', 'on_site')
          or (s.status = 'rescued' and s.closed_at is null)
          or s.created_at > now() - make_interval(hours => greatest(p_hours, 1)))
   order by s.status = 'received' desc, s.kind = 'rescue' desc, s.priority_score desc, s.created_at;
end $$;
revoke execute on function public.authority_board(integer) from public, anon;
grant execute on function public.authority_board(integer) to authenticated;

-------------------------------------------------------------------------------
-- Points. A confirmed delivery earns its own, smaller amount (decision of 13 October).
-------------------------------------------------------------------------------
create or replace function public.award_hero_points() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  team public.authority_units;
  people integer;
  pts integer;
begin
  select * into s from public.sos_requests r where r.id = new.sos_id;
  select u.* into team
    from public.sos_claims c join public.authority_units u on u.id = c.unit_id
   where c.sos_id = new.sos_id and c.released_at is null;
  -- Nobody held the case (the person got out by themselves): nothing to award.
  if team.id is null then
    return new;
  end if;
  -- A team does not earn points for a request its own account sent.
  if s.requester_id is not null and s.requester_id = team.user_id then
    return new;
  end if;

  people := least(greatest(coalesce(s.people_count, 1), 1),
                  public.setting_int('hero_points', 'max_people', 20));
  if s.kind = 'supplies' then
    pts := public.setting_int('hero_points', 'supplies_per_case', 5)
         + public.setting_int('hero_points', 'supplies_per_person', 1) * people;
  else
    pts := public.setting_int('hero_points', 'per_case', 10)
         + public.setting_int('hero_points', 'per_person', 2) * people
         + case when exists (select 1 from jsonb_each(coalesce(s.vulnerable_flags, '{}'::jsonb)) f
                              where f.value = 'true'::jsonb)
                then public.setting_int('hero_points', 'vulnerable_bonus', 3) else 0 end;
  end if;

  insert into public.hero_points (unit_id, sos_id, points, reason)
  values (team.id, new.sos_id, pts,
          case when s.kind = 'supplies' then 'delivery confirmed: ' else 'rescue confirmed: ' end
            || new.method::text)
  on conflict do nothing;
  return new;
exception when others then
  -- Points are never a reason for a confirmation to fail.
  perform public.log_access('hero_points_failed', 'sos_requests', new.sos_id::text,
                            jsonb_build_object('error', sqlerrm));
  return new;
end $$;

-------------------------------------------------------------------------------
-- The responsibility map also counts the distributors, so a tambon nobody delivers to shows.
-------------------------------------------------------------------------------
drop function public.coverage_summary();
create function public.coverage_summary()
returns table (tambon text, name_th text, name_en text, province_code text,
               rescue_units integer, coordination_units integer, mine boolean,
               supplies_units integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select t.code, t.name_th, t.name_en, t.province_code,
         count(*) filter (where 'rescue' = any (u.capabilities))::integer,
         count(*) filter (where 'coordination' = any (u.capabilities)
                            and not 'rescue' = any (u.capabilities))::integer,
         coalesce(bool_or(u.user_id = uid), false),
         count(*) filter (where 'supplies' = any (u.capabilities))::integer
    from public.tambons t
    left join public.authority_coverage ac on ac.tambon = t.code
    left join public.authority_units u on u.id = ac.unit_id and u.status = 'verified'
   group by t.code, t.name_th, t.name_en, t.province_code
   order by t.code;
end $$;
revoke execute on function public.coverage_summary() from public, anon;
grant execute on function public.coverage_summary() to authenticated;

-------------------------------------------------------------------------------
-- The admins' war room. Its counters of open, waiting and overdue cases are about rescue only:
-- a supply request that has waited twenty minutes is not the emergency a rescue SOS is, and must
-- not be counted into the number that says "nobody has answered". The board itself carries both
-- kinds, each row saying which it is.
-------------------------------------------------------------------------------
create or replace function public.admin_overview()
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
    where s.status in ('received', 'assigned', 'en_route', 'on_site') and s.duplicate_of is null
      and s.kind = 'rescue'
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

drop function public.admin_sos_board(integer);
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
  units_covering integer,
  kind text, needs text[], needs_note text, supplies_left text
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
     where c.tambon = s.tambon and au.status = 'verified'),
    s.kind::text, s.needs, s.needs_note, s.supplies_left
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
     or s.status in ('received', 'assigned', 'en_route', 'on_site')
  order by s.created_at desc;
end $$;
revoke execute on function public.admin_sos_board(integer) from public, anon;
grant execute on function public.admin_sos_board(integer) to authenticated;
