-- Watch, Warning and Evacuate levels for every river gauge (the owner, 14 Oct 2026: "suggest the
-- thresholds for all zones in the river gauges, for all 3 ... Admin can change later").
--
-- The suggestions come from the pipeline (`thresholds gauges`, pipeline/thresholds/gauges.py) and
-- are loaded by seed 47 as provisional; an admin changes them on the signal dashboard's gauge map.
-- A zone's key gauge keeps one truth: setting its levels here also sets the zone's `key_level_m`
-- threshold (Warning and Evacuate), which is what the suggestion and the automated alarm read.
-- A level only ever starts a suggestion, or the automated alarm an admin ticked (safety rule 2).
-- Levels are metres above mean sea level, so near the sea they may be at or below nought.

create table public.gauge_levels (
  station_id uuid primary key references public.stations (id) on delete cascade,
  watch_m double precision,
  warning_m double precision,
  evacuate_m double precision,
  provisional boolean not null default true,
  method jsonb not null default '{}'::jsonb,
  set_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint gauge_levels_order check (
    (watch_m is null or warning_m is null or watch_m < warning_m)
    and (warning_m is null or evacuate_m is null or warning_m <= evacuate_m)
    and (watch_m is null or evacuate_m is null or watch_m < evacuate_m))
);
alter table public.gauge_levels enable row level security;
-- Admins read them; nobody writes them but the function below (and the seed, as the owner).
create policy gauge_levels_admin_read on public.gauge_levels for select to authenticated
  using (public.is_admin());
revoke all on public.gauge_levels from anon, authenticated;
grant select on public.gauge_levels to authenticated;

-- Every gauge's levels, for the dashboard's map. Admins only.
create function public.admin_gauge_levels()
returns table (station_id uuid, watch_m double precision, warning_m double precision, evacuate_m double precision,
               provisional boolean, method jsonb, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.station_id, g.watch_m, g.warning_m, g.evacuate_m, g.provisional, g.method, g.updated_at
  from public.gauge_levels g
  where public.is_admin()
$$;
revoke all on function public.admin_gauge_levels() from public, anon;
grant execute on function public.admin_gauge_levels() to authenticated;

-- An admin sets one gauge's levels. Any of the three may be left empty; the order must hold.
create function public.admin_set_gauge_levels(
  p_station uuid, p_watch double precision, p_warning double precision, p_evacuate double precision,
  p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  v_old jsonb;
  v_at timestamptz := now();
  v_zone text;
  v_levels jsonb;
begin
  perform public.admin_only();
  select * into st from public.stations where id = p_station;
  if st.id is null then
    raise exception 'no such gauge' using errcode = 'no_data_found';
  end if;
  if p_watch is null and p_warning is null and p_evacuate is null then
    raise exception 'a gauge needs at least one level' using errcode = 'check_violation';
  end if;
  if (p_watch is not null and p_warning is not null and p_watch >= p_warning)
     or (p_warning is not null and p_evacuate is not null and p_warning > p_evacuate)
     or (p_watch is not null and p_evacuate is not null and p_watch >= p_evacuate) then
    raise exception 'levels must rise from Watch to Warning to Evacuate' using errcode = 'check_violation';
  end if;
  select to_jsonb(g) - 'station_id' - 'set_by' - 'method' into v_old from public.gauge_levels g where g.station_id = p_station;
  insert into public.gauge_levels (station_id, watch_m, warning_m, evacuate_m, provisional, method, set_by, updated_at)
    values (p_station, p_watch, p_warning, p_evacuate, false,
            jsonb_build_object('how', 'set by an admin', 'note', p_note), auth.uid(), v_at)
    on conflict (station_id) do update
      set watch_m = excluded.watch_m, warning_m = excluded.warning_m, evacuate_m = excluded.evacuate_m,
          provisional = false, method = excluded.method, set_by = excluded.set_by, updated_at = excluded.updated_at;
  -- A zone's key gauge: its Warning and Evacuate are the zone's key-level threshold too.
  select z.basin into v_zone from public.warning_zones z
    join public.system_settings s on s.key = 'signal_feed'
   where z.id = st.zone_id and st.thaiwater_id is not null
     and (s.value -> 'zones' -> z.basin -> 'gauges' ->> 'key')::bigint = st.thaiwater_id;
  if v_zone is not null and (p_warning is not null or p_evacuate is not null) then
    v_levels := jsonb_strip_nulls(jsonb_build_object('warning', p_warning, 'evacuate', p_evacuate));
    insert into public.thresholds (zone_id, signal, levels, provisional, set_by, updated_at)
      values (st.zone_id, 'key_level_m', v_levels, false, auth.uid(), v_at)
      on conflict (zone_id, signal) do update
        set levels = excluded.levels, provisional = false, set_by = excluded.set_by, updated_at = excluded.updated_at;
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'gauge_levels_set', 'stations', p_station,
            jsonb_build_object('code', st.code, 'from', v_old,
                               'to', jsonb_build_object('watch', p_watch, 'warning', p_warning, 'evacuate', p_evacuate),
                               'key_of_zone', v_zone, 'note', p_note));
  return v_at;
end $$;
revoke all on function public.admin_set_gauge_levels(uuid, double precision, double precision, double precision, text)
  from public, anon;
grant execute on function public.admin_set_gauge_levels(uuid, double precision, double precision, double precision, text)
  to authenticated;

-- The automated alarm: a gauge other than its zone's key gauge raises Warning (never more on its
-- own) at its own Evacuate level when one is set, else at its bank as before.
create or replace function public.auto_alarm_reading(p_station uuid)
returns table (level public.alert_level, value double precision, threshold double precision, observed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := (select s.value from public.system_settings s where s.key = 'auto_alarm');
  n integer := coalesce((cfg ->> 'confirm_readings')::integer, 2);
  age double precision := coalesce((cfg ->> 'max_age_h')::double precision, 3);
  st public.stations;
  roles jsonb;
  key_levels jsonb;
  own_top double precision;
  lo double precision;
  checked record;
begin
  select * into st from public.stations where id = p_station;
  if st.id is null or st.zone_id is null then return; end if;
  roles := (select s.value -> 'zones' -> (select z.basin from public.warning_zones z where z.id = st.zone_id) -> 'gauges'
              from public.system_settings s where s.key = 'signal_feed');
  select t.levels into key_levels from public.thresholds t where t.zone_id = st.zone_id and t.signal = 'key_level_m';
  select coalesce(g.evacuate_m, st.warning_m) into own_top from public.gauge_levels g where g.station_id = p_station;
  own_top := coalesce(own_top, st.warning_m);

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
  elsif own_top is not null and checked.least >= own_top then
    return query select 'warning'::public.alert_level, checked.last, own_top, checked.at;
  end if;
end $$;
revoke all on function public.auto_alarm_reading(uuid) from public, anon, authenticated;
