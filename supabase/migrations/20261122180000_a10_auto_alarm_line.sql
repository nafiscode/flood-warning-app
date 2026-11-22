-- The automatic alarm's alerts travel LINE too, with a switch the owner can turn off.
--
-- The owner, 22 Nov 2026: "for the LINE Channel, add in the Alert, that I can switch on or off, as
-- of now make it on as default, but I can switch off anytime."
--
-- Found on 22 Nov while checking the alarm against the live database: an alert an admin publishes
-- carries `channels = {push, line}`, because the console ticks them. An alert the alarm publishes
-- is created inside the database, which ticked nothing, so it took the column default
-- `ARRAY['push']` - and `line_targets_for_alert` then refuses the road that was not ticked. The
-- result was that the one alert path with no human in it was also the one path that never reached
-- LINE, while 45 accounts have LINE against 11 web-push devices. spec.md 6.2 says the default is
-- "push and LINE", so the schema and the spec disagreed; this settles it in the spec's favour.
--
-- Three parts:
--   1. `system_settings.auto_alarm.line`, true, and `admin_set_auto_alarm_line()` to change it.
--   2. `auto_alarm_publish()` sets `channels` from that switch. Rebuilt from the LIVE body, not
--      from the last migration file, so nothing since it is reverted.
--   3. `line_auto_alert_due()`, so the server's own tick can send them. The admin road
--      (`line_targets_for_alert`) is `admin_only()` and is called from the publish screen; an
--      automatic alert has no admin and no screen, so it needs a gate-token road of its own. Each
--      alert is booked once in `auto_alarm_pushed`, the same way the pushes already are.
--
-- Turning the switch off takes LINE off future automatic alerts only. Nothing here can publish an
-- alert, change a level, or make the alarm speak when it otherwise would not (safety rule 2): it
-- decides only which roads an alert that is already going out travels.

-------------------------------------------------------------------------------
-- 1. The switch
-------------------------------------------------------------------------------
update public.system_settings
   set value = value || jsonb_build_object('line', true),
       note = note || ' `line`: whether an alert this alarm publishes also goes out over LINE '
                   || '(the owner, 22 Nov 2026; on unless an admin turns it off).'
 where key = 'auto_alarm';

create function public.admin_set_auto_alarm_line(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  update public.system_settings set value = value || jsonb_build_object('line', coalesce(p_on, true))
   where key = 'auto_alarm';
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'auto_alarm_line', 'system_settings', null,
            jsonb_build_object('line', coalesce(p_on, true)));
end $$;
revoke all on function public.admin_set_auto_alarm_line(boolean) from public, anon, authenticated;
grant execute on function public.admin_set_auto_alarm_line(boolean) to authenticated;

