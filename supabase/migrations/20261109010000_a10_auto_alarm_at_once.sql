-- The automated alarm publishes at once, and tells the admins afterwards (the owner, 9 Nov 2026).
--
-- Safety rule 2 said: only a person publishes an alert, with one exception - the automated alarm,
-- which drafted, rang every admin's phone, waited 20 minutes and published only if nobody acted.
-- The owner has narrowed the rule again: "I want the alert goes live no need to wait for admin,
-- only notify admin via notification bell when the alarm sent already, so Admin can understand
-- the alarm went, notify to all Admins if there are more than one."
--
-- So the draft-and-wait step goes. A ticked gauge, a ticked reservoir and the all-clear now
-- publish in the same tick that finds them, and every admin is told afterwards. The 20-minute
-- grace survives for one case only, below.
--
-- Everything that decided *whether* to speak is untouched: two fresh readings agreeing, the
-- gauge's own Warning level, the key gauge alone reaching Evacuate, the 12-hour quiet window per
-- zone, the 48-hour check for an alert already in force, and the all-clear's much harder test
-- (clearly down, for several readings, after the alert has stood six hours, and only over an
-- alert this path published itself).
--
-- What is new is the guard the owner asked for in its place. Before publishing, the last three
-- readings are checked for a jump no river makes: over `sanity.max_rise_m_per_h` between
-- consecutive readings (or `sanity.reservoir_pct_per_h` of capacity for a reservoir). A gauge
-- that jumps like that is far more likely to be broken than to be a flood. Such a reading does
-- not silence the alarm - it falls back to exactly the old behaviour: the draft is held, every
-- admin's phone rings with the deadline, and if nobody acts within the grace time it publishes
-- anyway. A sensor fault can therefore delay an alert by 20 minutes; it can never stop one.
-- The gauge is also marked suspect (`auto_alarm_gauges.suspect_since`) until an admin clears it,
-- so a gauge that keeps misbehaving is visible on the signal dashboard.
--
-- Known and deliberately not covered: a sensor stuck at a high value reads exactly like a steady
-- flood, and no jump test can see it. Catching that needs the gauges upstream to disagree, which
-- is a separate piece of work.
--
-- The admins' notification changes with the facts. It used to say "a draft is waiting, it will be
-- sent at 21:40"; it now says the alert has gone out, and it rings rather than chimes, because an
-- alert is already in force by the time it arrives.

-------------------------------------------------------------------------------
-- 1. The settings. `grace_minutes` stays: it is what a held draft waits.
-------------------------------------------------------------------------------
update public.system_settings
   set value = value || jsonb_build_object('sanity', jsonb_build_object(
         'max_rise_m_per_h', 2.0, 'reservoir_pct_per_h', 5.0, 'min_gap_min', 5)),
       note = note || ' `sanity`: the fastest a gauge or a reservoir can move between readings '
                   || 'and still be believed; a bigger jump holds the draft for the admins '
                   || 'instead of publishing it at once.'
 where key = 'auto_alarm';

-------------------------------------------------------------------------------
-- 2. The events, the pushes and the gauges take the new facts.
-------------------------------------------------------------------------------
-- True when this event was published in the tick that found it, with nobody waited for. False on
-- a held draft, on one an admin sent, and on everything from before today.
alter table public.auto_alarm_events
  add column published_at_once boolean not null default false,
  -- Why a draft was held rather than published at once. Null when nothing was wrong.
  add column held_reason text;

alter table public.auto_alarm_pushed
  drop constraint auto_alarm_pushed_kind_check,
  add constraint auto_alarm_pushed_kind_check check (kind in ('admins', 'public', 'admins_sent'));

-- A gauge whose readings could not be believed, until an admin says otherwise.
alter table public.auto_alarm_gauges
  add column suspect_since timestamptz,
  add column suspect_note text;

