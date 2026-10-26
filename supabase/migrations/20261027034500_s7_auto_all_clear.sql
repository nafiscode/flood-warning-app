-- The automated alarm says when it is over, too (the owner, 27 Oct 2026).
--
-- Until now the automated path could only raise an alert. Nothing took it down: the alert stood
-- with its level until an admin superseded it by hand, and after the next-update time had passed
-- it wore the grey "not updated since" marker (safety rule 3) - which is honest but is not the
-- same as telling people the water has gone. The owner asked that when the water goes down the
-- same road carries the all-clear, and that it replaces the alert it answers, for the river gauges
-- as well as for the reservoirs.
--
-- It uses the one reviewed template there already is for this, `flood_return`, and the same
-- machinery as the alarm: a draft, every admin's phone, a grace time, a re-reading at the end of
-- it, and the access log. An admin can still dismiss it, and then the alert stands as it was.
--
-- "Safe to return" is the strongest thing this app ever says, so it is the hardest to trigger:
--
--   * the water must be **clearly** back down, not merely a hair under the line that fired the
--     alert. A reservoir must be under `clear.reservoir_pct` of capacity - well below the share
--     that raised the alarm - and a gauge under its own threshold by `clear.gauge_margin_m`.
--     Without that margin a reading wobbling across the line would flap between warning and
--     all-clear, which is worse than either.
--   * it must be down for `clear.readings` readings in a row, all of them fresh.
--   * the alert must have stood for `clear.min_hours` first. An alert cleared twenty minutes
--     after it was raised was a false alarm, and the way to deal with one of those is for a
--     person to withdraw it, not for the machine to declare the area safe.
--   * only an alert the automated path published itself is cleared this way. A person's alert is
--     a person's to take down: the machine never overrules a human issuer.
--   * and the admins get the same grace time to stop it as they get to stop an alarm.
--
-- What it cannot know is whether the road is passable, whether the water left something behind,
-- or whether a second rise is on its way - so the template's own words carry the care ("go back
-- carefully, watch for damaged roads, live electricity"), and the next-update time is set so the
-- alert asks to be looked at again.

-------------------------------------------------------------------------------
-- 1. The settings.
-------------------------------------------------------------------------------
update public.system_settings
   set value = value || jsonb_build_object('clear', jsonb_build_object(
         'reservoir_pct', 85, 'gauge_margin_m', 0.3, 'readings', 2, 'min_hours', 6,
         'grace_minutes', 20, 'next_update_h', 24)),
       note = note || ' `clear`: how far back down, for how many readings and how long after the '
                   || 'alert, before the all-clear is drafted.'
 where key = 'auto_alarm';

-------------------------------------------------------------------------------
-- 2. The events table takes a return, and remembers which alert it answers.
-------------------------------------------------------------------------------
alter table public.auto_alarm_events
  drop constraint auto_alarm_events_level_check,
  add constraint auto_alarm_events_level_check
    check (level in ('warning', 'evacuate', 'return')),
  -- The alert this draft would replace. Only a return has one.
  add column supersedes uuid references public.alerts (id) on delete cascade,
  add constraint auto_alarm_events_supersedes_is_return
    check (supersedes is null or level = 'return');