-------------------------------------------------------------------------------
-- 2. What the alarm publishes now says which roads it travels
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_alarm_publish(p_event uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  e public.auto_alarm_events;
  tpl uuid;
  codes text[];
  issuer uuid;
  subject text;
  detail text;
  hours integer;
  drill boolean;
  audience text[];
  old public.alerts;
  f record;
  v_alert uuid;
begin
  select * into e from public.auto_alarm_events where id = p_event for update;
  drill := coalesce(cfg ->> 'mode', 'drill') <> 'real';
  -- A drill published by the alarm is sent, so it proves the road a real alert travels
  -- (migration 20261020220000). A real alert never carries an audience.
  audience := case when drill then coalesce(
      (select array_agg(value) from jsonb_array_elements_text(cfg -> 'drill_audience') as value),
      '{}'::text[]) else '{}'::text[] end;

  if e.dam_code is not null then
    select array_agg(t.tambon_code order by t.tambon_code) into codes
      from public.dam_tambons t
      join public.dams d on d.code = t.dam_code and d.geometry_source = t.source
     where t.dam_code = e.dam_code;
    select g.set_by into issuer from public.auto_alarm_dams g where g.dam_code = e.dam_code;
    select coalesce(d.name ->> 'th', d.code) into subject from public.dams d
     where d.code = e.dam_code;
    hours := coalesce((cfg -> 'reservoir' ->> 'next_update_h')::integer, 12);
    detail := format('%s %s Mm3 (%s Mm3) %s', subject, round(e.value::numeric, 2),
                     round(e.threshold::numeric, 2),
                     to_char(e.observed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'));
  else
    select array_agg(t.tambon_code order by t.tambon_code) into codes
      from public.warning_zone_tambons t where t.zone_id = e.zone_id;
    select g.set_by into issuer from public.auto_alarm_gauges g where g.station_id = e.station_id;
    select s.code into subject from public.stations s where s.id = e.station_id;
    hours := coalesce((cfg ->> 'next_update_h')::integer, 3);
    detail := format('%s %s m (%s m) %s', subject, round(e.value::numeric, 2),
                     round(e.threshold::numeric, 2),
                     to_char(e.observed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'));
  end if;

  if e.level = 'return' then
    select x.id into tpl from public.alert_templates x where x.code = 'flood_return' and x.active;
    hours := coalesce((cfg -> 'clear' ->> 'next_update_h')::integer, 24);
    -- The alert being answered must still be in force, and the area is the one it covered, not
    -- whatever the zone looks like now: the all-clear reaches exactly the people who were warned.
    select a.* into old from public.alerts a where a.id = e.supersedes for update;
    if old.id is null or old.superseded_by is not null or old.cancelled_at is not null then
      update public.auto_alarm_events set status = 'lapsed', decided_at = now(),
             note = 'the alert it would have replaced is no longer in force' where id = p_event;
      return null;
    end if;
    select array_agg(t.tambon order by t.tambon) into codes
      from public.alert_tambons t where t.alert_id = old.id;
    -- A drill clears a drill and a real alert clears a real one; never across.
    drill := old.is_drill;
    audience := old.drill_audience;
    issuer := coalesce(old.issued_by, issuer);
  else
    if e.dam_code is not null then
      select x.id into tpl from public.alert_templates x
        where x.code = 'reservoir_full_warning' and x.active;
    else
      select x.id into tpl from public.alert_templates x
        where x.code = 'flood_' || e.level::text and x.active;
    end if;
  end if;

  if issuer is null then
    select p.user_id into issuer from public.profiles p where p.role = 'super_admin' limit 1;
  end if;
  if tpl is null or codes is null or issuer is null then
    update public.auto_alarm_events set status = 'lapsed',
           note = 'no template, tambons or issuer' where id = p_event;
    return null;
  end if;

  select * into f from public.alert_fill(tpl, codes, detail);
  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             is_drill, drill_audience, template_id, signals_snapshot, channels)
    values (f.hazard_type, f.level, f.reason,
            case when drill and cardinality(audience) > 0
                 then public.alert_drill_messages(f.level, codes) else f.messages end,
            issuer, now() + make_interval(hours => hours), drill, audience, tpl,
            jsonb_build_object('kind', case when e.level = 'return' then 'auto_all_clear'
                                            else 'auto_alarm' end,
                               'event', e.id, 'subject', subject, 'dam', e.dam_code,
                               'gauge', case when e.dam_code is null then subject end,
                               'value', e.value, 'threshold', e.threshold,
                               'observed_at', e.observed_at, 'reviewed', false,
                               'supersedes', e.supersedes),
            -- The roads this alert travels. An admin publishing by hand ticks them; nothing ticked
            -- them here, so until now an automatic alert took the column default and LINE was
            -- silently left out of the one path nobody is watching. The owner's switch of
            -- 22 Nov 2026 decides it, and it starts on.
            case when coalesce((cfg ->> 'line')::boolean, true)
                 then array['push', 'line']::text[] else array['push']::text[] end)
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;
  if e.supersedes is not null then
    update public.alerts set superseded_by = v_alert where id = e.supersedes;
  end if;
  update public.auto_alarm_events set status = 'auto_published', alert_id = v_alert,
         decided_at = now() where id = p_event;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (null,
            case when e.level = 'return' then 'alert_auto_all_clear'
                 else 'alert_auto_published' end, 'alerts', v_alert,
            jsonb_build_object('event', e.id, 'subject', subject, 'dam', e.dam_code,
                               'level', e.level, 'drill', drill, 'audience', audience,
                               'supersedes', e.supersedes,
                               'tambons', array_length(codes, 1)));
  return v_alert;
end $function$;

-------------------------------------------------------------------------------
-- 3. The road the server's tick sends them down
-------------------------------------------------------------------------------
-- A third booking kind beside 'admins', 'public' and 'admins_sent', so one alert is sent to LINE
-- once however often the tick runs.
alter table public.auto_alarm_pushed
  drop constraint auto_alarm_pushed_kind_check,
  add constraint auto_alarm_pushed_kind_check
    check (kind in ('admins', 'public', 'admins_sent', 'line'));

/*
 * The LINE recipients of every alert this alarm has published and not yet sent, claimed as they
 * are returned so a second tick sends nobody twice. Deliberately narrow: it answers only for an
 * alert raised by `auto_alarm_events`, only while that alert stands, only when the alert carries
 * the 'line' road, and never for a drill unless its audience is everyone - the same three tests
 * `line_targets_for_alert` applies to an admin's own alert.
 *
 * It is the gate token's, not an admin's: the tick that calls it has no session. The token is the
 * same one the push tick proves itself with (`push_gate_ok`).
 */
create function public.line_auto_alert_due(p_token text)
returns table (alert_id uuid, level public.alert_level, messages jsonb,
               template_messages jsonb, next_update_at timestamptz, tambons integer,
               line_user_id text, locale text, placeless boolean)
language plpgsql security definer set search_path = '' as $$
declare e record; fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  -- The words travel with the recipients, so the tick needs no read of its own on `alerts`.
  for e in select x.id, al.id as alert_id, al.level, al.messages, al.next_update_at,
                  (select t.messages from public.alert_templates t where t.id = al.template_id)
                    as template_messages,
                  (select count(*)::integer from public.alert_tambons t where t.alert_id = al.id)
                    as tambons
             from public.auto_alarm_events x
             join public.alerts al on al.id = x.alert_id
            where x.status = 'auto_published'
              and x.created_at > now() - interval '1 day'
              and al.cancelled_at is null and al.superseded_by is null
              and 'line' = any (al.channels)
              and (not al.is_drill or 'everyone' = any (al.drill_audience)) loop
    insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'line')
      on conflict do nothing;
    get diagnostics fresh = row_count;
    continue when fresh = 0;
    -- Their own places are in it, so the personal wording is the truthful one; somebody who has
    -- never chosen a place reads the alert's own words instead (the owner, 21 Oct 2026).
    return query
      select e.alert_id, e.level, e.messages, e.template_messages, e.next_update_at, e.tambons,
             p.line_user_id, p.preferred_locale, false
        from public.alert_recipients(e.alert_id) r
        join public.profiles p on p.user_id = r.user_id
       where p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
    return query
      select e.alert_id, e.level, e.messages, null::jsonb, e.next_update_at, e.tambons,
             p.line_user_id, p.preferred_locale, true
        from public.users_without_a_place() u
        join public.profiles p on p.user_id = u
       where p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
  end loop;
end $$;
revoke all on function public.line_auto_alert_due(text) from public, anon, authenticated;

/*
 * The delivery figures and the LINE quota, kept exactly as they were.
 *
 * `line_record_alert` is `admin_only()`, and the tick that sends an automatic alert has no
 * session, so it cannot use it. Rather than keep a second copy of the bookkeeping - which would
 * drift, and the quota warning is the kind of thing that must not - the body moves here, with no
 * guard and reachable by no client, and both roads call it: `line_record_alert` after its
 * admin_only(), and `line_auto_alert_sent` after the gate token. The figures, the 70% and 90%
 * marks and the access log are therefore identical whoever published.
 */
create function public.line_alert_recorded(p_alert uuid, p_recipients integer, p_failed integer,
                                           p_used integer, p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', now())::date;
  q public.line_quota_usage;
  share numeric;
  mark integer;
begin
  insert into public.alert_deliveries (alert_id, channel, recipients, line_messages_used, status, sent_at)
  values (p_alert, 'line', greatest(coalesce(p_recipients, 0), 0),
          greatest(coalesce(p_recipients, 0), 0),
          case when coalesce(p_failed, 0) > 0 then 'partial' else 'sent' end, now());
  if p_used is null or coalesce(p_limit, 0) <= 0 then
    return null;
  end if;
  insert into public.line_quota_usage (month, messages_used, monthly_limit, checked_at)
  values (m, p_used, p_limit, now())
  on conflict (month) do update
    set messages_used = excluded.messages_used, monthly_limit = excluded.monthly_limit,
        checked_at = now()
  returning * into q;
  share := q.messages_used::numeric / q.monthly_limit;
  mark := case when share >= 0.9 then 90 when share >= 0.7 then 70 end;
  if mark is null or coalesce(q.warned_at, 0) >= mark then
    return null;
  end if;
  update public.line_quota_usage set warned_at = mark where month = m;
  perform public.log_access('line_quota_warning', 'line_quota_usage', m::text,
                            jsonb_build_object('percent', mark, 'used', q.messages_used,
                                               'limit', q.monthly_limit));
  return mark;
end $$;
revoke all on function public.line_alert_recorded(uuid, integer, integer, integer, integer)
  from public, anon, authenticated;

-- An admin's own alert: the guard it always had, then the shared body.
create or replace function public.line_record_alert(p_alert uuid, p_recipients integer,
                                                    p_failed integer, p_used integer,
                                                    p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return public.line_alert_recorded(p_alert, p_recipients, p_failed, p_used, p_limit);
end $$;

-- The tick's road to the same bookkeeping, proved by the gate token instead of a session.
create function public.line_auto_alert_sent(p_token text, p_alert uuid, p_recipients integer,
                                            p_failed integer, p_used integer, p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return public.line_alert_recorded(p_alert, p_recipients, p_failed, p_used, p_limit);
end $$;
revoke all on function public.line_auto_alert_sent(text, uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
