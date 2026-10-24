-- Team war room, step 2 (24 Oct 2026): a claimed case can be handed to named people on the team.
--
-- The team still accepts a case as one unit (the atomic claim, the relay and the alarm are
-- untouched). Afterwards the owner or a dispatcher assigns it to one or more members, or a member
-- takes it. An assigned member - the field crew above all - reads the exact point and the
-- requester's phone of THAT case, reports en route / on site / rescued, and attaches the photos.
-- Access ends when the case moves on (finished, given back, or passed to another team); it never
-- reaches the board, other cases or household data (safety rule 5, owner's decision of 24 Oct).

-- Step 1 left a read policy on the invitations that no grant ever reached: clients read them only
-- through unit_open_invites(), so the policy is removed rather than left to suggest otherwise.
drop policy "authority_unit_invites: the owner and admins read" on public.authority_unit_invites;

create table public.case_assignments (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  unit_id uuid not null references public.authority_units (id),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  assigned_by uuid references public.profiles (user_id) on delete set null,
  self_assigned boolean not null default false,
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index case_assignments_open_idx on public.case_assignments (sos_id, user_id)
  where released_at is null;
create index case_assignments_user_idx on public.case_assignments (user_id) where released_at is null;
create index case_assignments_unit_idx on public.case_assignments (unit_id) where released_at is null;

alter table public.case_assignments enable row level security;
revoke all on public.case_assignments from anon, authenticated;
grant select on public.case_assignments to authenticated;
create policy "case_assignments: the person, the team's owner and dispatchers, admins read"
  on public.case_assignments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_my_unit(unit_id) or public.is_admin());

-------------------------------------------------------------------------------
-- The one question the field screen asks: may this account act on this case as an assigned crew
-- member? Returns the unit that holds the case, or null. Only definer functions call it.
-------------------------------------------------------------------------------
create function public.field_case_access(p_sos uuid, p_uid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.unit_id
    from public.case_assignments a
    join public.sos_claims c on c.sos_id = a.sos_id and c.unit_id = a.unit_id and c.released_at is null
    join public.sos_requests s on s.id = a.sos_id
    join public.authority_units u on u.id = a.unit_id and u.status = 'verified'
   where a.sos_id = p_sos and a.user_id = p_uid and a.released_at is null
     and public.unit_access(a.unit_id, p_uid, '{owner,dispatcher,field}')
     and s.closed_at is null and s.status in ('assigned', 'en_route', 'on_site')
   limit 1
$$;
revoke execute on function public.field_case_access(uuid, uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Assigning
-------------------------------------------------------------------------------
-- The unit that holds this case right now and may still act on it, or null.
create function public.case_holder(p_sos uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.unit_id from public.sos_claims c
    join public.sos_requests s on s.id = c.sos_id
   where c.sos_id = p_sos and c.released_at is null
     and s.closed_at is null and s.status in ('assigned', 'en_route', 'on_site')
$$;
revoke execute on function public.case_holder(uuid) from public, anon, authenticated;

create function public.assign_case(p_sos uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_unit uuid := public.case_holder(p_sos);
  v_id uuid;
begin
  if v_unit is null or not public.unit_access(v_unit, uid) then
    raise exception 'Only the team holding this case can hand it out' using errcode = 'insufficient_privilege';
  end if;
  if not public.unit_access(v_unit, p_user, '{owner,dispatcher,field}') then
    raise exception 'That person is not on this team' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.case_assignments a where a.sos_id = p_sos and a.released_at is null) >= 15 then
    raise exception 'Too many people on one case' using errcode = 'program_limit_exceeded';
  end if;
  insert into public.case_assignments (sos_id, unit_id, user_id, assigned_by)
  values (p_sos, v_unit, p_user, uid)
  on conflict (sos_id, user_id) where released_at is null do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.log_access('case_assigned', 'sos_requests', p_sos::text,
                              jsonb_build_object('member', p_user, 'unit', v_unit));
  end if;
  return v_id;
end $$;

-- A member of the holding team takes a case themselves (a crew with nobody at a laptop).
create function public.take_case(p_sos uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_unit uuid := public.case_holder(p_sos);
  v_id uuid;
begin
  if v_unit is null or not public.unit_access(v_unit, uid, '{owner,dispatcher,field}') then
    raise exception 'This case is not held by your team' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.case_assignments a where a.sos_id = p_sos and a.released_at is null) >= 15 then
    raise exception 'Too many people on one case' using errcode = 'program_limit_exceeded';
  end if;
  insert into public.case_assignments (sos_id, unit_id, user_id, assigned_by, self_assigned)
  values (p_sos, v_unit, uid, uid, true)
  on conflict (sos_id, user_id) where released_at is null do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.log_access('case_taken', 'sos_requests', p_sos::text, jsonb_build_object('unit', v_unit));
  end if;
  return v_id;
end $$;

-- The person steps off the case, or the team's owner or a dispatcher takes them off.
create function public.release_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  a public.case_assignments;
begin
  select * into a from public.case_assignments x where x.id = p_assignment and x.released_at is null for update;
  if a.id is null or not (a.user_id = uid or public.unit_access(a.unit_id, uid)) then
    raise exception 'Not your assignment to release' using errcode = 'insufficient_privilege';
  end if;
  update public.case_assignments set released_at = now() where id = a.id;
  perform public.log_access('case_unassigned', 'sos_requests', a.sos_id::text,
                            jsonb_build_object('member', a.user_id));
end $$;

-------------------------------------------------------------------------------
-- What each screen reads
-------------------------------------------------------------------------------
-- The crew member's own cases: the exact point and what the crew needs on site, for the cases
-- assigned to them and still open. No phone number here: that is a logged reveal.
create function public.my_assigned_cases()
returns table (
  sos_id uuid, assignment_id uuid, status public.sos_status, kind text,
  lat double precision, lon double precision, accuracy_m real, location_text text,
  tambon_name_th text, tambon_name_en text, people_count smallint, vulnerable_flags jsonb,
  depth_ref public.depth_ref, injuries text, text_note text, needs text[], needs_note text,
  unit_id uuid, unit_name text, assigned_at timestamptz, has_phone boolean, crew_count integer
)
language sql stable security definer set search_path = '' as $$
  select s.id, a.id, s.status, s.kind::text,
         extensions.st_y(s.point)::double precision, extensions.st_x(s.point)::double precision,
         s.location_accuracy_m, s.location_text, t.name_th, t.name_en,
         s.people_count, s.vulnerable_flags, s.depth_ref, s.injuries, s.text, s.needs, s.needs_note,
         a.unit_id, u.unit_name, a.assigned_at,
         exists (select 1 from public.sos_contacts sc where sc.sos_id = s.id),
         (select count(*)::integer from public.case_assignments x
           where x.sos_id = s.id and x.released_at is null)
    from public.case_assignments a
    join public.sos_requests s on s.id = a.sos_id
    join public.authority_units u on u.id = a.unit_id
    left join public.tambons t on t.code = s.tambon
   where a.user_id = (select auth.uid()) and a.released_at is null
     and public.field_case_access(a.sos_id, (select auth.uid())) is not null
   order by a.assigned_at
$$;

-- Cases the caller's team holds and nobody on it has taken yet, for "I'll take this". Place at
-- tambon level only: the exact point comes with the assignment.
create function public.my_team_open_cases()
returns table (sos_id uuid, unit_id uuid, unit_name text, kind text, status public.sos_status,
               tambon_name_th text, tambon_name_en text, people_count smallint, crew_count integer)
language sql stable security definer set search_path = '' as $$
  select s.id, c.unit_id, u.unit_name, s.kind::text, s.status, t.name_th, t.name_en, s.people_count,
         (select count(*)::integer from public.case_assignments x
           where x.sos_id = s.id and x.released_at is null)
    from public.sos_claims c
    join public.sos_requests s on s.id = c.sos_id
    join public.authority_units u on u.id = c.unit_id and u.status = 'verified'
    left join public.tambons t on t.code = s.tambon
   where c.released_at is null and s.closed_at is null and s.status in ('assigned', 'en_route', 'on_site')
     and public.unit_access(c.unit_id, (select auth.uid()), '{owner,dispatcher,field}')
     and not exists (select 1 from public.case_assignments x
                      where x.sos_id = s.id and x.user_id = (select auth.uid()) and x.released_at is null)
   order by s.created_at
$$;

-- For the owner and dispatchers: who is on the team and how busy, and who is on which case.
create function public.unit_crew(p_unit uuid)
returns table (user_id uuid, display_name text, role public.unit_member_role, open_cases integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.unit_access(p_unit, (select auth.uid())) then
    raise exception 'Only the team''s owner and dispatchers can see the crew' using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.user_id, p.display_name, m.role,
           (select count(*)::integer from public.case_assignments a
             where a.user_id = m.user_id and a.unit_id = p_unit and a.released_at is null)
      from public.authority_unit_members m
      join public.profiles p on p.user_id = m.user_id
     where m.unit_id = p_unit and m.status = 'active'
     order by (m.role = 'owner') desc, p.display_name;
end $$;

create function public.unit_assignments(p_unit uuid)
returns table (assignment_id uuid, sos_id uuid, user_id uuid, display_name text,
               self_assigned boolean, assigned_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.unit_access(p_unit, (select auth.uid())) then
    raise exception 'Only the team''s owner and dispatchers can see the crew' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.sos_id, a.user_id, p.display_name, a.self_assigned, a.assigned_at
      from public.case_assignments a
      join public.profiles p on p.user_id = a.user_id
     where a.unit_id = p_unit and a.released_at is null
     order by a.assigned_at;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'assign_case(uuid, uuid)', 'take_case(uuid)', 'release_assignment(uuid)',
    'my_assigned_cases()', 'my_team_open_cases()', 'unit_crew(uuid)', 'unit_assignments(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- What an assigned crew member may do on their case: report en route / on site / rescued, attach
-- photos, and look at the requester's number (logged under their own account).
-- (Definitions as on jaga-dev; only the unit lookup and the access checks changed.)
-------------------------------------------------------------------------------
create or replace function public.authority_advance_sos(p_sos_id uuid, p_status public.sos_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := coalesce(public.field_case_access(p_sos_id, (select auth.uid())),
                        public.my_unit_for_sos(p_sos_id));
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

create or replace function public.authority_complete_sos(p_sos_id uuid, p_photos text[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := coalesce(public.field_case_access(p_sos_id, (select auth.uid())),
                        public.my_unit_for_sos(p_sos_id));
  st public.sos_status;
  proof text[];
begin
  select s.status into st from public.sos_requests s where s.id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if mine is null or not exists (select 1 from public.sos_claims c
                                  where c.sos_id = p_sos_id and c.released_at is null
                                    and c.unit_id = mine) then
    raise exception 'Only the team holding this case can report the rescue'
      using errcode = 'insufficient_privilege';
  end if;
  if st not in ('assigned', 'en_route', 'on_site') then
    raise exception 'This case is not open' using errcode = 'check_violation';
  end if;
  proof := public.sos_proof_paths(p_sos_id, p_photos);
  if cardinality(proof) = 0 then
    raise exception 'A photo is required to report a rescue' using errcode = 'check_violation';
  end if;

  update public.sos_claims c
     set completed_at = now(), completion_photos = proof,
         completion_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
   where c.sos_id = p_sos_id and c.released_at is null and c.unit_id = mine;

  -- closed_at stays empty: that is what "not yet confirmed" means.
  update public.sos_requests s set status = 'rescued' where s.id = p_sos_id;

  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'rescued_by_team', (select auth.uid()), mine,
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
end $$;

create or replace function public.sos_media_writable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sos_requests s
    where s.id::text = split_part(p_path, '/', 1)
      and case when split_part(p_path, '/', 2) = 'proof'
               then public.is_admin() or public.covers_tambon(s.tambon)
                    or public.field_case_access(s.id, (select auth.uid())) is not null
               else s.created_at > now() - interval '24 hours' end
  )
$$;

create or replace function public.reveal_sos_phone(p_sos_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  phone text;
begin
  select tambon into t from public.sos_requests where id = p_sos_id;
  if not found then return null; end if;
  if not (public.is_admin() or public.covers_tambon(t)
          or public.field_case_access(p_sos_id, (select auth.uid())) is not null) then
    raise exception 'Not allowed to see this phone number' using errcode = 'insufficient_privilege';
  end if;
  select contact_phone into phone from public.sos_contacts where sos_id = p_sos_id;
  perform public.log_access('reveal_phone', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('had_phone', phone is not null));
  return phone;
end $$;

-------------------------------------------------------------------------------
-- A person handed a case is told on their phone, once (the team's other push kinds are unchanged).
-------------------------------------------------------------------------------
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
  asg record;
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
      -- A person on the team was handed the case (not by taking it themself): tell them once.
      for asg in select x.id, x.user_id from public.case_assignments x
                  where x.sos_id = r.id and x.unit_id = c.unit_id and x.released_at is null
                    and not x.self_assigned loop
        insert into public.push_log (kind, sos_id, ref) values ('assigned', r.id, asg.id::text)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'assigned'::text, ps.endpoint, ps.keys, ps.locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en)
            from public.push_subscriptions ps where ps.user_id = asg.user_id;
        end if;
      end loop;
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
