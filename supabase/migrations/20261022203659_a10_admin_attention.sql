-- A10: everything waiting for an admin, in one answer, for the bell (the owner, 22 Oct: "make
-- all that need admins attention goes to Admin's notification bell (Admin only)").
--
-- The admin home has counted three of these on its menu since it was built, but the bell - the
-- thing an admin actually carries around - knew about only two: the automatic alarms and the
-- field rescues. So a team could sit unverified for a day because nobody opened the right page.
--
-- One row per queue, shaped exactly like admin_field_waiting() already is: how many wait, and
-- the newest one's id and time. The id is what the bell remembers as "read", so a queue becomes
-- unread again when something newer joins it, and stays in the list while anything waits.
--
-- These are backlogs, not events: the owner chose (22 Oct) that they never ring and are never
-- pushed. The pending automatic alarm keeps its sound, because that one publishes itself if
-- nobody acts (safety rule 2's one exception), and it is already in the bell.
--
-- Admins only, by admin_only(), and no personal data of any kind crosses this boundary: a count,
-- an id and a time. Nothing here names a person, a phone or a place.

create function public.admin_attention()
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
end $$;

revoke execute on function public.admin_attention() from public, anon;
grant execute on function public.admin_attention() to authenticated;

comment on function public.admin_attention() is
  'One row per queue waiting for an admin: how many, and the newest one. Admins only, counts only.';
