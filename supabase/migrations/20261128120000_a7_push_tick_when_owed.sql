-- The one-minute knock on Jaga's server goes out when something is OWED, not only while a request
-- for help is open (the owner, 28 Nov 2026, asked to see what eats the free plans and to minimise
-- it; reading `push_tick()` for that turned up a gap).
--
-- THE GAP. `push_tick()` was written in A7 (13 Oct) when the server's tick carried only the
-- notifications about requests for help, so it skipped the knock while no request was open. On
-- 15 Oct a second reason to knock was added (an admin's decision waiting to be told). Since then
-- the same tick on the server has taken on more work, and none of it was added to the knock's
-- condition:
--
--   * the automated alarm's push to every admin, and to the phones in the alert's tambons
--     (`auto_alarm_push_due`), and its LINE copy (`line_auto_alert_due`);
--   * the season-state notice to every admin (`push_season_due`);
--   * the super admin's "upgrade now" push for the free plans (`push_plan_due`, 27 Nov).
--
-- `auto_alarm_check()` publishes in SQL and calls no server, so with no request open and no
-- decision waiting, nothing asked the server to send the alarm's notifications until some other
-- action happened to run the tick (an admin publishing, a team acting, a request arriving). The
-- alert itself is published and visible at once; it is the phone's buzz and the LINE message that
-- could wait. That is the one path in Jaga where nobody is at a screen to run the tick by hand.
-- NOT proven on a live alarm (none has fired since the tick was last changed: `auto_alarm_events`
-- is empty); proven by reading the function and the cron job, and by the test below.
--
-- THE FIX has two halves, so a source nobody remembered to add can be late but never lost:
--
--   1. `push_tick_owed()` says exactly when something is waiting that must not wait for the safety
--      net: a request nobody holds (an offer runs out, or a request goes unclaimed, with the
--      clock), a decision not yet told, an alarm event whose notifications are not all marked
--      sent, a season notice nobody has been told about.
--   2. A safety-net knock every ten minutes whatever the answer (minutes :07, :17, ... of the
--      hour). The plan push runs at :17 on the server, which is one of them. Every notification
--      the server's tick sends, now or added later, is therefore at most ten minutes late.
--
-- WHAT A REQUEST THAT SOMEBODY HOLDS NO LONGER COSTS. The old condition knocked every minute for as
-- long as any request was open (up to 3 days), including one a team had accepted: 1,440 calls a day
-- to Vercel, each running about seven database calls, to find nothing owed. A request somebody
-- holds changes only when a person acts on it, and every such action already runs the tick
-- straight away (`after(runPushTick)` in the SOS, authority and admin routes), so the minute knock
-- added only delay-free repeats. It keeps knocking every minute while a request is UNCLAIMED, the
-- only state that changes with the clock.
--
-- Everything else in `push_tick()` is the live definition, unchanged (taken from
-- `pg_get_functiondef` on 28 Nov 2026, not from the earlier migrations).
--
-- Nothing here publishes, sends or reads anything personal: `push_tick_owed()` returns one
-- boolean and is reachable by no client.

create function public.push_tick_owed(p_now timestamptz default now())
returns boolean
language sql stable security definer set search_path = '' as $$
  select
    -- 1. A request nobody holds: its offer to a team runs out, and it goes "unclaimed" to the
    --    admins, both with the clock. Duplicates are never owed (push_due skips them too).
    exists (
      select 1 from public.sos_requests s
       where s.created_at > now() - interval '3 days'
         and s.duplicate_of is null
         and (s.status in ('received', 'assigned', 'en_route', 'on_site')
              or (s.status = 'rescued' and s.closed_at is null))
         and not exists (select 1 from public.sos_claims cl
                          where cl.sos_id = s.id and cl.released_at is null))
    -- 2. An admin's decision waiting to be told (unchanged from 20261015030700).
    or exists (
      select 1 from public.admin_decisions_since(now() - interval '3 days') x
       where not exists (select 1 from public.line_decision_log l where l.audit_id = x.audit_id))
    -- 3. An automated alarm that has fired and whose notifications are not all marked as sent.
    --    The conditions are those of auto_alarm_push_due() and line_auto_alert_due(), so a drill
    --    nobody outside sees is not waited for forever.
    or exists (
      select 1 from public.auto_alarm_events x
       where x.created_at > now() - interval '1 day'
         and (
           (x.status = 'pending'
            and not exists (select 1 from public.auto_alarm_pushed m
                             where m.event_id = x.id and m.kind = 'admins'))
           or (x.status = 'auto_published' and x.alert_id is not null and (
                not exists (select 1 from public.auto_alarm_pushed m
                             where m.event_id = x.id and m.kind = 'admins_sent')
                or (exists (select 1 from public.alerts al
                             where al.id = x.alert_id
                               and (not al.is_drill or 'everyone' = any (al.drill_audience))
                               and al.cancelled_at is null and al.superseded_by is null)
                    and not exists (select 1 from public.auto_alarm_pushed m
                                     where m.event_id = x.id and m.kind = 'public'))
                or (exists (select 1 from public.alerts al
                             where al.id = x.alert_id
                               and 'line' = any (al.channels)
                               and (not al.is_drill or 'everyone' = any (al.drill_audience))
                               and al.cancelled_at is null and al.superseded_by is null)
                    and not exists (select 1 from public.auto_alarm_pushed m
                                     where m.event_id = x.id and m.kind = 'line'))
              )))
    )
    -- 4. A season-state notice raised in the last two days that nobody has been told about.
    or exists (
      select 1 from public.season_notices n
       where n.status = 'open' and n.raised_at > now() - interval '2 days'
         and not exists (select 1 from public.season_pushed sp where sp.notice_id = n.id))
    -- 5. The safety net: every ten minutes, at :07, :17, :27, :37, :47 and :57 (UTC), whatever the
    --    rest says. Anything the server's tick sends that is not named above rides on this.
    or (extract(minute from (p_now at time zone 'utc'))::integer % 10) = 7
$$;
revoke all on function public.push_tick_owed(timestamptz) from public, anon, authenticated;

create or replace function public.push_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.push_gate;
begin
  select * into g from public.push_gate limit 1;
  if g.site_url is null then
    return;
  end if;
  if not public.push_tick_owed() then
    return;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  perform extensions.http((
    'POST', g.site_url || '/api/push/tick',
    array[extensions.http_header('x-jaga-push', g.token)],
    'application/json', '{}'
  )::extensions.http_request);
exception when others then
  -- A site that is down must not fill the cron log with errors, or stop the next minute's try.
  null;
end $$;
