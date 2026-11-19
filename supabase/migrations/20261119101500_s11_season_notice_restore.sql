-- Restore the bell's 'seasonNotice' queue on a database where it was lost.
--
-- 20261110011000_s11_season_notice rebuilt admin_attention() whole, adding the seasonNotice queue
-- on top of the version in 20261109120100_a12_dam_operator. A12 carries the EARLIER timestamp but
-- was applied to jaga-dev by hand AFTER S11 on 10 Nov 2026, so its 'create or replace' silently
-- dropped the new queue again: season_notices rows were still written, but no admin's bell ever
-- counted them. Found 19 Nov 2026 by tests/rls/season-state.test.ts ("stands in the bell as a
-- silent queue"), confirmed against the live function definition.
--
-- The migrations themselves are in the right order, so a rebuild from scratch was never wrong and
-- this file is a no-op there: the body below is 20261110011000's block copied word for word, and
-- its timestamp puts it after every migration that touches this function. Nothing but the one
-- function changes; no data is read or written.
--
-- Advisory only, as Module 11 always was: a queue in the admins' bell, never a published alert
-- (safety rule 2).

create or replace function public.admin_attention()
returns table (queue text, waiting integer, newest_id text, newest_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();

  -- Teams that have registered and are waiting to be verified.
  return query
  select 'units', count(*)::integer,
         (select u.id::text from public.authority_units u where u.status = 'pending'
           order by u.created_at desc limit 1),
         max(u.created_at)
    from public.authority_units u where u.status = 'pending';

  -- Residents' flood reports waiting to be moderated before they are shown to anyone.
  return query
  select 'reports', count(*)::integer,
         (select r.id::text from public.reports r where r.moderation_status = 'pending'
           order by r.created_at desc limit 1),
         max(r.created_at)
    from public.reports r where r.moderation_status = 'pending';

  -- A dam has graded "releasing" and raised a notice. Nothing has gone to anybody: a person
  -- reviews it and sends the release notice themselves (spec 15, safety rule 2).
  return query
  select 'damNotice', count(*)::integer,
         (select n.id::text from public.dam_notices n where n.status = 'open'
           order by n.raised_at desc limit 1),
         max(n.raised_at)
    from public.dam_notices n where n.status = 'open';

  -- Cases flagged as possible spam. They were delivered like any other (safety rule 1): this is
  -- the admin's chance to dismiss the flag, not to decide whether somebody gets help.
  return query
  select 'spam', count(*)::integer,
         (select v.sos_id::text from public.sos_review v
            join public.sos_requests s on s.id = v.sos_id
           where v.suspected_spam and v.spam_dismissed_at is null
           order by s.created_at desc limit 1),
         max(s.created_at)
    from public.sos_review v
    join public.sos_requests s on s.id = v.sos_id
   where v.suspected_spam and v.spam_dismissed_at is null;

  -- Cases that look like the same emergency reported twice, not yet merged or told apart.
  return query
  select 'duplicates', count(*)::integer,
         (select s.id::text from public.sos_requests s
           where s.possible_duplicate_of is not null and s.duplicate_of is null
           order by s.created_at desc limit 1),
         max(s.created_at)
    from public.sos_requests s
   where s.possible_duplicate_of is not null and s.duplicate_of is null;

  -- A team says it finished a rescue and nobody has confirmed it. The existing function owns the
  -- rule for how long is too long, so it is asked rather than second-guessed here.
  return query
  select 'unconfirmed', count(*)::integer, null::text, max(x.completed_at)
    from public.admin_unconfirmed_rescues() x where x.due;

  /*
   * An alert still in force whose next-update time has passed. The public already sees the grey
   * "not updated since" marker on it (safety rule 3) - this is the only line here that is not an
   * approval queue, and it is in the bell because the one thing worse than a stale alert is a
   * stale alert nobody has been told about. The admin extends, replaces or cancels it.
   */
  return query
  select 'staleAlerts', count(*)::integer,
         (select a.id::text from public.alerts a
           where a.cancelled_at is null and a.superseded_by is null
             and a.next_update_at < now()
           order by a.next_update_at desc limit 1),
         max(a.next_update_at)
    from public.alerts a
   where a.cancelled_at is null and a.superseded_by is null
     and a.next_update_at < now();

  /*
   * A12 part 2 (9 Nov 2026): a dam release notice the dam's own operator sent. This is not an
   * approval queue either - it has already gone out, by the owner's design - it is the admins
   * finding out, which spec 15 requires them to do at the same moment. Six hours, which is the
   * window in which an admin would extend, supersede or cancel it.
   */
  return query
  select 'operatorRelease', count(*)::integer,
         (select a.id::text from public.alerts a
           where a.signals_snapshot ->> 'sent_by' = 'operator'
             and a.issued_at > now() - interval '6 hours'
           order by a.issued_at desc limit 1),
         max(a.issued_at)
    from public.alerts a
   where a.signals_snapshot ->> 'sent_by' = 'operator'
     and a.issued_at > now() - interval '6 hours';

  -- A zone whose river has been rising for a week with the rain behind it (science plan Module 11).
  -- Nothing has gone to anybody but the admins: a person reads the figures and decides whether to
  -- send a Watch from the reviewed template (safety rule 2).
  return query
  select 'seasonNotice', count(*)::integer,
         (select n.id::text from public.season_notices n where n.status = 'open'
           order by n.raised_at desc limit 1),
         max(n.raised_at)
    from public.season_notices n where n.status = 'open';
end $$;

revoke execute on function public.admin_attention() from public, anon;
grant execute on function public.admin_attention() to authenticated;
