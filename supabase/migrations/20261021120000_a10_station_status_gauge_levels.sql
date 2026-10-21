-- A10: the public map grades a river gauge by the gauge's own levels.
--
-- Until now `station_status()` graded on `stations.warning_m` (the bank) and `stations.watch_m`,
-- and `watch_m` is set on only two of the 48 gauges, so for every other gauge "close to its bank"
-- meant the flat guess of bank - 0.5 m. Meanwhile `public.gauge_levels` holds a Watch, Warning and
-- Evacuate level per gauge (from `thresholds gauges`, and from an admin through
-- `admin_set_gauge_levels`), and the admins' signal dashboard grades on those. The two disagreed:
-- measured on jaga-dev, the map turned amber later than the real Watch on 34 of the 46 gauges that
-- have both (0.69 m late on average, 4.74 m at worst) and red later than the real Warning on 39 of
-- them, and an admin's own levels never reached the public map at all.
--
-- So the levels in `gauge_levels` are now what the public map reads, with the `stations` columns
-- kept as the fallback for a gauge that has no row there. Evacuate gets its own status rather than
-- reading as `above_warning`: a level is never shown lower than it is (safety rule 3). The reading
-- is still a measurement, never an alert (safety rule 2) - only the wording and the glass change.

drop function if exists public.station_status();

create function public.station_status()
returns table (
  id uuid,
  code text,
  name jsonb,
  basin text,
  lat double precision,
  lon double precision,
  value double precision,
  observed_at timestamptz,
  status text,
  rise_3h double precision,
  bank_m double precision
)
language sql
stable
-- Reads `gauge_levels`, which only admins may select (A8). Nothing from it leaves the function:
-- the levels are turned into one of the words below, and only the bank level - already public
-- before this - is returned as a number.
security definer
set search_path = ''
as $$
  select s.id, s.code, s.name, s.basin,
         extensions.st_y(s.point) as lat, extensions.st_x(s.point) as lon,
         o.value, o.ts as observed_at,
         case
           when o.ts is null or o.ts < now() - interval '6 hours' then 'no_recent_data'
           when l.evacuate_m is not null and o.value >= l.evacuate_m then 'above_evacuate'
           when l.warning_m is not null and o.value >= l.warning_m then 'above_warning'
           when l.watch_m is not null and o.value >= l.watch_m then 'above_watch'
           when l.evacuate_m is null and l.warning_m is null and l.watch_m is null then 'no_levels'
           else 'normal'
         end as status,
         case when o.ts is not null and o.ts >= now() - interval '6 hours'
              then round((o.value - b.value)::numeric, 2)::double precision end as rise_3h,
         s.warning_m::double precision as bank_m
  from public.stations s
  -- The gauge's own levels where it has them; the `stations` columns, and the old bank - 0.5 m
  -- guess for Watch, only where it does not.
  left join public.gauge_levels gl on gl.station_id = s.id
  left join lateral (
    select coalesce(gl.watch_m, s.watch_m, s.warning_m - 0.5) as watch_m,
           coalesce(gl.warning_m, s.warning_m) as warning_m,
           gl.evacuate_m as evacuate_m
  ) l on true
  left join lateral (
    select ob.value, ob.ts
    from public.observations ob
    where ob.station_id = s.id and ob.variable = 'water_level_msl' and ob.value is not null
    order by ob.ts desc
    limit 1
  ) o on true
  left join lateral (
    select ob.value
    from public.observations ob
    where ob.station_id = s.id and ob.variable = 'water_level_msl' and ob.value is not null
      and ob.ts between o.ts - interval '4 hours' and o.ts - interval '2 hours'
    order by abs(extract(epoch from (ob.ts - (o.ts - interval '3 hours'))))
    limit 1
  ) b on true
  order by s.code
$$;
revoke execute on function public.station_status() from public;
grant execute on function public.station_status() to anon, authenticated;
