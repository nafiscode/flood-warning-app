-- An SOS nobody has taken for 30 minutes opens to every rescue team (owner, 27 Nov 2026).
--
-- Until now the exact point and the phone number of a request reached only the verified teams
-- that cover its tambon, and the admins (safety rule 5). When no covering team answers - or none
-- covers the tambon at all - the person is waiting and the teams that could reach them cannot
-- even see where they are. The owner's decision: after the case has gone unanswered for 30
-- minutes (`system_settings.sos_escalate_minutes`), every verified team that has the rescue
-- capability may read its point and, through a logged reveal, the sender's number, to arrange
-- help outside the app. This AMENDS rule 5 for this one case and nothing wider.
--
-- What does NOT change, and is tested:
--   * Existing reads are untouched: authority_board(), reveal_sos_phone(), the sos_requests
--     policies and the SOS media paths are not re-created here. This file adds functions only.
--   * Who: the owner and active dispatchers of a verified unit with the `rescue` capability. Not
--     a field member (who reads only what is assigned to them), not a dam-only or planning unit
--     (they hold no `rescue`), not a pending or suspended unit, not an ordinary user.
--   * Which cases: open and held by no unit, a rescue (not supplies), not merged into another, not
--     a suspected nuisance send an admin has not cleared, the sender heard from within 72 hours,
--     and unanswered for at least the setting. It stops by itself when any team accepts, the
--     sender closes it, an admin clears it, or the 72 hours pass.
--   * What: the point, the tambon, how many people, the vulnerable flags, the depth, injuries and
--     the sender's own words. No photo, no voice note, no name, no account.
--   * The phone: the same single number, only through reveal_escalated_sos_phone(), which names
--     the case and the caller's own teams in audit_log on every look. Never in the list.
--   * Cases inside the caller's own coverage are left out of the list: they are already on their
--     board with everything a covering team reads.

insert into public.system_settings (key, value, note) values
  ('sos_escalate_minutes',
   '{"minutes": 30}'::jsonb,
   'An open SOS no team holds, unanswered for this many minutes, is opened to every verified team with the rescue capability: its point, and its number through a logged reveal, so a team outside the tambon can arrange help outside the app (owner, 27 Nov 2026; amends safety rule 5 for this case only).')
on conflict (key) do nothing;

-- The caller runs a verified rescue team: its owner or an active dispatcher.
create function public.is_rescue_team_person() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.authority_units u
     where u.status = 'verified'
       and 'rescue' = any (u.capabilities)
       and public.unit_access(u.id, (select auth.uid()))
  )
$$;
revoke execute on function public.is_rescue_team_person() from public, anon;
grant execute on function public.is_rescue_team_person() to authenticated;

-- One case: has it gone unanswered long enough to be opened to every rescue team?
create function public.sos_is_escalated(p_sos uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sos_requests s
     where s.id = p_sos
       and s.status = 'received'
       and s.closed_at is null
       and s.kind = 'rescue'
       and s.duplicate_of is null
       and s.created_at <= now() - make_interval(
             mins => public.setting_int('sos_escalate_minutes', 'minutes', 30))
       and not exists (select 1 from public.sos_claims c
                       where c.sos_id = s.id and c.released_at is null)
       and not exists (select 1 from public.sos_review r
                       where r.sos_id = s.id and r.suspected_spam and r.spam_dismissed_at is null)
       and public.sos_last_heard(s.id) > now() - make_interval(hours => public.sos_stale_hours())
  )
$$;
revoke execute on function public.sos_is_escalated(uuid) from public, anon, authenticated;

-- The list a rescue team reads: the escalated cases outside its own coverage.
create function public.authority_escalated_cases()
returns table (
  sos_id uuid, created_at timestamptz, waiting_minutes integer,
  lat double precision, lon double precision, accuracy_m real, location_text text,
  tambon text, tambon_th text, tambon_en text, district_th text, province_th text,
  people_count smallint, vulnerable_flags jsonb, depth_ref public.depth_ref,
  injuries text, note text, has_phone boolean, on_behalf boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if not public.is_rescue_team_person() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_ids
    from public.sos_requests s
   where public.sos_is_escalated(s.id) and not public.covers_tambon(s.tambon);
  -- Reading an exact point is logged, once in ten minutes while a list is being read.
  if cardinality(v_ids) > 0 and not exists (
    select 1 from public.audit_log
     where actor = (select auth.uid()) and action = 'read_escalated_sos'
       and ts > now() - interval '10 minutes'
  ) then
    perform public.log_access('read_escalated_sos', 'sos_requests', null,
                              jsonb_build_object('cases', cardinality(v_ids)));
  end if;
  return query
  select s.id, s.created_at,
         greatest(0, floor(extract(epoch from (now() - s.created_at)) / 60))::integer,
         round(extensions.st_y(s.point)::numeric, 5)::double precision,
         round(extensions.st_x(s.point)::numeric, 5)::double precision,
         s.location_accuracy_m, s.location_text,
         s.tambon, t.name_th, t.name_en, d.name_th, pv.name_th,
         s.people_count, s.vulnerable_flags, s.depth_ref,
         s.injuries, s.text,
         exists (select 1 from public.sos_contacts sc
                  where sc.sos_id = s.id and sc.contact_phone is not null),
         s.on_behalf
    from public.sos_requests s
    left join public.tambons t on t.code = s.tambon
    left join public.districts d on d.code = t.district_code
    left join public.provinces pv on pv.code = t.province_code
   where s.id = any (v_ids)
   order by s.created_at;
end $$;

-- The sender's number, for one escalated case, one look at a time, always logged.
create function public.reveal_escalated_sos_phone(p_sos_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  phone text;
  v_units uuid[];
begin
  if not public.is_rescue_team_person() then
    raise exception 'Not allowed to see this phone number' using errcode = 'insufficient_privilege';
  end if;
  if not public.sos_is_escalated(p_sos_id) then
    raise exception 'This case is not open to other teams' using errcode = 'insufficient_privilege';
  end if;
  select contact_phone into phone from public.sos_contacts where sos_id = p_sos_id;
  select coalesce(array_agg(u.id), '{}') into v_units
    from public.authority_units u
   where u.status = 'verified' and 'rescue' = any (u.capabilities)
     and public.unit_access(u.id, (select auth.uid()));
  perform public.log_access('reveal_phone_escalated', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('had_phone', phone is not null, 'units', v_units));
  return phone;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.authority_escalated_cases()',
    'public.reveal_escalated_sos_phone(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