-------------------------------------------------------------------------------
-- 3. Is this reading believable? Null when it is, the reason when it is not.
-------------------------------------------------------------------------------
create function public.auto_alarm_suspect(p_station uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  limit_mh double precision := coalesce((cfg -> 'sanity' ->> 'max_rise_m_per_h')::double precision, 2.0);
  gap_h double precision := greatest(coalesce((cfg -> 'sanity' ->> 'min_gap_min')::double precision, 5), 1) / 60.0;
  age double precision := coalesce((cfg ->> 'max_age_h')::double precision, 3);
  worst double precision;
begin
  if limit_mh is null or limit_mh <= 0 then return null; end if;
  -- The three newest readings in a window a little wider than the alarm's own, so the step into
  -- the window is judged too.
  with last3 as (
    select ob.value, ob.ts from public.observations ob
     where ob.station_id = p_station and ob.variable = 'water_level_msl' and ob.value is not null
       and ob.ts >= now() - make_interval(secs => ((age + 3) * 3600)::integer)
     order by ob.ts desc limit 3),
  steps as (
    select abs(value - lead(value) over (order by ts desc)) as d,
           extract(epoch from (ts - lead(ts) over (order by ts desc))) / 3600.0 as h
      from last3)
  select max(d / greatest(h, gap_h)) into worst from steps where d is not null and h > 0;
  if worst is null or worst <= limit_mh then return null; end if;
  return format('the gauge moved %s m an hour between readings, over the %s m an hour it is believed up to',
                round(worst::numeric, 2), round(limit_mh::numeric, 2));
end $$;
revoke all on function public.auto_alarm_suspect(uuid) from public, anon, authenticated;

create function public.auto_alarm_reservoir_suspect(p_dam text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  limit_ph double precision := coalesce((cfg -> 'sanity' ->> 'reservoir_pct_per_h')::double precision, 5.0);
  gap_h double precision := greatest(coalesce((cfg -> 'sanity' ->> 'min_gap_min')::double precision, 5), 1) / 60.0;
  v_max double precision;
  worst double precision;
begin
  if limit_ph is null or limit_ph <= 0 then return null; end if;
  select d.storage_max_mcm into v_max from public.dams d where d.code = p_dam;
  if v_max is null or v_max <= 0 then return null; end if;
  with last3 as (
    select x.storage_mcm as value, x.observed_at as ts from public.dam_readings x
     where x.dam_code = p_dam and x.storage_mcm is not null
     order by x.observed_at desc limit 3),
  steps as (
    select abs(value - lead(value) over (order by ts desc)) as d,
           extract(epoch from (ts - lead(ts) over (order by ts desc))) / 3600.0 as h
      from last3)
  select max(d / greatest(h, gap_h)) into worst from steps where d is not null and h > 0;
  if worst is null then return null; end if;
  worst := worst / v_max * 100;
  if worst <= limit_ph then return null; end if;
  return format('the reservoir moved %s%% of its capacity an hour between readings, over the %s%% it is believed up to',
                round(worst::numeric, 2), round(limit_ph::numeric, 2));
end $$;
revoke all on function public.auto_alarm_reservoir_suspect(text) from public, anon, authenticated;

-- An admin says a gauge may be believed again.
create function public.admin_clear_gauge_suspect(p_station uuid, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_was text; v_code text;
begin
  perform public.admin_only();
  select s.code into v_code from public.stations s where s.id = p_station;
  if v_code is null then
    raise exception 'no such gauge' using errcode = 'no_data_found';
  end if;
  select g.suspect_note into v_was from public.auto_alarm_gauges g where g.station_id = p_station;
  update public.auto_alarm_gauges set suspect_since = null, suspect_note = null
   where station_id = p_station;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'auto_alarm_suspect_cleared', 'stations', p_station,
            jsonb_build_object('code', v_code, 'was', v_was, 'note', p_note));
  return now();
end $$;
revoke all on function public.admin_clear_gauge_suspect(uuid, text) from public, anon;
grant execute on function public.admin_clear_gauge_suspect(uuid, text) to authenticated;

-- One event's fate, so the three loops read the same. Publishes at once when the reading is
-- believable; otherwise leaves the draft pending for the admins and marks the gauge.
create function public.auto_alarm_decide(p_event uuid, p_code text, p_hold text, p_station uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.auto_alarm_events;
begin
  select * into e from public.auto_alarm_events where id = p_event;
  if p_hold is null then
    update public.auto_alarm_events set published_at_once = true where id = p_event;
    perform public.auto_alarm_publish(p_event);
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_alarm_published_at_once',
              case when e.dam_code is not null then 'dams' else 'warning_zones' end, e.zone_id,
              jsonb_build_object('event', p_event, 'subject', p_code, 'level', e.level,
                                 'value', e.value, 'threshold', e.threshold));
  else
    if p_station is not null then
      update public.auto_alarm_gauges
         set suspect_since = coalesce(suspect_since, now()), suspect_note = p_hold
       where station_id = p_station;
    end if;
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_alarm_held',
              case when e.dam_code is not null then 'dams' else 'warning_zones' end, e.zone_id,
              jsonb_build_object('event', p_event, 'subject', p_code, 'level', e.level,
                                 'value', e.value, 'why', p_hold, 'deadline', e.deadline));
  end if;
end $$;
revoke all on function public.auto_alarm_decide(uuid, text, text, uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4. The tick. Each of the three loops now publishes at once, or holds the draft and rings.
-------------------------------------------------------------------------------
create or replace function public.auto_alarm_check() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  grace integer := coalesce((cfg ->> 'grace_minutes')::integer, 20);
  quiet integer := coalesce((cfg ->> 'quiet_hours')::integer, 12);
  stood integer := coalesce((cfg -> 'clear' ->> 'min_hours')::integer, 6);
  g record;
  r record;
  e record;
  n integer := 0;
  v_new uuid;
  v_hold text;
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
    v_hold := public.auto_alarm_suspect(g.station_id);
    insert into public.auto_alarm_events (zone_id, station_id, level, value, threshold,
                                          observed_at, deadline, held_reason)
      values (g.zone_id, g.station_id, r.level, r.value, r.threshold, r.observed_at,
              case when v_hold is null then now() else now() + make_interval(mins => grace) end,
              v_hold)
      returning id into v_new;
    perform public.auto_alarm_decide(v_new, g.code, v_hold, g.station_id);
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
    v_hold := public.auto_alarm_reservoir_suspect(g.dam_code);
    insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at,
                                          deadline, held_reason)
      values (g.dam_code, r.level, r.value, r.threshold, r.observed_at,
              case when v_hold is null then now() else now() + make_interval(mins => grace) end,
              v_hold)
      returning id into v_new;
    perform public.auto_alarm_decide(v_new, g.dam_code, v_hold, null);
    n := n + 1;
  end loop;

  -- The all-clear. Every alert this path published that is still in force, has stood long
  -- enough, and whose water is clearly back down.
  for e in select x.id as event, x.dam_code, x.station_id, x.threshold, x.level, a.id as alert,
                  coalesce(s.code, x.dam_code) as code
             from public.auto_alarm_events x
             join public.alerts a on a.id = x.alert_id
             left join public.stations s on s.id = x.station_id
            where x.status = 'auto_published' and x.level in ('warning', 'evacuate')
              and a.superseded_by is null and a.cancelled_at is null
              and a.issued_at <= now() - make_interval(hours => stood)
              and not exists (select 1 from public.auto_alarm_events y
                               where y.status = 'pending'
                                 and (y.dam_code is not distinct from x.dam_code)
                                 and (y.zone_id is not distinct from x.zone_id))
              and not exists (select 1 from public.auto_alarm_events y
                               where y.supersedes = a.id
                                 and y.status in ('pending', 'sent', 'auto_published')) loop
    if e.dam_code is not null then
      select * into r from public.auto_alarm_reservoir_cleared(e.dam_code);
      v_hold := public.auto_alarm_reservoir_suspect(e.dam_code);
    else
      select * into r from public.auto_alarm_gauge_cleared(e.station_id, e.threshold);
      v_hold := public.auto_alarm_suspect(e.station_id);
    end if;
    continue when r.observed_at is null;
    insert into public.auto_alarm_events (zone_id, dam_code, station_id, level, value, threshold,
                                          observed_at, deadline, supersedes, held_reason)
      select x.zone_id, x.dam_code, x.station_id, 'return', r.value, r.threshold, r.observed_at,
             case when v_hold is null then now() else now() + make_interval(mins => grace) end,
             e.alert, v_hold
        from public.auto_alarm_events x where x.id = e.event
      returning id into v_new;
    perform public.auto_alarm_decide(v_new, e.code, v_hold, e.station_id);
    n := n + 1;
  end loop;

  -- Held drafts whose grace time has run out: the old path, unchanged but for the audit word.
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
-- 5. The pushes. A published event now owes every admin a word, as well as the public.
-------------------------------------------------------------------------------
create or replace function public.auto_alarm_push_due(p_token text)
returns table (kind text, endpoint text, keys jsonb, locale text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare e record; fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for e in select x.*,
                  coalesce(z.name, d.name, to_jsonb(d.code)) as subject_name,
                  s.code as gauge,
                  case when x.dam_code is not null and d.storage_max_mcm > 0
                       then round((x.value / d.storage_max_mcm * 100)::numeric, 1) end as percent
             from public.auto_alarm_events x
             left join public.warning_zones z on z.id = x.zone_id
             left join public.dams d on d.code = x.dam_code
             left join public.stations s on s.id = x.station_id
            where x.created_at > now() - interval '1 day' loop
    -- A draft that was held because its reading could not be believed: the old words, with the
    -- time it will go out by itself.
    if e.status = 'pending' then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'admins')
        on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'auto_alarm'::text, ps.endpoint, ps.keys, ps.locale,
          jsonb_build_object('event', e.id, 'level', e.level, 'zone', e.subject_name,
                             'gauge', e.gauge, 'dam', e.dam_code, 'percent', e.percent,
                             'clear', e.level = 'return',
                             'held', e.held_reason,
                             'value', round(e.value::numeric, 2), 'deadline', e.deadline)
          from public.profiles p join public.push_subscriptions ps on ps.user_id = p.user_id
         where p.role in ('admin', 'super_admin');
      end if;
    elsif e.status = 'auto_published' and e.alert_id is not null then
      -- Every admin learns that it has already gone out (the owner, 9 Nov 2026). This is owed
      -- even for a drill, which is how a drill is rehearsed.
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'admins_sent')
        on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'auto_alarm_sent'::text, ps.endpoint, ps.keys, ps.locale,
          jsonb_build_object('event', e.id, 'level', e.level, 'zone', e.subject_name,
                             'gauge', e.gauge, 'dam', e.dam_code, 'percent', e.percent,
                             'clear', e.level = 'return', 'alert', e.alert_id,
                             'atOnce', e.published_at_once,
                             'drill', (select al.is_drill from public.alerts al where al.id = e.alert_id),
                             'value', round(e.value::numeric, 2))
          from public.profiles p join public.push_subscriptions ps on ps.user_id = p.user_id
         where p.role in ('admin', 'super_admin');
      end if;
      -- And the public hears the alert itself, unless it is a drill nobody outside sees.
      if exists (select 1 from public.alerts al where al.id = e.alert_id
                   and (not al.is_drill or 'everyone' = any (al.drill_audience))
                   and al.cancelled_at is null and al.superseded_by is null) then
        insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'public')
          on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query select 'alert'::text, ps.endpoint, ps.keys, ps.locale,
            (select jsonb_build_object('id', al.id, 'level', al.level, 'messages', al.messages,
                                       'drill', al.is_drill)
               from public.alerts al where al.id = e.alert_id)
            from public.push_subscriptions ps
           where ps.tambons && (select array_agg(at.tambon) from public.alert_tambons at
                                 where at.alert_id = e.alert_id);
        end if;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.auto_alarm_push_due(text) from public;
