-- Team war room, step 3 (24 Oct 2026): what the laptop and tablet view needs from the database.
--
-- 1. The team's record by person: for each member of a team, the cases they took part in and the
--    rescues they reported. Seen by the team's owner and dispatchers only; it is counted from the
--    assignments and the timeline, so nothing is added to the points ledger (points stay with
--    the team, owner's default of 24 Oct).
-- 2. Live updates. The war room asks the database to say when a case, a claim or an assignment
--    changes, and then reads the board again. The event only nudges: the board itself still
--    comes from authority_board(), and Realtime delivers a row only to someone whose own read
--    policy lets them see it, so no one hears about a case they could not read.

create function public.unit_member_record(p_unit uuid)
returns table (user_id uuid, display_name text, role public.unit_member_role,
               cases_taken integer, rescues_reported integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.unit_access(p_unit, (select auth.uid())) then
    raise exception 'Only the team''s owner and dispatchers can see the record'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.user_id, p.display_name, m.role,
           (select count(distinct a.sos_id)::integer from public.case_assignments a
             where a.unit_id = p_unit and a.user_id = m.user_id),
           (select count(distinct e.sos_id)::integer from public.sos_events e
             where e.unit_id = p_unit and e.actor_id = m.user_id and e.event = 'rescued_by_team')
      from public.authority_unit_members m
      join public.profiles p on p.user_id = m.user_id
     where m.unit_id = p_unit and m.status = 'active'
     order by 5 desc, 4 desc, p.display_name;
end $$;
revoke execute on function public.unit_member_record(uuid) from public, anon;
grant execute on function public.unit_member_record(uuid) to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sos_requests', 'sos_claims', 'case_assignments'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
