-- The automated alarm, extended to the reservoirs (the owner, 27 Oct 2026).
--
-- A8 narrowed safety rule 2 for river gauges: a gauge an admin has ticked raises a draft on every
-- admin's phone when its last readings cross the threshold, and if nobody sends or dismisses that
-- draft within the grace time the database publishes it itself, marked as issued without review.
-- The owner asked for the same road for a reservoir that fills up, with its own reviewed draft.
--
-- This file adds the reservoir half to the machinery A8 already built, rather than a second
-- machinery beside it: the same events table, the same grace time, the same re-check at the end of
-- it, the same quiet window, the same drill mode, the same access log. What is different is only
-- what makes a reservoir not a river:
--
--   * **The reading is a share of capacity, not a level in metres.** These five reservoirs publish
--     no level at all, only storage, and for all five the capacity at normal high water *is* the
--     full capacity (migration 20261027011500). So the rule is: storage at or above
--     `reservoir.pct` of capacity **and still filling**. Full and steady is watchful, not an
--     alarm - the water is not rising towards anybody.
--   * **One reading, not two, and 48 hours old is fresh.** The feed is daily. A8's two readings
--     three hours apart cannot be met by a figure published once a day, and a daily figure is
--     already a day's mean (pipeline/dam_release/METHODS.md, "The RID reservoirs").
--   * **Warning only, never evacuate.** The biggest of the five holds 57 million m3 and the
--     smallest 1.2, and their zones are a screening band from an elevation model, not a hydraulic
--     model. Telling a tambon to leave on that evidence is a person's decision; this path can ask
--     people to move what they can move, and no more.
--   * **Its own reviewed template**, `reservoir_full_warning`, because "the reservoir is full and
--     has to pass the water on" is not the same thing as "the river is over its bank", and the
--     words a person reads at 3 a.m. must say which it is. Like every other template its text is
--     written here and filled in only with the area (safety rule 2: no text is composed at send
--     time, and none is machine-translated).
--
-- The area is the reservoir's own zone from `dam_tambons`, which for these five is the overflow
-- zone of pipeline/dam_release/spill.py - and `{area}` names the tambons, which is what the owner
-- asked the alert to say plainly. With one to three tambons each, every one of them is named.

-------------------------------------------------------------------------------
-- 1. The settings. `reservoir` is the reservoir half of the same alarm; `drill_audience` is who
--    a drill published by the alarm is sent to, so that a drill proves the whole road and not
--    only the part of it inside the database (migration 20261020220000).
-------------------------------------------------------------------------------
update public.system_settings
   set value = value
     || jsonb_build_object('reservoir', jsonb_build_object(
          'pct', 95, 'max_age_h', 48, 'confirm_readings', 1, 'next_update_h', 12))
     || jsonb_build_object('drill_audience', jsonb_build_array('admins', 'everyone')),
       note = note || ' For a reservoir: the share of capacity it must reach while still filling, '
                   || 'how fresh and how many daily readings must agree, and who a published '
                   || 'drill is sent to.'
 where key = 'auto_alarm';