grant execute on function public.auto_alarm_push_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 6. The log the bell and the console read carries the two new facts.
-------------------------------------------------------------------------------
create or replace function public.admin_auto_alarms(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."createdAt" desc)
      from (
        select e.id, e.status, e.level,
               case when e.level = 'return' then 'clear'
                    when e.dam_code is not null then 'reservoir' else 'gauge' end as kind,
               coalesce(z.name, dm.name, to_jsonb(dm.code)) as names,
               coalesce(z.name ->> 'th', dm.name ->> 'th', dm.code) as zone,
               s.code as gauge, e.dam_code as dam, e.supersedes,
               round(e.value::numeric, 2) as value, round(e.threshold::numeric, 2) as threshold,
               case when e.dam_code is not null and dm.storage_max_mcm > 0
                    then round((e.value / dm.storage_max_mcm * 100)::numeric, 1) end as percent,
               e.observed_at as "observedAt", e.created_at as "createdAt", e.deadline,
               e.decided_at as "decidedAt", p.display_name as "decidedBy", e.note,
               e.published_at_once as "atOnce", e.held_reason as "heldReason",
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

-------------------------------------------------------------------------------
-- 7. The signal dashboard sees which gauges are suspect, and which events went at once.
-------------------------------------------------------------------------------
create or replace function public.admin_signals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'signal_feed'), '{}'::jsonb);
  v_auto jsonb := coalesce((select s.value from public.system_settings s where s.key = 'auto_alarm'), '{}'::jsonb);
  v_out jsonb;
