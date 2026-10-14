-- The suggested levels of every gauge in a zone go into that zone's threshold boxes (the owner,
-- 14 Oct 2026: "bring all values you suggested ... directly to those threshold boxes").
--
-- One value, not two: a zone's key gauge's Watch, Warning and Evacuate are its `key_level_m`
-- threshold, and its upstream gauge's are its `upstream_level_m` threshold. Saving a gauge's levels
-- writes both; a threshold an admin already set by hand is never overwritten by the sync below.

-- Which role a gauge has in its zone: 'key', 'upstream' or null.
create function public.gauge_role(p_station uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when (s.value -> 'zones' -> z.basin -> 'gauges' ->> 'key')::bigint = st.thaiwater_id then 'key'
           when (s.value -> 'zones' -> z.basin -> 'gauges' ->> 'upstream')::bigint = st.thaiwater_id then 'upstream'
         end
  from public.stations st
  join public.warning_zones z on z.id = st.zone_id
  join public.system_settings s on s.key = 'signal_feed'
  where st.id = p_station and st.thaiwater_id is not null
$$;
revoke all on function public.gauge_role(uuid) from public, anon, authenticated;

-- Copy a gauge's levels into its zone's threshold for its role. `p_by` null = a sync, which
-- leaves a threshold an admin set by hand alone.
create function public.gauge_levels_to_zone(p_station uuid, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  g public.gauge_levels;
  v_role text := public.gauge_role(p_station);
  v_signal text;
  v_levels jsonb;
begin
  if v_role is null then return; end if;
  select * into st from public.stations where id = p_station;
  select * into g from public.gauge_levels where station_id = p_station;
  if g.station_id is null then return; end if;
  v_signal := case v_role when 'key' then 'key_level_m' else 'upstream_level_m' end;
  v_levels := jsonb_strip_nulls(jsonb_build_object('watch', g.watch_m, 'warning', g.warning_m, 'evacuate', g.evacuate_m));
  if v_levels = '{}'::jsonb then return; end if;
  insert into public.thresholds (zone_id, signal, levels, provisional, set_by, updated_at)
    values (st.zone_id, v_signal, v_levels, p_by is null, p_by, now())
    on conflict (zone_id, signal) do update
      set levels = excluded.levels, provisional = excluded.provisional,
          set_by = excluded.set_by, updated_at = excluded.updated_at
      where p_by is not null or public.thresholds.provisional;
end $$;
revoke all on function public.gauge_levels_to_zone(uuid, uuid) from public, anon, authenticated;

-- An admin sets one gauge's levels (as before), and its zone's threshold follows when it is the
-- zone's key or upstream gauge.
create or replace function public.admin_set_gauge_levels(
  p_station uuid, p_watch double precision, p_warning double precision, p_evacuate double precision,
  p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  v_old jsonb;
  v_at timestamptz := now();
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
  perform public.gauge_levels_to_zone(p_station, auth.uid());
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'gauge_levels_set', 'stations', p_station,
            jsonb_build_object('code', st.code, 'from', v_old,
                               'to', jsonb_build_object('watch', p_watch, 'warning', p_warning, 'evacuate', p_evacuate),
                               'role', public.gauge_role(p_station), 'note', p_note));
  return v_at;
end $$;

-- Bring the suggestions already loaded into the zones' boxes (provisional thresholds only).
do $$
declare r record;
begin
  for r in select g.station_id from public.gauge_levels g loop
    perform public.gauge_levels_to_zone(r.station_id, null);
  end loop;
end $$;