-------------------------------------------------------------------------------
-- 3. Is the water clearly back down? One answer per subject, null when it is not.
-------------------------------------------------------------------------------
create function public.auto_alarm_reservoir_cleared(p_dam text)
returns table (value double precision, threshold double precision, observed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  n integer := greatest(coalesce((cfg -> 'clear' ->> 'readings')::integer, 2), 1);
  age double precision := coalesce((cfg -> 'reservoir' ->> 'max_age_h')::double precision, 48);
  share double precision := coalesce((cfg -> 'clear' ->> 'reservoir_pct')::double precision, 85);
  v_max double precision;
  v_limit double precision;
  checked record;
begin
  select d.storage_max_mcm into v_max from public.dams d where d.code = p_dam;
  if v_max is null or v_max <= 0 then
    return;
  end if;
  v_limit := v_max * share / 100;
  select count(*) as k, max(r.storage_mcm) as most, max(r.observed_at) as at,
         (array_agg(r.storage_mcm order by r.observed_at desc))[1] as last
    into checked
    from (select x.storage_mcm, x.observed_at from public.dam_readings x
           where x.dam_code = p_dam and x.storage_mcm is not null
             and x.observed_at >= now() - make_interval(secs => (age * 3600)::integer)
           order by x.observed_at desc limit n) r;
  -- Every one of the last few readings under the share, not just the newest.
  if checked.k < n or checked.most >= v_limit then
    return;
  end if;
  return query select checked.last, round(v_limit::numeric, 3)::double precision, checked.at;
end $$;
revoke all on function public.auto_alarm_reservoir_cleared(text) from public, anon, authenticated;

-- The same question of a gauge, against the threshold that fired the alert it would clear.
create function public.auto_alarm_gauge_cleared(p_station uuid, p_threshold double precision)
returns table (value double precision, threshold double precision, observed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  n integer := greatest(coalesce((cfg -> 'clear' ->> 'readings')::integer, 2), 1);
  age double precision := coalesce((cfg ->> 'max_age_h')::double precision, 3);
  margin double precision := coalesce((cfg -> 'clear' ->> 'gauge_margin_m')::double precision, 0.3);
  v_limit double precision := p_threshold - margin;
  checked record;
begin
  if p_threshold is null then
    return;
  end if;
  select count(*) as k, max(o.value) as most, max(o.ts) as at,
         (array_agg(o.value order by o.ts desc))[1] as last
    into checked
    from (select ob.value, ob.ts from public.observations ob
           where ob.station_id = p_station and ob.variable = 'water_level_msl'
             and ob.value is not null
             and ob.ts >= now() - make_interval(secs => (age * 3600)::integer)
           order by ob.ts desc limit n) o;
  if checked.k < n or checked.most >= v_limit then
    return;
  end if;
  return query select checked.last, round(v_limit::numeric, 3)::double precision, checked.at;
end $$;
revoke all on function public.auto_alarm_gauge_cleared(uuid, double precision) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4. Publishing. The return goes through the same function as the alarm, so it gets the same
--    drill mode, the same audience and the same log; it differs in its template, in setting
--    `superseded_by` on the alert it answers, and in having no "level" to choose.
-------------------------------------------------------------------------------
create or replace function public.auto_alarm_publish(p_event uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
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
                             is_drill, drill_audience, template_id, signals_snapshot)
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
                               'supersedes', e.supersedes))
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
end $$;
revoke all on function public.auto_alarm_publish(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 5. The tick. The two loops that raise alarms are A8's and 20261027023000's; a third now looks
--    for alerts the path published that the water has moved on from.
-------------------------------------------------------------------------------
create or replace function public.auto_alarm_check() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  grace integer := coalesce((cfg ->> 'grace_minutes')::integer, 20);
  quiet integer := coalesce((cfg ->> 'quiet_hours')::integer, 12);
  clear_grace integer := coalesce((cfg -> 'clear' ->> 'grace_minutes')::integer, 20);
  stood integer := coalesce((cfg -> 'clear' ->> 'min_hours')::integer, 6);
  g record;
  r record;
  e record;
  n integer := 0;
  v_new uuid;
begin
  for g in select a.station_id, s.zone_id, s.code from public.auto_alarm_gauges a
             join public.stations s on s.id = a.station_id
            where a.enabled and s.zone_id is not null
              and exists (select 1 from public.warning_zone_tambons t
                           where t.zone_id = s.zone_id) loop
    select * into r from public.auto_alarm_reading(g.station_id);
    continue when r.level is null;
    continue when exists (
      select 1 from public.auto_alarm_events x
       where x.zone_id = g.zone_id and x.level <> 'return'
         and public.alert_rank(x.level) >= public.alert_rank(r.level)
         and (x.status = 'pending' or x.created_at > now() - make_interval(hours => quiet))
         and x.status in ('pending', 'sent', 'auto_published', 'dismissed'));
    continue when exists (
      select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
        join public.warning_zone_tambons zt on zt.tambon_code = at.tambon
         and zt.zone_id = g.zone_id
       where al.cancelled_at is null and al.superseded_by is null and not al.is_drill
         and public.alert_rank(al.level) >= public.alert_rank(r.level)
         and al.issued_at > now() - interval '48 hours');
    update public.auto_alarm_events set status = 'replaced', decided_at = now()
     where zone_id = g.zone_id and status = 'pending';
    insert into public.auto_alarm_events (zone_id, station_id, level, value, threshold,
                                          observed_at, deadline)
      values (g.zone_id, g.station_id, r.level, r.value, r.threshold, r.observed_at,
              now() + make_interval(mins => grace))
      returning id into v_new;
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_alarm_raised', 'warning_zones', g.zone_id,
              jsonb_build_object('event', v_new, 'gauge', g.code, 'level', r.level,
                                 'value', r.value));
    n := n + 1;
  end loop;

  for g in select a.dam_code, d.name ->> 'th' as name from public.auto_alarm_dams a
             join public.dams d on d.code = a.dam_code
            where a.enabled
              and exists (select 1 from public.dam_tambons t
                           where t.dam_code = d.code and t.source = d.geometry_source) loop
    select * into r from public.auto_alarm_reservoir_reading(g.dam_code);
    continue when r.level is null;
    continue when exists (
      select 1 from public.auto_alarm_events x
       where x.dam_code = g.dam_code and x.level <> 'return'
         and public.alert_rank(x.level) >= public.alert_rank(r.level)
         and (x.status = 'pending' or x.created_at > now() - make_interval(hours => quiet))
         and x.status in ('pending', 'sent', 'auto_published', 'dismissed'));
    continue when exists (
      select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
        join public.dam_tambons dt on dt.tambon_code = at.tambon and dt.dam_code = g.dam_code
        join public.dams d on d.code = dt.dam_code and d.geometry_source = dt.source
       where al.cancelled_at is null and al.superseded_by is null and not al.is_drill
         and public.alert_rank(al.level) >= public.alert_rank(r.level)
         and al.issued_at > now() - interval '48 hours');
    update public.auto_alarm_events set status = 'replaced', decided_at = now()
     where dam_code = g.dam_code and status = 'pending';
    insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at, deadline)
      values (g.dam_code, r.level, r.value, r.threshold, r.observed_at,
              now() + make_interval(mins => grace))
      returning id into v_new;
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_alarm_raised', 'dams', null,
              jsonb_build_object('event', v_new, 'dam', g.dam_code, 'level', r.level,
                                 'value', r.value));
    n := n + 1;
  end loop;

  -- The all-clear. Every alert this path published that is still in force, has stood long
  -- enough, and whose water is clearly back down.
  for e in select x.id as event, x.dam_code, x.station_id, x.threshold, x.level, a.id as alert
             from public.auto_alarm_events x
             join public.alerts a on a.id = x.alert_id
            where x.status = 'auto_published' and x.level in ('warning', 'evacuate')
              and a.superseded_by is null and a.cancelled_at is null
              and a.issued_at <= now() - make_interval(hours => stood)
              -- Nothing waiting for this subject already, in either direction.
              and not exists (select 1 from public.auto_alarm_events y
                               where y.status = 'pending'
                                 and (y.dam_code is not distinct from x.dam_code)
                                 and (y.zone_id is not distinct from x.zone_id))
              -- And no all-clear already drafted or published for this very alert.
              and not exists (select 1 from public.auto_alarm_events y
                               where y.supersedes = a.id
                                 and y.status in ('pending', 'sent', 'auto_published')) loop
    if e.dam_code is not null then
      select * into r from public.auto_alarm_reservoir_cleared(e.dam_code);
    else
      select * into r from public.auto_alarm_gauge_cleared(e.station_id, e.threshold);
    end if;
    continue when r.observed_at is null;
    insert into public.auto_alarm_events (zone_id, dam_code, station_id, level, value, threshold,
                                          observed_at, deadline, supersedes)
      select x.zone_id, x.dam_code, x.station_id, 'return', r.value, r.threshold, r.observed_at,
             now() + make_interval(mins => clear_grace), e.alert
        from public.auto_alarm_events x where x.id = e.event
      returning id into v_new;
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_all_clear_raised', 'alerts', e.alert,
              jsonb_build_object('event', v_new, 'dam', e.dam_code, 'value', r.value,
                                 'threshold', r.threshold));
    n := n + 1;
  end loop;

  for e in select * from public.auto_alarm_events where status = 'pending' and deadline <= now() loop
    -- A person acted on the same ground meanwhile: theirs stands.
    if e.level <> 'return' and e.zone_id is not null and exists (
         select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
           join public.warning_zone_tambons zt on zt.tambon_code = at.tambon
            and zt.zone_id = e.zone_id
          where al.issued_at >= e.created_at and al.cancelled_at is null and not al.is_drill
            and public.alert_rank(al.level) >= public.alert_rank(e.level)) then
      update public.auto_alarm_events set status = 'sent', decided_at = now() where id = e.id;
      continue;
    end if;
    if e.level <> 'return' and e.dam_code is not null and exists (
         select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
           join public.dam_tambons dt on dt.tambon_code = at.tambon and dt.dam_code = e.dam_code
           join public.dams d on d.code = dt.dam_code and d.geometry_source = dt.source
          where al.issued_at >= e.created_at and al.cancelled_at is null and not al.is_drill
            and public.alert_rank(al.level) >= public.alert_rank(e.level)) then
      update public.auto_alarm_events set status = 'sent', decided_at = now() where id = e.id;
      continue;
    end if;
    -- Read again at the end of the grace time. An alarm that is no longer reached, or an
    -- all-clear whose water has come back up, publishes nothing.
    if e.level = 'return' then
      if e.dam_code is not null then
        select * into r from public.auto_alarm_reservoir_cleared(e.dam_code);
      else
        -- The event stored the limit it tested, which is already the alert's threshold less the
        -- margin, so the margin goes back on to ask the same question again.
        select * into r from public.auto_alarm_gauge_cleared(
          e.station_id,
          e.threshold + coalesce((cfg -> 'clear' ->> 'gauge_margin_m')::double precision, 0.3));
      end if;
      if r.observed_at is null then
        update public.auto_alarm_events set status = 'lapsed', decided_at = now(),
               note = 'the water was not still down at the end of the grace time' where id = e.id;
        continue;
      end if;
    else
      if e.dam_code is not null then
        select * into r from public.auto_alarm_reservoir_reading(e.dam_code);
      else
        select * into r from public.auto_alarm_reading(e.station_id);
      end if;
      if r.level is null or public.alert_rank(r.level) < public.alert_rank(e.level) then
        update public.auto_alarm_events set status = 'lapsed', decided_at = now(),
               note = case when e.dam_code is not null
                           then 'the reservoir no longer reached the share at the end of the grace time'
                           else 'the reading no longer reached the threshold at the end of the grace time'
                      end
         where id = e.id;
        continue;
      end if;
    end if;
    perform public.auto_alarm_publish(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.auto_alarm_check() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 6. The log the console reads carries the return as its own kind, so a screen can show "the
--    all-clear is waiting" rather than another warning.
-------------------------------------------------------------------------------
create or replace function public.admin_auto_alarms(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."createdAt" desc)
      from (
        select e.id, e.status, e.level,
               case when e.level = 'return' then 'clear'
                    when e.dam_code is not null then 'reservoir' else 'gauge' end as kind,
               coalesce(z.name, dm.name ->> 'th', dm.code) as zone,
               s.code as gauge, e.dam_code as dam, e.supersedes,
               round(e.value::numeric, 2) as value, round(e.threshold::numeric, 2) as threshold,
               case when e.dam_code is not null and dm.storage_max_mcm > 0
                    then round((e.value / dm.storage_max_mcm * 100)::numeric, 1) end as percent,
               e.observed_at as "observedAt", e.created_at as "createdAt", e.deadline,
               e.decided_at as "decidedAt", p.display_name as "decidedBy", e.note,
               e.alert_id as "alertId", a.is_drill as drill
          from public.auto_alarm_events e
          left join public.warning_zones z on z.id = e.zone_id
          left join public.dams dm on dm.code = e.dam_code
          left join public.stations s on s.id = e.station_id
          left join public.profiles p on p.user_id = e.decided_by
          left join public.alerts a on a.id = e.alert_id
         where e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
         order by e.created_at desc
         limit 200
      ) x), '[]'::jsonb);
end $$;
revoke execute on function public.admin_auto_alarms(integer) from public, anon;
grant execute on function public.admin_auto_alarms(integer) to authenticated;
