-- Team members (design agreed 24 Oct 2026): a team (authority_units row) can have several people.
-- Step 1: members, three roles, invitation by code, the owner's approval, and every existing
-- access check taught to ask "is this account on the team?" instead of "is it the one account?".
--
-- Nothing is taken away from a team that exists today:
--  * authority_units.user_id stays, and "the owner by user_id" is still accepted by unit_access()
--    even without a member row, so the order of this migration and the code deploy does not matter;
--  * every existing unit's registrant is backfilled as an active owner;
--  * a trigger gives every new registration its owner row, so no code path can forget it.
-- Field members have no access until step 2 (assignment): unit_access() defaults to owner and
-- dispatcher.

create type public.unit_member_role as enum ('owner', 'dispatcher', 'field');
create type public.unit_member_status as enum ('pending', 'active', 'removed');

create table public.authority_unit_members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.authority_units (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role public.unit_member_role not null,
  status public.unit_member_status not null default 'pending',
  invited_by uuid references public.profiles (user_id) on delete set null,
  decided_by uuid references public.profiles (user_id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, user_id)
);
create index authority_unit_members_user_idx on public.authority_unit_members (user_id)
  where status = 'active';

-- Only the hash of a code is stored; the code itself is shown once, to the owner who made it.
create table public.authority_unit_invites (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.authority_units (id) on delete cascade,
  role public.unit_member_role not null check (role <> 'owner'),
  code_hash text not null unique,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references public.profiles (user_id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index authority_unit_invites_unit_idx on public.authority_unit_invites (unit_id);

alter table public.authority_unit_members enable row level security;
alter table public.authority_unit_invites enable row level security;
revoke all on public.authority_unit_members, public.authority_unit_invites from anon, authenticated;
grant select on public.authority_unit_members to authenticated;

-------------------------------------------------------------------------------
-- The one question every access check now asks
-------------------------------------------------------------------------------
-- Is this account on this team, in one of these roles? Called only from other definer functions
-- (it takes the account as an argument, so granting it to clients would let anyone ask whether a
-- named person is on a named team).
create function public.unit_access(
  p_unit uuid, p_uid uuid,
  p_roles public.unit_member_role[] default '{owner,dispatcher}'
) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    ('owner' = any (p_roles)
      and exists (select 1 from public.authority_units u where u.id = p_unit and u.user_id = p_uid))
    or exists (select 1 from public.authority_unit_members m
                where m.unit_id = p_unit and m.user_id = p_uid
                  and m.status = 'active' and m.role = any (p_roles))
  )
$$;
revoke execute on function public.unit_access(uuid, uuid, public.unit_member_role[])
  from public, anon, authenticated;

-- The same question about the caller, for policies and for the pages.
create function public.is_my_unit(
  p_unit uuid, p_roles public.unit_member_role[] default '{owner,dispatcher}'
) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.unit_access(p_unit, (select auth.uid()), p_roles)
$$;
revoke execute on function public.is_my_unit(uuid, public.unit_member_role[]) from public, anon;
grant execute on function public.is_my_unit(uuid, public.unit_member_role[]) to authenticated;

-- Whose phones ring and whose LINE is messaged for a team: the owner and the active dispatchers.
create function public.unit_notify_users(p_unit uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.user_id from public.authority_units u where u.id = p_unit
  union
  select m.user_id from public.authority_unit_members m
   where m.unit_id = p_unit and m.status = 'active' and m.role in ('owner', 'dispatcher')
$$;
revoke execute on function public.unit_notify_users(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Existing teams, and every team registered from now on
-------------------------------------------------------------------------------
insert into public.authority_unit_members (unit_id, user_id, role, status, decided_at)
select u.id, u.user_id, 'owner', 'active', now() from public.authority_units u
on conflict (unit_id, user_id) do nothing;

create function public.authority_units_owner_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.authority_unit_members (unit_id, user_id, role, status, decided_at)
  values (new.id, new.user_id, 'owner', 'active', now())
  on conflict (unit_id, user_id) do nothing;
  return new;
end $$;
create trigger authority_units_owner_member after insert on public.authority_units
  for each row execute function public.authority_units_owner_member();

-------------------------------------------------------------------------------
-- Who can read the member rows (all changes go through the functions below)
-------------------------------------------------------------------------------
create policy "authority_unit_members: own row, the owner, admins read"
  on public.authority_unit_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_my_unit(unit_id, '{owner}') or public.is_admin());
create policy "authority_unit_invites: the owner and admins read"
  on public.authority_unit_invites for select to authenticated
  using (public.is_my_unit(unit_id, '{owner}') or public.is_admin());

-------------------------------------------------------------------------------
-- Inviting, joining, approving, removing
-------------------------------------------------------------------------------
create function public.create_unit_invite(
  p_unit uuid, p_role public.unit_member_role default 'dispatcher'
) returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  v_code text;
  v_exp timestamptz := now() + interval '24 hours';
begin
  if uid is null or not public.unit_access(p_unit, uid, '{owner}') then
    raise exception 'Only the team owner can invite' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'owner' then
    raise exception 'An invitation cannot make an owner' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.authority_units u where u.id = p_unit and u.status = 'verified') then
    raise exception 'Only a verified team can invite' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.authority_unit_invites i
       where i.unit_id = p_unit and i.used_at is null and i.revoked_at is null
         and i.expires_at > now()) >= 10 then
    raise exception 'Too many open invitations' using errcode = 'program_limit_exceeded';
  end if;
  if (select count(*) from public.authority_unit_members m
       where m.unit_id = p_unit and m.status in ('pending', 'active')) >= 30 then
    raise exception 'The team is full' using errcode = 'program_limit_exceeded';
  end if;
  v_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
  insert into public.authority_unit_invites (unit_id, role, code_hash, created_by, expires_at)
  values (p_unit, p_role, encode(extensions.digest(v_code, 'sha256'), 'hex'), uid, v_exp);
  perform public.log_access('unit_invite_created', 'authority_units', p_unit::text,
                            jsonb_build_object('role', p_role));
  return query select v_code, v_exp;
