-- A8: the automated alarm, and the gauges' places for the dashboard's map.
--
-- The owner decided on 14 Oct 2026 (docs/decisions.md) to narrow safety rule 2: a gauge an admin
-- has switched to automatic raises an alarm on every admin's phone with a ready draft when it
-- crosses its threshold; if no admin sends or dismisses that draft within the grace time, the
-- database publishes it itself, marked as issued without review. Every other alert is still
-- published by a person.
--
-- Guards, all in this file:
--   * only a gauge an admin ticked, and only for a zone with tambons;
--   * the threshold must be met by the last `confirm_readings` readings, all younger than
--     `max_age_h` (one spike or an old reading never fires);
--   * the river is read again at the end of the grace time: if it has gone back below, nothing is
--     published (`lapsed`);
--   * no second draft for a zone while one at that level or higher is pending, was sent, or an
--     alert at that level or higher is in force there;
--   * before launch the setting `mode` is 'drill', so what is published is a drill nobody outside
--     the admins sees; an admin switches it to 'real';
--   * every step is in the access log.

insert into public.system_settings (key, value, note) values
  ('auto_alarm', '{"grace_minutes": 20, "max_age_h": 3, "confirm_readings": 2, "mode": "drill", "next_update_h": 3, "quiet_hours": 12}'::jsonb,
   'The automated alarm: minutes the admins have before a draft is published by itself, how fresh and how many readings must agree, whether what is published is a drill or real, and how long one zone stays quiet after a draft.')
  on conflict (key) do nothing;

create table public.auto_alarm_gauges (
  station_id uuid primary key references public.stations (id) on delete cascade,
  enabled boolean not null default false,
  set_by uuid references public.profiles (user_id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.auto_alarm_gauges enable row level security;
create policy "auto_alarm_gauges: admins read" on public.auto_alarm_gauges for select to authenticated
  using (public.is_admin());
revoke insert, update, delete, truncate on public.auto_alarm_gauges from anon, authenticated;

create table public.auto_alarm_events (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.warning_zones (id) on delete cascade,
  station_id uuid references public.stations (id) on delete set null,
  level public.alert_level not null check (level in ('warning', 'evacuate')),
  value double precision not null,
  threshold double precision not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  deadline timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'dismissed', 'auto_published', 'lapsed', 'replaced')),
  alert_id uuid references public.alerts (id) on delete set null,
  decided_by uuid references public.profiles (user_id) on delete set null,
  decided_at timestamptz,
  note text
);
create index auto_alarm_events_open_idx on public.auto_alarm_events (zone_id, created_at desc);
alter table public.auto_alarm_events enable row level security;
create policy "auto_alarm_events: admins read" on public.auto_alarm_events for select to authenticated
  using (public.is_admin());
revoke insert, update, delete, truncate on public.auto_alarm_events from anon, authenticated;

-- Which pushes for an event have gone out, so each goes once.
create table public.auto_alarm_pushed (
  event_id uuid not null references public.auto_alarm_events (id) on delete cascade,
  kind text not null check (kind in ('admins', 'public')),
  at timestamptz not null default now(),
  primary key (event_id, kind)
);
alter table public.auto_alarm_pushed enable row level security;
revoke all on public.auto_alarm_pushed from anon, authenticated;

create function public.alert_rank(p public.alert_level) returns integer
language sql immutable set search_path = '' as $$
  select case p when 'watch' then 1 when 'warning' then 2 when 'evacuate' then 3 else 0 end
$$;

