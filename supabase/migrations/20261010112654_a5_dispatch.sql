-- A5 (2/2): active dispatch (spec 5.2 and 5.3, decisions of 9 and 10 October).
--
-- A case does not wait to be noticed. It is offered to the units covering its tambon one at a
-- time - rescue capability first, then coordination, then the admins' monitor - while staying
-- visible to every covering unit the whole time, so any of them can accept at any second.
--
-- Three things decide the shape of what follows:
--
--  * **No ticker.** Postgres cron cannot fire every ten seconds, and a countdown that depends on
--    a background job is a countdown that can silently stop. So nothing is pushed on a timer:
--    sos_offer_now() works out who is holding the offer from the queue, the responses already
--    given and the clock, every time it is asked. The only thing a cron will ever do here (A7)
--    is send the notification; the state is correct without it.
--  * **Safety rule 1.** Building the queue is wrapped in an exception block on insert: if the
--    dispatch fails for any reason the request is still stored and still on every board. A
--    request for help is never lost to a bug in the thing that routes it.
--  * **Nobody is shut out.** Being offered a case is not what permits accepting it. Any verified
--    unit covering the tambon may accept at any time, whether the relay has reached it, passed
--    it, or never gets to it. The queue decides whose phone rings, not who may help.

-------------------------------------------------------------------------------
-- Settings: the windows the admins own (owner's choice, 9 Oct).
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('dispatch_windows',
   '{"rescue_seconds": 60, "coordination_seconds": 90}'::jsonb,
   'How long a unit holds an offer before the relay moves on. Running out is not a refusal, and a unit that was passed can still accept. Tighten during the flood peak.')
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- The unit's own two switches. The existing update policy only lets a unit edit itself while it
-- is pending, which is right for its name and coverage, so these go through functions instead.
-------------------------------------------------------------------------------
alter table public.authority_units
  -- Off duty is offered last, never excluded: an alarm is not spent on a phone nobody holds.
  add column on_duty boolean not null default true,
  -- "When you accept an SOS, the person you are rescuing can see this number." On by default,
  -- decision of 9 Oct; a unit that turns it off shows its organisation's official phone instead.
  add column poc_phone_to_requester boolean not null default true;

create index authority_units_duty_idx on public.authority_units (status, on_duty);

create function public.authority_set_duty(p_unit_id uuid, p_on_duty boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.authority_units u set on_duty = p_on_duty, updated_at = now()
   where u.id = p_unit_id and u.user_id = (select auth.uid()) and u.status = 'verified';
  if not found then
    raise exception 'Not your unit' using errcode = 'insufficient_privilege';
  end if;
  return p_on_duty;
end $$;

create function public.authority_set_phone_sharing(p_unit_id uuid, p_share boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.authority_units u set poc_phone_to_requester = p_share, updated_at = now()
   where u.id = p_unit_id and u.user_id = (select auth.uid()) and u.status = 'verified';
  if not found then
    raise exception 'Not your unit' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('set_phone_sharing', 'authority_units', p_unit_id::text,
                            jsonb_build_object('share', p_share));
  return p_share;
end $$;

-------------------------------------------------------------------------------
-- What a team said it expects, and when it said so.
-------------------------------------------------------------------------------
alter table public.sos_claims
  add column eta_band public.eta_band,
  add column eta_given_at timestamptz;

-- When the relay started (or restarted after a release). Null means no dispatch: a case with no
-- tambon, or one that failed to build a queue, which the admins' monitor picks up either way.
alter table public.sos_requests add column dispatch_started_at timestamptz;

-------------------------------------------------------------------------------
-- The queue. One row per unit per round, in the order they will be asked, written once when the
-- relay starts. Who holds the offer *now* is never stored: it is computed (see sos_offer_now).
-------------------------------------------------------------------------------
create table public.sos_offers (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  unit_id uuid not null references public.authority_units (id),
  tier public.offer_tier not null,
  round smallint not null default 1,
  queue_pos smallint not null,
  responded_at timestamptz,
  response public.offer_response,
  decline_reason text check (char_length(decline_reason) <= 300),
  created_at timestamptz not null default now(),
  unique (sos_id, unit_id, round)
);
create index sos_offers_sos_idx on public.sos_offers (sos_id, round, queue_pos);
create index sos_offers_unit_idx on public.sos_offers (unit_id, responded_at);

-- No policies on purpose: everything below is security definer and checks coverage itself.
alter table public.sos_offers enable row level security;

-------------------------------------------------------------------------------
-- Building the queue.
--
-- Order: rescue capability before coordination; on duty before off duty; then the unit whose
-- covered ground is nearest the case; then the one holding fewest open cases; then by age, so
-- the order is total and two runs never disagree.
-------------------------------------------------------------------------------
create function public.sos_build_offers(p_sos_id uuid, p_round smallint default 1,
                                        p_skip_unit uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  made integer := 0;
begin
  select * into s from public.sos_requests where id = p_sos_id;
  if not found or s.tambon is null then
    return 0;
  end if;

  insert into public.sos_offers (sos_id, unit_id, tier, round, queue_pos)
  select p_sos_id, q.id, q.tier, p_round,
         (row_number() over (order by q.tier, q.on_duty desc, q.distance_m nulls last,
                                      q.open_cases, q.created_at))::smallint
    from (
      select u.id,
             case when 'rescue' = any (u.capabilities) then 'rescue' else 'coordination' end
               ::public.offer_tier as tier,
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
         and (u.capabilities && array['rescue', 'coordination']::public.authority_capability[])
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
revoke execute on function public.sos_build_offers(uuid, smallint, uuid) from public, anon, authenticated;

-- Every new case starts looking for a team by itself. It must never fail loudly: a request that
-- cannot be routed is still a request, and the admins' monitor shows it (safety rule 1).
create function public.sos_dispatch_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.sos_build_offers(new.id);
  exception when others then
    perform public.log_access('dispatch_build_failed', 'sos_requests', new.id::text,
                              jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;

create trigger sos_dispatch_after_insert after insert on public.sos_requests
  for each row execute function public.sos_dispatch_on_insert();

-------------------------------------------------------------------------------
-- Who is being asked right now.
--
-- Walks the queue from the moment the relay started, giving each unit its tier's window, and
-- stopping early wherever a unit declined before its window ran out. The answer is a function of
-- rows and the clock alone, so there is nothing to keep running and nothing to repair.
-------------------------------------------------------------------------------
create function public.sos_offer_now(p_sos_id uuid)
returns table (dispatch_unit uuid, dispatch_tier public.offer_tier, queue_pos smallint,
               offered_at timestamptz, expires_at timestamptz, exhausted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  started timestamptz;
  at timestamptz;
  ends timestamptz;
  w_rescue integer := public.setting_int('dispatch_windows', 'rescue_seconds', 60);
  w_coord integer := public.setting_int('dispatch_windows', 'coordination_seconds', 90);
  o record;
  current_round smallint;
begin
  select r.dispatch_started_at into started from public.sos_requests r where r.id = p_sos_id;
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
    ends := at + make_interval(secs => case when o.tier = 'rescue' then w_rescue else w_coord end);
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
-- The caller's own verified units, and the one that may act on a case.
-------------------------------------------------------------------------------
-- The caller's unit that may act on this case: one of their own verified units covering its
-- tambon. Someone who runs more than one unit there acts as the one the relay is asking.
create function public.my_unit_for_sos(p_sos_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from public.authority_units u
    join public.authority_coverage ac on ac.unit_id = u.id
    join public.sos_requests s on s.id = p_sos_id and s.tambon = ac.tambon
   where u.user_id = (select auth.uid())
     and u.status = 'verified'
   order by (u.id = (select d.dispatch_unit from public.sos_offer_now(p_sos_id) d)) desc nulls last,
            u.on_duty desc, u.created_at
   limit 1
$$;
revoke execute on function public.my_unit_for_sos(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Accepting. This is the claim: one active claim per case, enforced by the unique index, so two
-- teams tapping at the same moment cannot both get it - the second is told it is taken.
--
-- Being offered the case is not required. Any verified unit covering the tambon may accept.
-------------------------------------------------------------------------------
create function public.authority_accept_sos(p_sos_id uuid)
returns table (claim uuid, by_unit uuid, by_unit_name text, taken boolean)
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid;
  holder uuid;
  st public.sos_status;
begin
  select s.status into st from public.sos_requests s where s.id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  mine := public.my_unit_for_sos(p_sos_id);
  if mine is null then
    raise exception 'This case is not in your coverage' using errcode = 'insufficient_privilege';
  end if;
  if st in ('rescued', 'safe_cancelled', 'dismissed') then
    raise exception 'This case is closed' using errcode = 'check_violation';
  end if;

  select c.unit_id into holder from public.sos_claims c
   where c.sos_id = p_sos_id and c.released_at is null;

  if holder is not null then
    claim := (select c.id from public.sos_claims c
               where c.sos_id = p_sos_id and c.released_at is null);
    by_unit := holder;
    by_unit_name := (select u.unit_name from public.authority_units u where u.id = holder);
    -- Already ours is success; anyone else's is "someone got there first", not an error.
    taken := holder <> mine;
    return next;
    return;
  end if;

  insert into public.sos_claims (sos_id, unit_id) values (p_sos_id, mine)
  on conflict do nothing
  returning id into claim;

  if claim is null then
    -- Lost the race in the moment between the two statements.
    select c.id, c.unit_id into claim, by_unit from public.sos_claims c
     where c.sos_id = p_sos_id and c.released_at is null;
    by_unit_name := (select u.unit_name from public.authority_units u where u.id = by_unit);
    taken := by_unit is distinct from mine;
    return next;
    return;
  end if;

  update public.sos_offers o
     set responded_at = now(), response = 'accepted'
   where o.sos_id = p_sos_id and o.unit_id = mine and o.responded_at is null;

  update public.sos_requests s set status = 'assigned'
   where s.id = p_sos_id and s.status = 'received';

  insert into public.sos_events (sos_id, event, actor_id, unit_id)
  values (p_sos_id, 'accepted', (select auth.uid()), mine);

  by_unit := mine;
  by_unit_name := (select u.unit_name from public.authority_units u where u.id = mine);
  taken := false;
  return next;
end $$;

-------------------------------------------------------------------------------
-- Declining: one tap and a reason, and the case moves on at once rather than waiting out the
-- window. It never leaves the unit's board.
-------------------------------------------------------------------------------
create function public.authority_decline_sos(p_sos_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := public.my_unit_for_sos(p_sos_id);
begin
  if mine is null then
    raise exception 'This case is not in your coverage' using errcode = 'insufficient_privilege';
  end if;
  update public.sos_offers o
     set responded_at = now(), response = 'declined', decline_reason = left(p_reason, 300)
   where o.sos_id = p_sos_id and o.unit_id = mine and o.responded_at is null;
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'declined', (select auth.uid()), mine, left(p_reason, 1000));
end $$;

-------------------------------------------------------------------------------
-- The arrival estimate. Asked straight after accepting, never before it: nothing may stand
-- between a team and the case it is taking. A band, never a clock time (safety rule 8).
-------------------------------------------------------------------------------
create function public.authority_set_eta(p_sos_id uuid, p_band public.eta_band) returns void
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := public.my_unit_for_sos(p_sos_id);
begin
  update public.sos_claims c
     set eta_band = p_band, eta_given_at = now()
   where c.sos_id = p_sos_id and c.released_at is null and c.unit_id = mine;
  if not found then
    raise exception 'Only the team holding this case can give an estimate'
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'eta', (select auth.uid()), mine, p_band::text);
end $$;

-------------------------------------------------------------------------------
-- On the way, and arrived.
-------------------------------------------------------------------------------
create function public.authority_advance_sos(p_sos_id uuid, p_status public.sos_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := public.my_unit_for_sos(p_sos_id);
begin
  if p_status not in ('en_route', 'on_site') then
    raise exception 'A team reports only en_route or on_site here' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.sos_claims c
                  where c.sos_id = p_sos_id and c.released_at is null and c.unit_id = mine) then
    raise exception 'Only the team holding this case can move it on'
      using errcode = 'insufficient_privilege';
  end if;
  update public.sos_requests s set status = p_status where s.id = p_sos_id;
  insert into public.sos_events (sos_id, event, actor_id, unit_id)
  values (p_sos_id, p_status::text, (select auth.uid()), mine);
end $$;

-------------------------------------------------------------------------------
-- Giving a case back. It needs a reason, and it puts the case into a fresh round of the relay
-- without the unit that let it go.
-------------------------------------------------------------------------------
create function public.authority_release_sos(p_sos_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := public.my_unit_for_sos(p_sos_id);
  next_round smallint;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A release needs a reason' using errcode = 'check_violation';
  end if;
  update public.sos_claims c
     set released_at = now(), release_reason = left(p_reason, 500)
   where c.sos_id = p_sos_id and c.released_at is null and c.unit_id = mine;
  if not found then
    raise exception 'Only the team holding this case can give it back'
      using errcode = 'insufficient_privilege';
  end if;

  update public.sos_requests s set status = 'received'
   where s.id = p_sos_id and s.status in ('assigned', 'en_route', 'on_site');

  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'released', (select auth.uid()), mine, left(p_reason, 1000));

  select (coalesce(max(o.round), 1) + 1)::smallint into next_round
    from public.sos_offers o where o.sos_id = p_sos_id;
  perform public.sos_build_offers(p_sos_id, next_round, mine);
end $$;

-------------------------------------------------------------------------------
-- The board: the cases in the caller's own coverage. No phone number is returned by it; the
-- existing reveal_sos_phone() stays the only way to see one, and it logs every reveal.
-------------------------------------------------------------------------------
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
  my_response public.offer_response
)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
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
         cl.unit_id, cu.unit_name, cl.unit_id in (select id from mine),
         cl.eta_band, cl.eta_given_at,
         d.dispatch_unit, coalesce(d.dispatch_unit in (select id from mine), false),
         d.expires_at, coalesce(d.exhausted, false),
         (select o.response from public.sos_offers o
           where o.sos_id = s.id and o.unit_id in (select id from mine)
           order by o.round desc limit 1)
    from public.sos_requests s
    join covered c on c.tambon = s.tambon
    left join public.tambons t on t.code = s.tambon
    left join public.sos_review rv on rv.sos_id = s.id
    left join public.sos_claims cl on cl.sos_id = s.id and cl.released_at is null
    left join public.authority_units cu on cu.id = cl.unit_id
    left join lateral public.sos_offer_now(s.id) d on true
   where s.duplicate_of is null
     and (s.status in ('received', 'assigned', 'en_route', 'on_site')
          or s.created_at > now() - make_interval(hours => greatest(p_hours, 1)))
   order by s.status = 'received' desc, s.priority_score desc, s.created_at;
end $$;

-------------------------------------------------------------------------------
-- What the person who sent the SOS sees: who is coming, and when they think they will be there.
-- No phone number here - that is one deliberate tap away, and logged (below).
-------------------------------------------------------------------------------
create function public.sos_responder(p_sos_id uuid, p_token text default null)
returns table (unit_id uuid, unit_name text, org_name text, eta_band public.eta_band,
               eta_given_at timestamptz, accepted_at timestamptz, phone_available boolean,
               searching boolean, exhausted boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sos_requests;
begin
  -- Same gate as sos_for_caller: the signed-in sender, or whoever holds the case's token.
  s := public.sos_for_caller(p_sos_id, p_token);
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
   where cl.sos_id = s.id and cl.released_at is null;

  if unit_id is null then
    -- Nobody has it yet. Say so plainly, and say whether the relay still has someone to ask.
    searching := true;
    exhausted := coalesce((select d.exhausted from public.sos_offer_now(s.id) d), true);
    phone_available := false;
  end if;
  return next;
end $$;

-------------------------------------------------------------------------------
-- The one exception to "personal phone numbers are never public" (safety rule 5, amended
-- 9 Oct): the sender of a case may call the team that accepted it. Fenced in to that sender,
-- that case, while it is open and claimed by that unit - and every reveal is in audit_log.
-------------------------------------------------------------------------------
create function public.reveal_responder_phone(p_sos_id uuid, p_token text default null)
returns table (phone text, is_poc boolean, unit_name text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  u public.authority_units;
  org_phone text;
  poc text;
begin
  s := public.sos_for_caller(p_sos_id, p_token);
  if s.closed_at is not null or s.status in ('rescued', 'safe_cancelled', 'dismissed') then
    raise exception 'This case is closed' using errcode = 'insufficient_privilege';
  end if;

  select u2.* into u from public.sos_claims cl
    join public.authority_units u2 on u2.id = cl.unit_id
   where cl.sos_id = s.id and cl.released_at is null;
  if not found then
    raise exception 'No team has accepted this request yet' using errcode = 'no_data_found';
  end if;

  select o.official_phone into org_phone from public.organizations o where o.id = u.org_id;
  select ct.poc_phone into poc from public.authority_unit_contacts ct where ct.unit_id = u.id;

  if u.poc_phone_to_requester and poc is not null then
    phone := poc;
    is_poc := true;
  else
    phone := org_phone;
    is_poc := false;
  end if;
  unit_name := u.unit_name;

  perform public.log_access('reveal_responder_phone', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('unit', u.id, 'poc', is_poc,
                                               'had_phone', phone is not null));
  return next;
end $$;

-------------------------------------------------------------------------------
-- Who may call what.
-------------------------------------------------------------------------------
grant execute on function public.authority_board(integer) to authenticated;
grant execute on function public.authority_accept_sos(uuid) to authenticated;
grant execute on function public.authority_decline_sos(uuid, text) to authenticated;
grant execute on function public.authority_set_eta(uuid, public.eta_band) to authenticated;
grant execute on function public.authority_advance_sos(uuid, public.sos_status) to authenticated;
grant execute on function public.authority_release_sos(uuid, text) to authenticated;
grant execute on function public.authority_set_duty(uuid, boolean) to authenticated;
grant execute on function public.authority_set_phone_sharing(uuid, boolean) to authenticated;
-- The sender may be a visitor with a token, so anon needs these two.
grant execute on function public.sos_responder(uuid, text) to anon, authenticated;
grant execute on function public.reveal_responder_phone(uuid, text) to anon, authenticated;
-- Read-only, used by the board and by the requester's view; harmless on its own but there is no
-- reason for a client to call it directly.
revoke execute on function public.sos_offer_now(uuid) from public, anon, authenticated;
