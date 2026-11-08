-- A10: the automated alarm reads a gauge's own Warning level, not its bank.
--
-- `auto_alarm_reading()` grades a ticked gauge two ways. Its zone's key gauge is graded on the
-- zone's `key_level_m` threshold, which `admin_set_gauge_levels` keeps equal to that gauge's row
-- in `gauge_levels`, so Warning there has always meant Warning. Every other ticked gauge was
-- graded on `coalesce(gauge_levels.evacuate_m, stations.warning_m)` - its bank. It raised a
-- Warning draft, but only once the river was already at the level where people leave.
--
-- On jaga-dev today that is 0.29 m late on X.90, 0.75 m on X.274 and 1.55 m on X.77: the public
-- map, which has read `gauge_levels` since 20261021120000, can show a gauge at Warning for hours
-- while the alarm is still silent. The map and the alarm now read the same number.
--
-- What does not change:
--   * a gauge that is not its zone's key gauge still never raises more than Warning on its own
--     (the owner, 14 Oct 2026); its Evacuate level is no longer a trigger of its own, because
--     Warning is reached first and the zone then holds a Warning draft or alert;
--   * the key gauge's two levels, the freshness and confirming-readings guards, the quiet window
--     and the re-read at the end of the grace time are all untouched;
--   * the all-clear reads the threshold back off the event it is clearing
--     (`e.threshold + clear.gauge_margin_m`), so the river now has to fall back to the Warning it
--     was raised at, not to the bank.
--
-- Only the number a non-key gauge is compared against moves, and it only ever moves down, so the
-- alarm can fire earlier than before and never later. A person still sends or dismisses the draft
-- (safety rule 2).

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
  own_warn double precision;
  lo double precision;
  checked record;
begin
  select * into st from public.stations where id = p_station;
  if st.id is null or st.zone_id is null then return; end if;
  roles := (select s.value -> 'zones' -> (select z.basin from public.warning_zones z where z.id = st.zone_id) -> 'gauges'
              from public.system_settings s where s.key = 'signal_feed');
  select t.levels into key_levels from public.thresholds t where t.zone_id = st.zone_id and t.signal = 'key_level_m';
  -- The gauge's own Warning; its Evacuate, then its bank, only for a gauge that has no Warning set.
  select coalesce(g.warning_m, g.evacuate_m, st.warning_m) into own_warn
    from public.gauge_levels g where g.station_id = p_station;
  own_warn := coalesce(own_warn, st.warning_m);

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
  elsif own_warn is not null and checked.least >= own_warn then
    return query select 'warning'::public.alert_level, checked.last, own_warn, checked.at;
  end if;
end $$;
revoke all on function public.auto_alarm_reading(uuid) from public, anon, authenticated;