-- What a gauge's newest readings say: the level they reach and the threshold, when every one of
-- the last few readings, all fresh, reaches it. Null when nothing is reached or the gauge is not
-- fresh enough to speak.
create function public.auto_alarm_reading(p_station uuid)
returns table (level public.alert_level, value double precision, threshold double precision, observed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  n integer := coalesce((cfg ->> 'confirm_readings')::integer, 2);
  age double precision := coalesce((cfg ->> 'max_age_h')::double precision, 3);
  st public.stations;
  roles jsonb;
  key_levels jsonb;
  lo double precision;
  newest record;
  checked record;
begin
  select * into st from public.stations where id = p_station;
  if st.id is null or st.zone_id is null then return; end if;
  roles := (select s.value -> 'zones' -> (select z.basin from public.warning_zones z where z.id = st.zone_id) -> 'gauges'
              from public.system_settings s where s.key = 'signal_feed');
  select t.levels into key_levels from public.thresholds t where t.zone_id = st.zone_id and t.signal = 'key_level_m';

  select count(*) as k, min(o.value) as least, max(o.ts) as at,
         (array_agg(o.value order by o.ts desc))[1] as last
    into checked
    from (select ob.value, ob.ts from public.observations ob
           where ob.station_id = p_station and ob.variable = 'water_level_msl' and ob.value is not null
             and ob.ts >= now() - make_interval(secs => (age * 3600)::integer)
           order by ob.ts desc limit n) o;
  if checked.k < n then return; end if;

  if st.thaiwater_id is not null and (roles ->> 'key')::bigint = st.thaiwater_id and key_levels is not null then
    lo := (key_levels ->> 'evacuate')::double precision;
    if lo is not null and checked.least >= lo then
      return query select 'evacuate'::public.alert_level, checked.last, lo, checked.at; return;
    end if;
    lo := (key_levels ->> 'warning')::double precision;
    if lo is not null and checked.least >= lo then
      return query select 'warning'::public.alert_level, checked.last, lo, checked.at; return;
    end if;
  elsif st.warning_m is not null and checked.least >= st.warning_m then
    -- Any other gauge of the zone over its own bank: Warning, never more on its own.
    return query select 'warning'::public.alert_level, checked.last, st.warning_m::double precision, checked.at;
  end if;
end $$;
revoke all on function public.auto_alarm_reading(uuid) from public, anon, authenticated;

-- Publish an event's draft, as an alert nobody reviewed. Internal.
create function public.auto_alarm_publish(p_event uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  e public.auto_alarm_events;
  tpl uuid;
  codes text[];
  issuer uuid;
  gauge text;
  f record;
  v_alert uuid;
begin
  select * into e from public.auto_alarm_events where id = p_event for update;
  select x.id into tpl from public.alert_templates x where x.code = 'flood_' || e.level::text and x.active;
  select array_agg(t.tambon_code order by t.tambon_code) into codes
    from public.warning_zone_tambons t where t.zone_id = e.zone_id;
  select g.set_by into issuer from public.auto_alarm_gauges g where g.station_id = e.station_id;
  if issuer is null then
    select p.user_id into issuer from public.profiles p where p.role = 'super_admin' limit 1;
  end if;
  select s.code into gauge from public.stations s where s.id = e.station_id;
  if tpl is null or codes is null or issuer is null then
    update public.auto_alarm_events set status = 'lapsed', note = 'no template, tambons or issuer' where id = p_event;
    return null;
  end if;
  select * into f from public.alert_fill(tpl, codes,
    format('%s %s m (%s m) %s', gauge, round(e.value::numeric, 2), round(e.threshold::numeric, 2),
           to_char(e.observed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')));
  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at, is_drill,
                             template_id, signals_snapshot)
    values (f.hazard_type, f.level, f.reason, f.messages, issuer,
            now() + make_interval(hours => coalesce((cfg ->> 'next_update_h')::integer, 3)),
            coalesce(cfg ->> 'mode', 'drill') <> 'real', tpl,
            jsonb_build_object('kind', 'auto_alarm', 'event', e.id, 'gauge', gauge, 'value', e.value,
                               'threshold', e.threshold, 'observed_at', e.observed_at, 'reviewed', false))
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;
  update public.auto_alarm_events set status = 'auto_published', alert_id = v_alert, decided_at = now()
   where id = p_event;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (null, 'alert_auto_published', 'alerts', v_alert,
            jsonb_build_object('event', e.id, 'gauge', gauge, 'level', e.level, 'drill', coalesce(cfg ->> 'mode', 'drill') <> 'real'));
  return v_alert;
end $$;
revoke all on function public.auto_alarm_publish(uuid) from public, anon, authenticated;

-- Every five minutes: new drafts from the ticked gauges, and the drafts whose time has run out.
create function public.auto_alarm_check() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  grace integer := coalesce((cfg ->> 'grace_minutes')::integer, 20);
  quiet integer := coalesce((cfg ->> 'quiet_hours')::integer, 12);
  g record;
  r record;
  e record;
  n integer := 0;
  v_new uuid;
begin
  for g in select a.station_id, s.zone_id, s.code from public.auto_alarm_gauges a
             join public.stations s on s.id = a.station_id
            where a.enabled and s.zone_id is not null
              and exists (select 1 from public.warning_zone_tambons t where t.zone_id = s.zone_id) loop
    select * into r from public.auto_alarm_reading(g.station_id);
    continue when r.level is null;
    -- Quiet if this zone already has a draft or an alert at this level or higher.
    continue when exists (
      select 1 from public.auto_alarm_events x
       where x.zone_id = g.zone_id and public.alert_rank(x.level) >= public.alert_rank(r.level)
         and (x.status = 'pending' or x.created_at > now() - make_interval(hours => quiet))
         and x.status in ('pending', 'sent', 'auto_published', 'dismissed'));
    continue when exists (
      select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
        join public.warning_zone_tambons zt on zt.tambon_code = at.tambon and zt.zone_id = g.zone_id
       where al.cancelled_at is null and al.superseded_by is null
         and public.alert_rank(al.level) >= public.alert_rank(r.level)
         and al.issued_at > now() - interval '48 hours');
    -- A lower draft still waiting is replaced by this one.
    update public.auto_alarm_events set status = 'replaced', decided_at = now()
     where zone_id = g.zone_id and status = 'pending';
    insert into public.auto_alarm_events (zone_id, station_id, level, value, threshold, observed_at, deadline)
      values (g.zone_id, g.station_id, r.level, r.value, r.threshold, r.observed_at,
              now() + make_interval(mins => grace))
      returning id into v_new;
    insert into public.audit_log (actor, action, entity, entity_id, details)
      values (null, 'auto_alarm_raised', 'warning_zones', g.zone_id,
              jsonb_build_object('event', v_new, 'gauge', g.code, 'level', r.level, 'value', r.value));
    n := n + 1;
  end loop;

  for e in select * from public.auto_alarm_events where status = 'pending' and deadline <= now() loop
    -- A person sent an alert for the zone meanwhile: theirs stands.
    if exists (select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
                 join public.warning_zone_tambons zt on zt.tambon_code = at.tambon and zt.zone_id = e.zone_id
                where al.issued_at >= e.created_at and al.cancelled_at is null
                  and public.alert_rank(al.level) >= public.alert_rank(e.level)) then
      update public.auto_alarm_events set status = 'sent', decided_at = now() where id = e.id;
      continue;
    end if;
    -- The river is read again: gone back below, nothing is published.
    select * into r from public.auto_alarm_reading(e.station_id);
    if r.level is null or public.alert_rank(r.level) < public.alert_rank(e.level) then
      update public.auto_alarm_events set status = 'lapsed', decided_at = now(),
             note = 'the reading no longer reached the threshold at the end of the grace time'
       where id = e.id;
      continue;
    end if;
    perform public.auto_alarm_publish(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.auto_alarm_check() from public, anon, authenticated;
select cron.schedule('jaga-auto-alarm', '*/5 * * * *', 'select public.auto_alarm_check()');

-- What the server's push tick owes for the automated alarm: the admins' alarm for a new draft,
-- and the public push for a draft that was published by itself (never for a drill).
create function public.auto_alarm_push_due(p_token text)
returns table (kind text, endpoint text, keys jsonb, locale text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare e record; fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for e in select x.*, z.name as zone_name, s.code as gauge from public.auto_alarm_events x
             join public.warning_zones z on z.id = x.zone_id
             left join public.stations s on s.id = x.station_id
            where x.created_at > now() - interval '1 day' loop
    if e.status = 'pending' then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'admins') on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'auto_alarm'::text, ps.endpoint, ps.keys, ps.locale,
          jsonb_build_object('event', e.id, 'level', e.level, 'zone', e.zone_name, 'gauge', e.gauge,
                             'value', round(e.value::numeric, 2), 'deadline', e.deadline)
          from public.profiles p join public.push_subscriptions ps on ps.user_id = p.user_id
         where p.role in ('admin', 'super_admin');
      end if;
    elsif e.status = 'auto_published' and e.alert_id is not null
          and exists (select 1 from public.alerts al where al.id = e.alert_id and not al.is_drill
                        and al.cancelled_at is null and al.superseded_by is null) then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'public') on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'alert'::text, ps.endpoint, ps.keys, ps.locale,
          (select jsonb_build_object('id', al.id, 'level', al.level, 'messages', al.messages)
             from public.alerts al where al.id = e.alert_id)
          from public.push_subscriptions ps
         where ps.tambons && (select array_agg(at.tambon) from public.alert_tambons at where at.alert_id = e.alert_id);
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.auto_alarm_push_due(text) from public;
grant execute on function public.auto_alarm_push_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Admin actions.
-------------------------------------------------------------------------------
-- Switch the automatic alarm on or off for one gauge, or (null) for every gauge in a zone.
create function public.admin_set_auto_alarm(p_station uuid, p_enabled boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform public.admin_only();
  insert into public.auto_alarm_gauges (station_id, enabled, set_by, set_at)
    select s.id, p_enabled, auth.uid(), now() from public.stations s
     where (p_station is null and s.zone_id is not null) or s.id = p_station
  on conflict (station_id) do update set enabled = excluded.enabled, set_by = excluded.set_by, set_at = excluded.set_at;
  get diagnostics n = row_count;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), case when p_enabled then 'auto_alarm_on' else 'auto_alarm_off' end, 'stations', p_station,
            jsonb_build_object('all', p_station is null, 'gauges', n));
  return n;
end $$;
revoke all on function public.admin_set_auto_alarm(uuid, boolean) from public, anon;
grant execute on function public.admin_set_auto_alarm(uuid, boolean) to authenticated;

-- Stop a waiting draft from being published by itself.
create function public.admin_dismiss_auto_alarm(p_event uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  update public.auto_alarm_events set status = 'dismissed', decided_by = auth.uid(), decided_at = now(),
         note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where id = p_event and status = 'pending';
  if not found then
    raise exception 'that draft is no longer waiting' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'auto_alarm_dismissed', 'auto_alarm_events', p_event, jsonb_build_object('note', p_note));
end $$;
revoke all on function public.admin_dismiss_auto_alarm(uuid, text) from public, anon;
grant execute on function public.admin_dismiss_auto_alarm(uuid, text) to authenticated;

-- Drill or real for what the automatic alarm publishes.
create function public.admin_set_auto_alarm_mode(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if p_mode not in ('drill', 'real') then
    raise exception 'mode is drill or real' using errcode = 'check_violation';
  end if;
  update public.system_settings set value = value || jsonb_build_object('mode', p_mode) where key = 'auto_alarm';
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'auto_alarm_mode', 'system_settings', null, jsonb_build_object('mode', p_mode));
end $$;
revoke all on function public.admin_set_auto_alarm_mode(text) from public, anon;
grant execute on function public.admin_set_auto_alarm_mode(text) to authenticated;

-------------------------------------------------------------------------------
-- The dashboard's read, now with every gauge's place, newest readings and switch, and the
-- automated alarm's state.
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
               'deadline', x.deadline, 'status', x.status, 'alertId', x.alert_id) order by x.created_at desc)
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