end $$;

-- Whoever holds a code can ask to join. They wait as `pending` until the owner approves, so a
-- leaked code opens nothing.
create function public.redeem_unit_invite(p_code text)
returns table (unit_id uuid, unit_name text, member_status public.unit_member_status)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  v_hash text;
  inv public.authority_unit_invites;
  mem public.authority_unit_members;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.audit_log a
       where a.actor = uid and a.action = 'unit_invite_failed'
         and a.ts > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tries, wait an hour' using errcode = 'program_limit_exceeded';
  end if;
  v_hash := encode(extensions.digest(
    upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'sha256'), 'hex');
  select * into inv from public.authority_unit_invites i
   where i.code_hash = v_hash and i.used_at is null and i.revoked_at is null
     and i.expires_at > now()
   for update;
  if inv.id is null
     or not exists (select 1 from public.authority_units u
                     where u.id = inv.unit_id and u.status = 'verified') then
    -- Returned as "no rows", not raised: an exception would roll the log row back and the
    -- ten-tries-an-hour limit above would never count anything.
    perform public.log_access('unit_invite_failed', 'authority_units', null);
    return;
  end if;

  select * into mem from public.authority_unit_members m
   where m.unit_id = inv.unit_id and m.user_id = uid;
  if mem.id is null then
    insert into public.authority_unit_members (unit_id, user_id, role, status, invited_by)
    values (inv.unit_id, uid, inv.role, 'pending', inv.created_by);
  elsif mem.status = 'removed' then
    update public.authority_unit_members
       set status = 'pending', role = inv.role, invited_by = inv.created_by,
           decided_by = null, decided_at = null, updated_at = now()
     where id = mem.id;
  else
    -- Already on the team (or already waiting): nothing changes and the code stays good.
    return query select u.id, u.unit_name, mem.status
                   from public.authority_units u where u.id = inv.unit_id;
    return;
  end if;
  update public.authority_unit_invites
     set used_by = uid, used_at = now() where id = inv.id;
  perform public.log_access('unit_invite_redeemed', 'authority_units', inv.unit_id::text,
                            jsonb_build_object('role', inv.role));
  return query select u.id, u.unit_name, 'pending'::public.unit_member_status
                 from public.authority_units u where u.id = inv.unit_id;
end $$;