-------------------------------------------------------------------------------
-- 2. Which reservoirs an admin has ticked. Mirrors auto_alarm_gauges exactly.
-------------------------------------------------------------------------------
create table public.auto_alarm_dams (
  dam_code text primary key references public.dams (code) on delete cascade,
  enabled boolean not null default false,
  set_by uuid references public.profiles (user_id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.auto_alarm_dams enable row level security;
create policy "auto_alarm_dams: admins read" on public.auto_alarm_dams for select to authenticated
  using (public.is_admin());
revoke insert, update, delete, truncate on public.auto_alarm_dams from anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The events table takes a reservoir as well as a zone. Exactly one of the two.
-------------------------------------------------------------------------------
alter table public.auto_alarm_events
  alter column zone_id drop not null,
  add column dam_code text references public.dams (code) on delete cascade,
  add constraint auto_alarm_events_one_subject
    check ((zone_id is not null) <> (dam_code is not null));
create index auto_alarm_events_dam_idx on public.auto_alarm_events (dam_code, created_at desc);

-------------------------------------------------------------------------------
-- 4. The words. Reviewed here, Thai first; the only thing filled in is {area}.
--
-- What it asks for is what a reservoir spilling actually calls for: move what can be moved and
-- keep away from the channel. It does not say "evacuate" and it does not say the water is at the
-- door, because at the moment this fires neither is known.
-------------------------------------------------------------------------------
insert into public.alert_templates (code, level, hazard_type, label, reason, messages, active) values (
  'reservoir_full_warning', 'warning', 'flood',
  jsonb_build_object(
    'th', 'เตือนภัยน้ำท่วม (อ่างเก็บน้ำเกือบเต็ม)',
    'ms', 'Amaran banjir (takungan hampir penuh)',
    'en', 'Flood warning (reservoir nearly full)'),
  jsonb_build_object(
    'th', 'อ่างเก็บน้ำเกือบเต็มความจุและยังมีน้ำไหลเข้า น้ำส่วนเกินจะระบายลงลำน้ำท้ายอ่าง',
    'ms', 'Takungan hampir penuh dan air masih masuk, jadi air lebihan akan mengalir ke alur di hilir.',
    'en', 'The reservoir is nearly full and still filling, so surplus water will pass into the channel below it.'),
  jsonb_build_object(
    'th', 'เตือนภัยน้ำท่วมสำหรับ {area} อ่างเก็บน้ำเหนือพื้นที่ของท่านเกือบเต็มความจุ '
       || 'น้ำที่ไหลเข้าจะต้องระบายลงลำน้ำท้ายอ่าง ระดับน้ำในลำน้ำอาจสูงขึ้นเร็ว '
       || 'ขอให้ย้ายผู้สูงอายุ เด็ก ผู้ป่วย และยานพาหนะขึ้นที่สูง ยกของขึ้นให้พ้นน้ำ '
       || 'อยู่ห่างจากลำน้ำ ตลิ่ง และสะพาน และติดตามการแจ้งเตือนครั้งถัดไป',
    'ms', 'Amaran banjir untuk {area}. Takungan di hulu kawasan anda hampir penuh, jadi air yang '
       || 'masuk mesti dilepaskan ke alur di hilir, dan paras air di alur itu boleh naik dengan '
       || 'cepat. Pindahkan orang tua, kanak-kanak, orang sakit dan kenderaan ke tempat tinggi, '
       || 'angkat barang dari lantai, jauhi alur, tebing dan jambatan, dan ikuti kemas kini '
       || 'seterusnya.',
    'en', 'Flood warning for {area}. The reservoir upstream of you is nearly full, so the water '
       || 'it takes in has to pass into the channel below it, and that channel can rise quickly. '
       || 'Move elderly people, children, the sick and your vehicles to higher ground, lift '
       || 'belongings off the floor, keep away from the channel, its banks and bridges, and '
       || 'follow the next update.'),
  true)
on conflict (code) do update
   set level = excluded.level, hazard_type = excluded.hazard_type, label = excluded.label,
       reason = excluded.reason, messages = excluded.messages, active = true;

-------------------------------------------------------------------------------
-- 5. What a reservoir's newest readings say. Null unless the rule is met, so the caller never
--    has to know the rule.
-------------------------------------------------------------------------------
create function public.auto_alarm_reservoir_reading(p_dam text)
returns table (level public.alert_level, value double precision, threshold double precision,
               observed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value -> 'reservoir' from public.system_settings s
                 where s.key = 'auto_alarm');
  n integer := greatest(coalesce((cfg ->> 'confirm_readings')::integer, 1), 1);
  age double precision := coalesce((cfg ->> 'max_age_h')::double precision, 48);
  share double precision := coalesce((cfg ->> 'pct')::double precision, 95);
  v_max double precision;
  v_limit double precision;
  checked record;
begin
  select d.storage_max_mcm into v_max from public.dams d where d.code = p_dam;
  if v_max is null or v_max <= 0 then
    return;
  end if;
  v_limit := v_max * share / 100;

  -- The last n readings, all fresh: the smallest of them must reach the share, and the newest
  -- must stand above the oldest of them (still filling).
  select count(*) as k, min(r.storage_mcm) as least, max(r.observed_at) as at,
         (array_agg(r.storage_mcm order by r.observed_at desc))[1] as last,
         (array_agg(r.storage_mcm order by r.observed_at asc))[1] as first
    into checked
    from (select x.storage_mcm, x.observed_at from public.dam_readings x
           where x.dam_code = p_dam and x.storage_mcm is not null
             and x.observed_at >= now() - make_interval(secs => (age * 3600)::integer)
           order by x.observed_at desc limit n) r;
  if checked.k < n or checked.least < v_limit then
    return;
  end if;

  -- Still filling. With one reading in the window there is nothing to compare inside it, so the
  -- reading before it is asked for; a reservoir that is full and falling raises nothing.
  if checked.last <= coalesce(
       (select x.storage_mcm from public.dam_readings x
         where x.dam_code = p_dam and x.storage_mcm is not null
           and x.observed_at < checked.at - interval '1 minute'
         order by x.observed_at desc limit 1), -1) then
    return;
  end if;

  -- Warning, never evacuate: see the head of this file.
  return query select 'warning'::public.alert_level, checked.last,
                      round(v_limit::numeric, 3)::double precision, checked.at;
end $$;
revoke all on function public.auto_alarm_reservoir_reading(text) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 6. Publishing a draft. Same function as A8's, now answering for either subject.
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
    select x.id into tpl from public.alert_templates x
      where x.code = 'reservoir_full_warning' and x.active;
    select array_agg(t.tambon_code order by t.tambon_code) into codes
      from public.dam_tambons t
      join public.dams d on d.code = t.dam_code and d.geometry_source = t.source
     where t.dam_code = e.dam_code;
    select g.set_by into issuer from public.auto_alarm_dams g where g.dam_code = e.dam_code;
    select coalesce(d.name ->> 'th', d.code) into subject from public.dams d where d.code = e.dam_code;
    hours := coalesce((cfg -> 'reservoir' ->> 'next_update_h')::integer, 12);
    -- The figures the reason line carries: how full, against the share that fired it, and when.
    detail := format('%s %s Mm3 (%s Mm3) %s', subject, round(e.value::numeric, 2),
                     round(e.threshold::numeric, 2),
                     to_char(e.observed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'));
  else
    select x.id into tpl from public.alert_templates x
      where x.code = 'flood_' || e.level::text and x.active;
    select array_agg(t.tambon_code order by t.tambon_code) into codes
      from public.warning_zone_tambons t where t.zone_id = e.zone_id;
    select g.set_by into issuer from public.auto_alarm_gauges g where g.station_id = e.station_id;
    select s.code into subject from public.stations s where s.id = e.station_id;
    hours := coalesce((cfg ->> 'next_update_h')::integer, 3);
    detail := format('%s %s m (%s m) %s', subject, round(e.value::numeric, 2),
                     round(e.threshold::numeric, 2),
                     to_char(e.observed_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'));
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
            -- A sent drill never carries the template's instructions: it carries the reviewed
            -- words that say what it is (migration 20261020220000).
            case when drill and cardinality(audience) > 0
                 then public.alert_drill_messages(f.level, codes) else f.messages end,
            issuer, now() + make_interval(hours => hours), drill, audience, tpl,
            jsonb_build_object('kind', 'auto_alarm', 'event', e.id,
                               'subject', subject, 'dam', e.dam_code,
                               'gauge', case when e.dam_code is null then subject end,
                               'value', e.value, 'threshold', e.threshold,
                               'observed_at', e.observed_at, 'reviewed', false))
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;
  update public.auto_alarm_events set status = 'auto_published', alert_id = v_alert,
         decided_at = now() where id = p_event;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (null, 'alert_auto_published', 'alerts', v_alert,
            jsonb_build_object('event', e.id, 'subject', subject, 'dam', e.dam_code,
                               'level', e.level, 'drill', drill, 'audience', audience,
                               'tambons', array_length(codes, 1)));
  return v_alert;
end $$;
revoke all on function public.auto_alarm_publish(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 7. The tick, every five minutes: new drafts, and the drafts whose time has run out. The gauge
--    half is A8's, unchanged; the reservoir half is the same shape, keyed on the dam.
-------------------------------------------------------------------------------
create or replace function public.auto_alarm_check() returns integer
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
              and exists (select 1 from public.warning_zone_tambons t
                           where t.zone_id = s.zone_id) loop
    select * into r from public.auto_alarm_reading(g.station_id);
    continue when r.level is null;
    continue when exists (
      select 1 from public.auto_alarm_events x
       where x.zone_id = g.zone_id and public.alert_rank(x.level) >= public.alert_rank(r.level)
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

  -- The reservoirs an admin has ticked, and that have a zone to warn.
  for g in select a.dam_code, d.name ->> 'th' as name from public.auto_alarm_dams a
             join public.dams d on d.code = a.dam_code
            where a.enabled
              and exists (select 1 from public.dam_tambons t
                           where t.dam_code = d.code and t.source = d.geometry_source) loop
    select * into r from public.auto_alarm_reservoir_reading(g.dam_code);
    continue when r.level is null;
    -- Quiet if this reservoir already has a draft at this level or higher, or had one inside the
    -- quiet window.
    continue when exists (
      select 1 from public.auto_alarm_events x
       where x.dam_code = g.dam_code and public.alert_rank(x.level) >= public.alert_rank(r.level)
         and (x.status = 'pending' or x.created_at > now() - make_interval(hours => quiet))
         and x.status in ('pending', 'sent', 'auto_published', 'dismissed'));
    -- Or if a person's alert at that level or higher already stands over its zone.
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

  for e in select * from public.auto_alarm_events where status = 'pending' and deadline <= now() loop
    -- A person sent an alert for the same ground meanwhile: theirs stands.
    if e.zone_id is not null and exists (
         select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
           join public.warning_zone_tambons zt on zt.tambon_code = at.tambon
            and zt.zone_id = e.zone_id
          where al.issued_at >= e.created_at and al.cancelled_at is null and not al.is_drill
            and public.alert_rank(al.level) >= public.alert_rank(e.level)) then
      update public.auto_alarm_events set status = 'sent', decided_at = now() where id = e.id;
      continue;
    end if;
    if e.dam_code is not null and exists (
         select 1 from public.alerts al join public.alert_tambons at on at.alert_id = al.id
           join public.dam_tambons dt on dt.tambon_code = at.tambon and dt.dam_code = e.dam_code
           join public.dams d on d.code = dt.dam_code and d.geometry_source = dt.source
          where al.issued_at >= e.created_at and al.cancelled_at is null and not al.is_drill
            and public.alert_rank(al.level) >= public.alert_rank(e.level)) then
      update public.auto_alarm_events set status = 'sent', decided_at = now() where id = e.id;
      continue;
    end if;
    -- Read again at the end of the grace time. Gone back below, nothing is published.
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
    perform public.auto_alarm_publish(e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.auto_alarm_check() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 8. What the push tick owes. Same two pushes; a reservoir event names the reservoir where a
--    gauge event names the gauge, and carries its share of capacity so the body can say it.
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
                  coalesce(z.name, d.name ->> 'th', d.code) as subject_name,
                  s.code as gauge,
                  case when x.dam_code is not null and d.storage_max_mcm > 0
                       then round((x.value / d.storage_max_mcm * 100)::numeric, 1) end as percent
             from public.auto_alarm_events x
             left join public.warning_zones z on z.id = x.zone_id
             left join public.dams d on d.code = x.dam_code
             left join public.stations s on s.id = x.station_id
            where x.created_at > now() - interval '1 day' loop
    if e.status = 'pending' then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'admins')
        on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'auto_alarm'::text, ps.endpoint, ps.keys, ps.locale,
          jsonb_build_object('event', e.id, 'level', e.level, 'zone', e.subject_name,
                             'gauge', e.gauge, 'dam', e.dam_code, 'percent', e.percent,
                             'value', round(e.value::numeric, 2), 'deadline', e.deadline)
          from public.profiles p join public.push_subscriptions ps on ps.user_id = p.user_id
         where p.role in ('admin', 'super_admin');
      end if;
    elsif e.status = 'auto_published' and e.alert_id is not null
          and exists (select 1 from public.alerts al where al.id = e.alert_id
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
  end loop;
end $$;
revoke all on function public.auto_alarm_push_due(text) from public;
grant execute on function public.auto_alarm_push_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 9. The admin's tick for a reservoir, and the log the console reads.
-------------------------------------------------------------------------------
create function public.admin_set_auto_alarm_dam(p_dam text, p_enabled boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform public.admin_only();
  insert into public.auto_alarm_dams (dam_code, enabled, set_by, set_at)
    select d.code, p_enabled, auth.uid(), now() from public.dams d
     where p_dam is null or d.code = p_dam
  on conflict (dam_code) do update
    set enabled = excluded.enabled, set_by = excluded.set_by, set_at = excluded.set_at;
  get diagnostics n = row_count;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(),
            case when p_enabled then 'auto_alarm_on' else 'auto_alarm_off' end, 'dams', null,
            jsonb_build_object('all', p_dam is null, 'dam', p_dam, 'reservoirs', n));
  return n;
end $$;
revoke all on function public.admin_set_auto_alarm_dam(text, boolean) from public, anon;
grant execute on function public.admin_set_auto_alarm_dam(text, boolean) to authenticated;

-- The log, which until now inner-joined the warning zone and so could not show a reservoir's
-- draft at all. `kind` tells a screen which units the figures are in.
create or replace function public.admin_auto_alarms(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."createdAt" desc)
      from (
        select e.id, e.status, e.level,
               case when e.dam_code is not null then 'reservoir' else 'gauge' end as kind,
               coalesce(z.name, dm.name ->> 'th', dm.code) as zone,
               s.code as gauge, e.dam_code as dam,
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