begin
  perform public.admin_only();
  select jsonb_build_object(
    'now', now(),
    'auto', v_auto,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'zoneId', x.zone_id, 'gauge', s.code, 'level', x.level,
               'value', x.value, 'threshold', x.threshold, 'observedAt', x.observed_at, 'createdAt', x.created_at,
               'deadline', x.deadline, 'status', x.status, 'alertId', x.alert_id,
               'atOnce', x.published_at_once, 'heldReason', x.held_reason) order by x.created_at desc)
        from public.auto_alarm_events x left join public.stations s on s.id = x.station_id
       where x.created_at > now() - interval '3 days'), '[]'::jsonb),
    'feeds', jsonb_build_object(
      'gauges', (select to_jsonb(g) from (select at, ok, error from public.gauge_feed_log order by id desc limit 1) g),
      'signals', (select to_jsonb(f) from (select at, ok, error from public.signal_feed_log order by id desc limit 1) f)),
    'allGauges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'code', s.code, 'thaiwaterId', s.thaiwater_id, 'name', s.name, 'agency', s.agency,
               'lon', extensions.st_x(s.point), 'lat', extensions.st_y(s.point),
               'zoneId', s.zone_id, 'bank', s.warning_m, 'watch', s.watch_m,
               'auto', coalesce(a.enabled, false),
               'suspectSince', a.suspect_since, 'suspectNote', a.suspect_note,
               'series', coalesce((
                 select jsonb_agg(jsonb_build_array(o.ts, o.value) order by o.ts)
                   from public.observations o
                  where o.station_id = s.id and o.variable = 'water_level_msl'
                    and o.ts >= now() - interval '48 hours'), '[]'::jsonb)) order by s.code)
        from public.stations s left join public.auto_alarm_gauges a on a.station_id = s.id), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'basin', z.basin, 'name', z.name,
        'tambons', (select count(*) from public.warning_zone_tambons t where t.zone_id = z.id),
        'outline', extensions.st_asgeojson(extensions.st_simplifypreservetopology(z.geom, 0.002), 4)::jsonb,
        'roles', coalesce(v_feed -> 'zones' -> z.basin -> 'gauges', '{}'::jsonb),
        'thresholds', coalesce((
          select jsonb_agg(jsonb_build_object('signal', t.signal, 'levels', t.levels, 'provisional', t.provisional,
                                              'updatedAt', t.updated_at) order by t.signal)
            from public.thresholds t where t.zone_id = z.id), '[]'::jsonb),
        'gauges', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'code', s.code, 'thaiwaterId', s.thaiwater_id, 'name', s.name, 'agency', s.agency,
                   'bank', s.warning_m, 'watch', s.watch_m, 'auto', coalesce(a.enabled, false),
                   'suspectSince', a.suspect_since, 'suspectNote', a.suspect_note,
                   'series', coalesce((
                     select jsonb_agg(jsonb_build_array(o.ts, o.value) order by o.ts)
                       from public.observations o
                      where o.station_id = s.id and o.variable = 'water_level_msl'
                        and o.ts >= now() - interval '96 hours'), '[]'::jsonb)) order by s.code)
            from public.stations s left join public.auto_alarm_gauges a on a.station_id = s.id
           where s.zone_id = z.id), '[]'::jsonb),
        'rain', coalesce((select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f where f.zone_id = z.id and f.source = 'open_meteo' and f.variable = 'rain_1h_mm'), '[]'::jsonb),
        'discharge', coalesce((select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f where f.zone_id = z.id and f.source = 'glofas' and f.variable = 'discharge_cms'), '[]'::jsonb),
        'tide', coalesce((select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f where f.zone_id = z.id and f.source = 'open_meteo_marine' and f.variable = 'sea_level_m'), '[]'::jsonb),
        'issuedAt', (select max(f.issued_at) from public.forecasts f where f.zone_id = z.id)
      ) order by z.basin)
      from public.warning_zones z), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke all on function public.admin_signals() from public, anon;
grant execute on function public.admin_signals() to authenticated;