create function public.decide_unit_member(p_member uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  mem public.authority_unit_members;
begin
  select * into mem from public.authority_unit_members m where m.id = p_member for update;
  if mem.id is null or not public.unit_access(mem.unit_id, uid, '{owner}') then
    raise exception 'Only the team owner can decide' using errcode = 'insufficient_privilege';
  end if;
  if mem.status <> 'pending' or mem.role = 'owner' then
    raise exception 'Nobody is waiting here' using errcode = 'invalid_parameter_value';
  end if;
  update public.authority_unit_members
     set status = case when p_approve then 'active' else 'removed' end::public.unit_member_status,
         decided_by = uid, decided_at = now(), updated_at = now()
   where id = mem.id;
  perform public.log_access(case when p_approve then 'unit_member_approved' else 'unit_member_declined' end,
                            'authority_units', mem.unit_id::text,
                            jsonb_build_object('member', mem.user_id, 'role', mem.role));
end $$;

create function public.remove_unit_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  mem public.authority_unit_members;
begin
  select * into mem from public.authority_unit_members m where m.id = p_member for update;
  if mem.id is null or not public.unit_access(mem.unit_id, uid, '{owner}') then
    raise exception 'Only the team owner can remove someone' using errcode = 'insufficient_privilege';
  end if;
  if mem.role = 'owner' then
    raise exception 'The owner cannot be removed' using errcode = 'invalid_parameter_value';
  end if;
  update public.authority_unit_members
     set status = 'removed', decided_by = uid, decided_at = now(), updated_at = now()
   where id = mem.id;
  perform public.log_access('unit_member_removed', 'authority_units', mem.unit_id::text,
                            jsonb_build_object('member', mem.user_id, 'role', mem.role));
end $$;

create function public.set_unit_member_role(p_member uuid, p_role public.unit_member_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  mem public.authority_unit_members;
begin
  select * into mem from public.authority_unit_members m where m.id = p_member for update;
  if mem.id is null or not public.unit_access(mem.unit_id, uid, '{owner}') then
    raise exception 'Only the team owner can change a role' using errcode = 'insufficient_privilege';
  end if;
  if mem.role = 'owner' or p_role = 'owner' then
    raise exception 'The owner role cannot be given or taken here' using errcode = 'invalid_parameter_value';
  end if;
  update public.authority_unit_members set role = p_role, updated_at = now() where id = mem.id;
  perform public.log_access('unit_member_role', 'authority_units', mem.unit_id::text,
                            jsonb_build_object('member', mem.user_id, 'role', p_role));
end $$;

create function public.revoke_unit_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.authority_unit_invites;
begin
  select * into inv from public.authority_unit_invites i where i.id = p_invite;
  if inv.id is null or not public.unit_access(inv.unit_id, (select auth.uid()), '{owner}') then
    raise exception 'Only the team owner can cancel an invitation' using errcode = 'insufficient_privilege';
  end if;
  update public.authority_unit_invites set revoked_at = now()
   where id = inv.id and used_at is null and revoked_at is null;
end $$;

-- The owner's page: who is on the team, who is waiting, which codes are still open.
create function public.unit_team(p_unit uuid)
returns table (member_id uuid, display_name text, role public.unit_member_role,
               status public.unit_member_status, joined_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.unit_access(p_unit, (select auth.uid()), '{owner}') then
    raise exception 'Only the team owner can see the team' using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.id, p.display_name, m.role, m.status, m.created_at, m.user_id = (select auth.uid())
      from public.authority_unit_members m
      join public.profiles p on p.user_id = m.user_id
     where m.unit_id = p_unit and m.status in ('pending', 'active')
     order by (m.status = 'pending') desc, (m.role = 'owner') desc, m.created_at;
end $$;

create function public.unit_open_invites(p_unit uuid)
returns table (invite_id uuid, role public.unit_member_role, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.unit_access(p_unit, (select auth.uid()), '{owner}') then
    raise exception 'Only the team owner can see invitations' using errcode = 'insufficient_privilege';
  end if;
  return query
    select i.id, i.role, i.created_at, i.expires_at
      from public.authority_unit_invites i
     where i.unit_id = p_unit and i.used_at is null and i.revoked_at is null
       and i.expires_at > now()
     order by i.created_at desc;
end $$;

-- Teams the caller has joined or asked to join (their own registrations are on the account page).
create function public.my_memberships()
returns table (unit_id uuid, unit_name text, org_name text, role public.unit_member_role,
               member_status public.unit_member_status, unit_status public.authority_status)
language sql stable security definer set search_path = '' as $$
  select u.id, u.unit_name, o.name, m.role, m.status, u.status
    from public.authority_unit_members m
    join public.authority_units u on u.id = m.unit_id
    join public.organizations o on o.id = u.org_id
   where m.user_id = (select auth.uid()) and m.status in ('pending', 'active')
   order by m.created_at
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_unit_invite(uuid, public.unit_member_role)', 'redeem_unit_invite(text)',
    'decide_unit_member(uuid, boolean)', 'remove_unit_member(uuid)',
    'set_unit_member_role(uuid, public.unit_member_role)', 'revoke_unit_invite(uuid)',
    'unit_team(uuid)', 'unit_open_invites(uuid)', 'my_memberships()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Every access check asks unit_access() instead of comparing authority_units.user_id.
-- (Generated from the definitions on jaga-dev at 24 Oct 2026; only the checks changed.)
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.authority_board(p_hours integer DEFAULT 72)
 RETURNS TABLE(sos_id uuid, created_at timestamp with time zone, status sos_status, hazard hazard_type, lat double precision, lon double precision, accuracy_m real, location_text text, tambon text, tambon_name_th text, tambon_name_en text, people_count smallint, vulnerable_flags jsonb, depth_ref depth_ref, injuries text, text_note text, photos text[], voice_url text, priority_score real, has_phone boolean, suspected_spam boolean, waiting_minutes integer, claimed_by uuid, claimed_by_name text, claimed_is_mine boolean, eta_band eta_band, eta_given_at timestamp with time zone, offered_to uuid, offered_is_mine boolean, offer_expires_at timestamp with time zone, offer_exhausted boolean, my_response offer_response, closed_at timestamp with time zone, completed_at timestamp with time zone, proof_count integer, can_confirm boolean, kind text, needs text[], needs_note text, supplies_left text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where public.unit_access(u.id, uid) and u.status = 'verified'
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
                  and not public.unit_access(cu.id, uid, '{owner,dispatcher,field}'), false),
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
end $function$;

CREATE OR REPLACE FUNCTION public.authority_confirm_rescue(p_sos_id uuid, p_photos text[], p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sos_requests;
  uid uuid := (select auth.uid());
  cl public.sos_claims;
  hours integer := public.setting_int('rescue_confirmation', 'fallback_hours', 12);
  how public.rescue_confirmation_method;
  proof text[];
  note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  select * into s from public.sos_requests r where r.id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if public.is_admin() then
    how := 'admin';
  elsif public.is_verified_authority() and public.covers_tambon(s.tambon) then
    how := 'second_authority';
  else
    raise exception 'This case is not in your coverage' using errcode = 'insufficient_privilege';
  end if;
  if not (s.status = 'rescued' and s.closed_at is null) then
    raise exception 'This case is not waiting for a confirmation' using errcode = 'check_violation';
  end if;

  select c.* into cl from public.sos_claims c
   where c.sos_id = p_sos_id and c.released_at is null;
  if how = 'second_authority' and exists (
       select 1 from public.authority_units u where u.id = cl.unit_id and public.unit_access(u.id, uid)) then
    raise exception 'The team that reported the rescue cannot confirm it'
      using errcode = 'insufficient_privilege';
  end if;
  if cl.completed_at is null or cl.completed_at > now() - make_interval(hours => greatest(hours, 0)) then
    raise exception 'The person still has time to confirm this themselves'
      using errcode = 'check_violation';
  end if;
  if note is null then
    raise exception 'A confirmation needs a note' using errcode = 'check_violation';
  end if;
  proof := public.sos_proof_paths(p_sos_id, p_photos);
  if cardinality(proof) = 0 then
    raise exception 'A photo is required to confirm a rescue' using errcode = 'check_violation';
  end if;

  insert into public.rescue_confirmations (sos_id, method, confirmed_by, photos, note)
  values (p_sos_id, how, uid, proof, note);
  update public.sos_requests r set closed_at = now() where r.id = p_sos_id;
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'confirmed', uid,
          case when how = 'second_authority' then public.my_unit_for_sos(p_sos_id) end, note);
  perform public.log_access('rescue_confirmed', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('method', how));
end $function$;

CREATE OR REPLACE FUNCTION public.authority_households()
 RETURNS TABLE(household_id uuid, tambon text, tambon_name_th text, tambon_name_en text, lat double precision, lon double precision, size smallint, vulnerable jsonb, mobility_notes text, has_phone boolean, on_behalf boolean, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  caps constant public.authority_capability[] := array['rescue', 'coordination']::public.authority_capability[];
  n integer;
begin
  if not exists (select 1 from public.authority_units u
                  where public.unit_access(u.id, (select auth.uid())) and u.status = 'verified'
                    and u.capabilities && caps) then
    raise exception 'Only teams with rescue or coordination capability see household data'
      using errcode = 'insufficient_privilege';
  end if;
  select count(*) into n from public.households h where public.covers_tambon(h.tambon, caps);
  perform public.log_access('read_households', 'authority_coverage', null,
                            jsonb_build_object('count', n));
  return query
  select h.id, h.tambon, t.name_th, t.name_en,
         extensions.st_y(h.point)::double precision, extensions.st_x(h.point)::double precision,
         h.size, h.vulnerable, h.mobility_notes,
         h.contact_phone is not null, h.on_behalf_of_other, h.updated_at
    from public.households h
    left join public.tambons t on t.code = h.tambon
   where public.covers_tambon(h.tambon, caps)
   order by h.tambon, h.updated_at desc
   limit 500;
end $function$;

CREATE OR REPLACE FUNCTION public.authority_places()
 RETURNS TABLE(place_id uuid, name jsonb, type safe_place_type, tambon text, tambon_th text, tambon_en text, lat double precision, lon double precision, status safe_place_status, verification_status verification_status, capacity integer, needs text, checked_at timestamp with time zone, checked_source place_check_source, check_due_at timestamp with time zone, level alert_level, mine boolean, residents_said jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Only a verified team or an admin can see the round list'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select sp.id, sp.name, sp.type, sp.tambon, t.name_th, t.name_en,
         extensions.st_y(sp.point), extensions.st_x(sp.point),
         sp.status, sp.verification_status, sp.capacity, sp.needs,
         sp.checked_at, sp.checked_source,
         sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon)),
         public.tambon_level(sp.tambon),
         exists (select 1 from public.authority_units u
                  where u.id = sp.checked_by_unit and public.unit_access(u.id, (select auth.uid()))),
         public.residents_said(sp)
    from public.safe_places sp
    left join public.tambons t on t.code = sp.tambon
   where sp.verification_status <> 'rejected'
     and sp.tambon is not null
     and (public.is_admin() or public.covers_tambon(sp.tambon))
   order by coalesce((public.residents_said(sp) ->> 'disputed')::boolean, false) desc,
            (sp.checked_at is not null),
            sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon)),
            sp.id;
end $function$;

CREATE OR REPLACE FUNCTION public.authority_record_field_rescue(p_id uuid, p_lat double precision, p_lon double precision, p_accuracy_m real, p_located_at timestamp with time zone, p_people integer, p_vulnerable jsonb, p_phone text, p_photos text[], p_note text DEFAULT NULL::text)
 RETURNS TABLE(status field_rescue_status, holds text[], evidence text[], points integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where public.unit_access(u.id, uid) and u.status = 'verified'
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
end $function$;

CREATE OR REPLACE FUNCTION public.authority_set_duty(p_unit_id uuid, p_on_duty boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.authority_units u set on_duty = p_on_duty, updated_at = now()
   where u.id = p_unit_id and public.unit_access(u.id, (select auth.uid())) and u.status = 'verified';
  if not found then
    raise exception 'Not your unit' using errcode = 'insufficient_privilege';
  end if;
  return p_on_duty;
end $function$;

CREATE OR REPLACE FUNCTION public.authority_set_phone_sharing(p_unit_id uuid, p_share boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.authority_units u set poc_phone_to_requester = p_share, updated_at = now()
   where u.id = p_unit_id and public.unit_access(u.id, (select auth.uid()), '{owner}') and u.status = 'verified';
  if not found then
    raise exception 'Not your unit' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('set_phone_sharing', 'authority_units', p_unit_id::text,
                            jsonb_build_object('share', p_share));
  return p_share;
end $function$;

CREATE OR REPLACE FUNCTION public.award_hero_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if s.requester_id is not null and public.unit_access(team.id, s.requester_id, '{owner,dispatcher,field}') then
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
end $function$;

CREATE OR REPLACE FUNCTION public.coverage_summary()
 RETURNS TABLE(tambon text, name_th text, name_en text, province_code text, rescue_units integer, coordination_units integer, mine boolean, supplies_units integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         coalesce(bool_or(public.unit_access(u.id, uid)), false),
         count(*) filter (where 'supplies' = any (u.capabilities))::integer
    from public.tambons t
    left join public.authority_coverage ac on ac.tambon = t.code
    left join public.authority_units u on u.id = ac.unit_id and u.status = 'verified'
   group by t.code, t.name_th, t.name_en, t.province_code
   order by t.code;
end $function$;

CREATE OR REPLACE FUNCTION public.coverage_units(p_tambon text)
 RETURNS TABLE(unit_id uuid, unit_name text, org_name text, capabilities text[], on_duty boolean, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.unit_name, o.name, u.capabilities::text[], u.on_duty, public.unit_access(u.id, uid)
    from public.authority_coverage ac
    join public.authority_units u on u.id = ac.unit_id and u.status = 'verified'
    join public.organizations o on o.id = u.org_id
   where ac.tambon = p_tambon
   order by ('rescue' = any (u.capabilities)) desc, u.unit_name;
end $function$;

CREATE OR REPLACE FUNCTION public.covers_tambon(p_tambon text, p_capabilities authority_capability[] DEFAULT NULL::authority_capability[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where public.unit_access(u.id, (select auth.uid()))
      and u.status = 'verified'
      and c.tambon = p_tambon
      and (p_capabilities is null or u.capabilities && p_capabilities)
  )
$function$;

CREATE OR REPLACE FUNCTION public.drill_audience_users(p_audience text[], p_tambons text[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.user_id from public.profiles p
   where 'admins' = any (p_audience) and p.role in ('admin', 'super_admin')
  union
  select public.unit_notify_users(u.id)
    from public.authority_units u
    join public.authority_coverage c on c.unit_id = u.id
   where u.status = 'verified'
     and c.tambon = any (coalesce(p_tambons, '{}'))
     and ('units' = any (p_audience)
          or ('rescue' = any (p_audience)
              and u.capabilities && array['rescue']::public.authority_capability[]))
$function$;

CREATE OR REPLACE FUNCTION public.drill_visible(p_audience text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'everyone' = any (p_audience)
      or ('admins' = any (p_audience) and public.is_admin())
      or ('units' = any (p_audience) and public.is_verified_authority())
      or ('rescue' = any (p_audience) and exists (
            select 1 from public.authority_units u
             where public.unit_access(u.id, (select auth.uid())) and u.status = 'verified'
               and u.capabilities && array['rescue']::public.authority_capability[]))
$function$;

CREATE OR REPLACE FUNCTION public.field_media_readable(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_admin() or exists (
    select 1 from public.authority_units u
     where u.id::text = split_part(p_path, '/', 1)
       and public.unit_access(u.id, (select auth.uid()))
  )
$function$;

CREATE OR REPLACE FUNCTION public.field_media_writable(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.authority_units u
     where u.id::text = split_part(p_path, '/', 1)
       and public.unit_access(u.id, (select auth.uid()))
       and u.status = 'verified'
  )
$function$;

CREATE OR REPLACE FUNCTION public.hero_leaderboard(p_province text DEFAULT NULL::text)
 RETURNS TABLE(province_code text, unit_id uuid, unit_name text, org_name text, points integer, cases integer, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select left(coalesce(s.tambon, f.tambon), 2), u.id, u.unit_name, o.name,
         sum(h.points)::integer,
         count(distinct coalesce(h.sos_id, h.field_rescue_id))::integer, public.unit_access(u.id, uid)
    from public.hero_points h
    join public.authority_units u on u.id = h.unit_id
    join public.organizations o on o.id = u.org_id
    left join public.sos_requests s on s.id = h.sos_id
    left join public.field_rescues f on f.id = h.field_rescue_id
   where h.revoked_at is null
     and coalesce(s.tambon, f.tambon) is not null
     and (p_province is null or left(coalesce(s.tambon, f.tambon), 2) = p_province)
   group by left(coalesce(s.tambon, f.tambon), 2), u.id, u.unit_name, o.name
   order by 1, 5 desc, u.unit_name;
end $function$;

CREATE OR REPLACE FUNCTION public.is_verified_authority()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.authority_units
                 where public.unit_access(id, (select auth.uid())) and status = 'verified')
$function$;

CREATE OR REPLACE FUNCTION public.line_due(p_token text)
 RETURNS TABLE(kind text, line_user_id text, locale text, sos_id uuid, data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  o record;
  c record;
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id, s.kind as sos_kind, s.status, s.closed_at, s.requester_id,
           t.name_th, t.name_en
    from public.sos_requests s
    left join public.tambons t on t.code = s.tambon
    where s.created_at > now() - interval '3 days'
      and s.duplicate_of is null
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null))
  loop
    select cl.id, cl.completed_at, u.unit_name into c
      from public.sos_claims cl
      join public.authority_units u on u.id = cl.unit_id
     where cl.sos_id = r.id and cl.released_at is null;

    if c.id is null then
      select * into o from public.sos_offer_now(r.id);
      if o.dispatch_unit is not null then
        insert into public.push_log (kind, sos_id, ref)
        values ('line_offer', r.id,
                o.dispatch_unit::text || ':' || extract(epoch from o.offered_at)::bigint)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'offer'::text, p.line_user_id, p.preferred_locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en, 'expires_at', o.expires_at)
            from public.authority_units u
            join public.profiles p on p.user_id in (select public.unit_notify_users(u.id))
            where u.id = o.dispatch_unit and u.status = 'verified'
              and p.line_user_id is not null
              and not exists (select 1 from public.line_follows f
                               where f.line_user_id = p.line_user_id and not f.following);
        end if;
      end if;
    elsif r.status = 'rescued' and r.closed_at is null and c.completed_at is not null
          and r.requester_id is not null then
      -- The team reports it done: the sender is asked, with two buttons.
      insert into public.push_log (kind, sos_id, ref) values ('line_rescued', r.id, c.id::text)
      on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query
          select 'rescued'::text, p.line_user_id, p.preferred_locale, r.id,
                 jsonb_build_object('request', r.sos_kind, 'unit', c.unit_name)
          from public.profiles p
          where p.user_id = r.requester_id and p.line_user_id is not null
            and not exists (select 1 from public.line_follows f
                             where f.line_user_id = p.line_user_id and not f.following);
      end if;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.my_field_rescues()
 RETURNS TABLE(rescue_id uuid, created_at timestamp with time zone, status field_rescue_status, tambon_th text, tambon_en text, people_count integer, holds jsonb, points integer, reviewed_at timestamp with time zone, review_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.id, f.created_at, f.status, t.name_th, t.name_en, f.people_count::integer,
         coalesce(f.checks -> 'holds', '[]'::jsonb),
         coalesce((select sum(h.points)::integer from public.hero_points h
                    where h.field_rescue_id = f.id and h.revoked_at is null), 0),
         f.reviewed_at, f.review_note
    from public.field_rescues f
    join public.authority_units u on u.id = f.unit_id
    join public.tambons t on t.code = f.tambon
   where public.unit_access(u.id, (select auth.uid()))
     and f.created_at > now() - interval '60 days'
   order by f.created_at desc
   limit 50
$function$;

CREATE OR REPLACE FUNCTION public.my_unit_for_sos(p_sos_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id
    from public.authority_units u
    join public.authority_coverage ac on ac.unit_id = u.id
    join public.sos_requests s on s.id = p_sos_id and s.tambon = ac.tambon
   where public.unit_access(u.id, (select auth.uid()))
     and u.status = 'verified'
   order by (u.id = (select d.dispatch_unit from public.sos_offer_now(p_sos_id) d)) desc nulls last,
            u.on_duty desc, u.created_at
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.place_check_send(p_place uuid, p_open safe_place_status, p_water place_water DEFAULT NULL::place_water, p_road road_access DEFAULT NULL::road_access, p_needs text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_place public.safe_places;
  v_admin boolean := public.is_admin();
  v_source public.place_check_source;
  v_unit uuid;
  v_point extensions.geometry;
  v_distance real;
  v_needs text := nullif(left(btrim(coalesce(p_needs, '')), 500), '');
  v_id uuid;
begin
  select sp.* into v_place from public.safe_places sp where sp.id = p_place for update;
  if not found then
    raise exception 'No such safe place' using errcode = 'no_data_found';
  end if;
  if v_admin then
    v_source := 'admin';
  else
    select u.id into v_unit
      from public.authority_units u
      join public.authority_coverage c on c.unit_id = u.id
     where public.unit_access(u.id, (select auth.uid())) and u.status = 'verified'
       and c.tambon = v_place.tambon
     limit 1;
    if v_unit is null then
      raise exception 'Only a team covering this place, or an admin, can check it'
        using errcode = 'insufficient_privilege';
    end if;
    v_source := 'team';
  end if;
  if p_open is null then
    raise exception 'A check has to say whether the place is open'
      using errcode = 'check_violation';
  end if;
  if p_lat is not null and p_lon is not null
     and p_lat between -90 and 90 and p_lon between -180 and 180 then
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
    v_distance := extensions.st_distance(v_point::extensions.geography,
                                         v_place.point::extensions.geography);
  end if;
  insert into public.place_checks (place_id, source, author_id, unit_id, open_state, water,
                                   road, needs, point, distance_m)
  values (p_place, v_source, (select auth.uid()), v_unit, p_open, p_water, p_road, v_needs,
          v_point, v_distance)
  returning id into v_id;
  -- The place carries only the latest check. `needs` is left alone when the check says nothing
  -- about it, so a two-tap confirm never wipes a note an admin wrote.
  update public.safe_places
     set status = p_open,
         needs = coalesce(v_needs, needs),
         checked_at = now(),
         checked_source = v_source,
         checked_by_unit = v_unit,
         updated_at = now()
   where id = p_place;
  perform public.log_access('place_checked', 'safe_places', p_place::text, jsonb_build_object(
    'check', v_id, 'source', v_source, 'unit', v_unit,
    'status', jsonb_build_array(v_place.status, p_open),
    'water', p_water, 'road', p_road,
    'distance_m', case when v_distance is null then null else round(v_distance) end));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.push_due(p_token text)
 RETURNS TABLE(kind text, endpoint text, keys jsonb, locale text, sos_id uuid, data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  o record;
  c record;
  step text;
  fresh integer;
  v_overdue integer := public.setting_int('sos_unclaimed_minutes', 'minutes', 15);
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id, s.kind as sos_kind, s.status, s.closed_at, s.created_at, s.tambon,
           t.name_th, t.name_en
    from public.sos_requests s
    left join public.tambons t on t.code = s.tambon
    where s.created_at > now() - interval '3 days'
      and s.duplicate_of is null
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null))
  loop
    select cl.id, cl.unit_id, cl.completed_at, u.unit_name into c
      from public.sos_claims cl
      join public.authority_units u on u.id = cl.unit_id
     where cl.sos_id = r.id and cl.released_at is null;

    if c.id is null then
      -- Nobody holds it: whose turn is it?
      select * into o from public.sos_offer_now(r.id);
      if o.dispatch_unit is not null then
        insert into public.push_log (kind, sos_id, ref)
        values ('offer', r.id, o.dispatch_unit::text || ':' || extract(epoch from o.offered_at)::bigint)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'offer'::text, ps.endpoint, ps.keys, ps.locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en, 'expires_at', o.expires_at)
            from public.authority_units u
            join public.push_subscriptions ps on ps.user_id in (select public.unit_notify_users(u.id))
            where u.id = o.dispatch_unit and u.status = 'verified';
        end if;
      -- No row at all means the relay never started: there was nobody to ask. Both that and a
      -- queue that ran out wait for the admins' own overdue mark before a phone rings.
      elsif coalesce(o.exhausted, true)
            and r.created_at <= now() - make_interval(mins => greatest(v_overdue, 0)) then
        insert into public.push_log (kind, sos_id, ref) values ('unclaimed', r.id, 'once')
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'unclaimed'::text, ps.endpoint, ps.keys, ps.locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en)
            from public.profiles p
            join public.push_subscriptions ps on ps.user_id = p.user_id
            where p.role in ('admin', 'super_admin');
        end if;
      end if;
    else
      -- A team holds it: tell the sender each step once, for this team's hold of the case.
      foreach step in array array[
        'accepted',
        case when r.status in ('en_route', 'on_site', 'rescued') then 'en_route' end,
        case when r.status in ('on_site', 'rescued') then 'on_site' end,
        case when r.status = 'rescued' and c.completed_at is not null then 'rescued' end
      ] loop
        continue when step is null;
        insert into public.push_log (kind, sos_id, ref) values (step, r.id, c.id::text)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        -- Only the newest step is worth a notification when several are found at once.
        continue when fresh = 0
          or step <> (case when r.status = 'rescued' and c.completed_at is not null then 'rescued'
                           when r.status in ('on_site', 'rescued') then 'on_site'
                           when r.status = 'en_route' then 'en_route'
                           else 'accepted' end);
        return query
          select step, f.endpoint, f.keys, f.locale, r.id,
                 jsonb_build_object('request', r.sos_kind, 'unit', c.unit_name)
          from public.push_sos_followers f where f.sos_id = r.id;
      end loop;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.reveal_poc_phone(p_unit_id uuid)
 RETURNS TABLE(poc_name text, poc_phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          and public.unit_access(u.id, (select auth.uid()))
          and u.status = 'verified'))) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $function$;

drop policy "field_rescues: the recording team and admins read" on public.field_rescues;
create policy "field_rescues: the recording team and admins read" on public.field_rescues
  for select to authenticated using (public.is_admin() or public.is_my_unit(unit_id));
