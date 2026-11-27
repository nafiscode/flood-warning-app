-- Clearing the SOS cases nobody took in three days (owner, 27 Nov 2026).
--
-- A case that has stood open for more than 72 hours with no unit on it is no longer a rescue
-- anybody can act on; left on the war room it buries the ones that are. The owner asked for two
-- things: the war room stops treating them as work, and an admin can take them off the list.
--
--   * The board itself is unchanged (admin_sos_board still returns every open case): the screen
--     moves a case nobody has heard from in 72 hours, with no unit on it, into an "older than 72
--     hours" fold and out of the counters and the alarm. Nothing is hidden from the admin and
--     nothing is closed by code.
--   * An admin clears one case, or the whole fold, with a written reason. The case is closed as
--     `dismissed` (the status that already means "no rescue to make"), a line goes into the case's
--     own history and into audit_log, and nothing is deleted.
--   * An admin can reopen a cleared case. A sender who is still waiting can send again at any
--     time: a new SOS from the same device is a new case once the old one is closed (safety rule 1).
--
-- Code never clears a case by itself. Only an open case no unit holds can be reached: a unit's own
-- work is never taken from it by this.

create function public.sos_stale_hours() returns integer
language sql immutable set search_path = '' as $$ select 72 $$;
revoke execute on function public.sos_stale_hours() from public, anon, authenticated;

-- "Three days" counts from the last time the SENDER was heard, not from the first send: a person
-- who keeps re-sending is merged into the open case as an update (safety rule 1), and a case that
-- is still being updated is not obsolete. An admin's note or a unit's step does not count, only
-- what the sender added.
create function public.sos_last_heard(p_sos uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    r.created_at,
    coalesce((select max(e.created_at) from public.sos_events e
              where e.sos_id = r.id
                and e.event in ('merged_update', 'details_added', 'media_added', 'location_added')),
             r.created_at))
  from public.sos_requests r where r.id = p_sos
$$;
revoke execute on function public.sos_last_heard(uuid) from public, anon, authenticated;

-- The war room asks which open, unheld cases are past the line, so the screen and the clearing
-- functions below can never disagree about it.
create function public.admin_sos_stale_ids() returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select s.id from public.sos_requests s
   where s.status in ('received', 'assigned', 'en_route', 'on_site') and s.closed_at is null
     and public.sos_last_heard(s.id) <= now() - make_interval(hours => public.sos_stale_hours())
     and not exists (select 1 from public.sos_claims c
                     where c.sos_id = s.id and c.released_at is null);
end $$;

-- One case.
create function public.admin_sos_clear_stale(p_sos_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
begin
  perform public.admin_only();
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Clearing a case needs a reason' using errcode = 'check_violation';
  end if;
  select * into s from public.sos_requests r where r.id = p_sos_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  if s.status not in ('received', 'assigned', 'en_route', 'on_site') or s.closed_at is not null then
    raise exception 'That case is closed already' using errcode = 'check_violation';
  end if;
  if public.sos_last_heard(s.id) > now() - make_interval(hours => public.sos_stale_hours()) then
    raise exception 'That case was heard from within % hours', public.sos_stale_hours()
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sos_claims c where c.sos_id = s.id and c.released_at is null) then
    raise exception 'A unit holds that case' using errcode = 'check_violation';
  end if;
  update public.sos_requests set status = 'dismissed', closed_at = now() where id = s.id;
  insert into public.sos_events (sos_id, event, actor_id, note)
  values (s.id, 'cleared_obsolete', (select auth.uid()), left(p_reason, 1000));
  perform public.log_access('clear_stale_sos', 'sos_requests', s.id::text,
                            jsonb_build_object('hours', public.sos_stale_hours()));
end $$;

-- The whole fold in one go. Returns how many it cleared.
create function public.admin_sos_clear_stale_all(p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform public.admin_only();
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Clearing cases needs a reason' using errcode = 'check_violation';
  end if;
  with gone as (
    update public.sos_requests s set status = 'dismissed', closed_at = now()
     where s.status in ('received', 'assigned', 'en_route', 'on_site')
       and s.closed_at is null
       and public.sos_last_heard(s.id) <= now() - make_interval(hours => public.sos_stale_hours())
       and not exists (select 1 from public.sos_claims c
                       where c.sos_id = s.id and c.released_at is null)
    returning s.id
  ), ev as (
    insert into public.sos_events (sos_id, event, actor_id, note)
    select g.id, 'cleared_obsolete', (select auth.uid()), left(p_reason, 1000) from gone g
    returning 1
  )
  select count(*)::integer into n from gone;
  perform public.log_access('clear_stale_sos_all', 'sos_requests', null,
                            jsonb_build_object('cleared', n, 'hours', public.sos_stale_hours()));
  return n;
end $$;

-- Undo: only a case this function closed, and only the latest closing.
create function public.admin_sos_reopen(p_sos_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  last_event text;
begin
  perform public.admin_only();
  select * into s from public.sos_requests r where r.id = p_sos_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  select e.event into last_event from public.sos_events e
   where e.sos_id = s.id and e.event in ('cleared_obsolete', 'reopened_by_admin')
   order by e.created_at desc, e.id desc limit 1;
  if s.status <> 'dismissed' or last_event is distinct from 'cleared_obsolete' then
    raise exception 'That case was not cleared as obsolete' using errcode = 'check_violation';
  end if;
  update public.sos_requests set status = 'received', closed_at = null where id = s.id;
  insert into public.sos_events (sos_id, event, actor_id)
  values (s.id, 'reopened_by_admin', (select auth.uid()));
  perform public.log_access('reopen_sos', 'sos_requests', s.id::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_sos_stale_ids()',
    'public.admin_sos_clear_stale(uuid, text)',
    'public.admin_sos_clear_stale_all(text)',
    'public.admin_sos_reopen(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
