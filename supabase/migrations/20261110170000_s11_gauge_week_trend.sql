-- Module 11 on the public map: how many rivers have been rising for a week.
--
-- The owner, 10 Nov 2026, looking at the laptop console's rivers card: "instead of just saying
-- 'All below their banks' it should also say how many of the rivers level has risen for the past
-- weeks consistantly. And when clicked ... should open the rivergauge details that their level has
-- risen first then later on sort with which river is related to the location first."
--
-- Module 11 already measures this, but only for the three key gauges, and only for admins. The
-- same rule is applied here to every station the public map draws, so `station_status()` carries
-- two more figures per gauge:
--
--   * `rose_days`    - on how many of the last seven whole Bangkok days the river's daily low was
--                      higher than the day before. Seven comparisons, so 0..7.
--   * `week_change_m` - the daily low of yesterday less the daily low eight days ago, in metres.
--
-- Three honesty rules, each of them load-bearing:
--
--   1. **The daily low, not the reading.** A gauge's peak is thrown about by the tide and by the
--      afternoon's rain; its lowest reading of the day is the closest a single station comes to
--      what the ground is still holding (science plan Module 11).
--   2. **Only the gauges the catchment actually moves.** A tidal station's daily low follows the
--      moon, so over a spring tide every river mouth would read as "rising for a week". A station
--      is judged here only if it has a row in `season_baseflow`, which is written by
--      `season_state run` and holds exactly the stations that passed Module 11's harmonic test
--      (32 of 46 on 10 Nov 2026: the sea under 0.05 m and no daily pulse over 0.20 m). Measured
--      on jaga-dev the same day, excluding them is not cosmetic - ONE037 read 5 of 7 days rising
--      while the two real risers were X.67A (6 of 7, +0.43 m) and X.274 (5 of 7, +0.30 m).
--      Nothing from `season_baseflow` leaves this function: only whether a row exists.
--   3. **Eight whole days in a row, or no figure at all.** A gap must never be able to look like a
--      day the river did not rise, so a station without the full run, or silent for 36 hours,
--      returns null for both columns and is counted as "could not be judged" rather than as calm
--      (safety rule 10).
--
-- This is a measurement, not a forecast and not a level (safety rules 2 and 8). It raises nothing,
-- colours nothing and cannot move a tambon's status; it is the same figure an admin reads on the
-- signal dashboard, said out loud on the public map.

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
  bank_m double precision,
  rose_days integer,
  week_change_m double precision
)
language sql
stable
-- Reads `gauge_levels` and `season_baseflow`, which only admins may select. Nothing from either
-- leaves the function: the levels become one of the words below, and the baseflow reference is
-- used only to ask whether this station is one the catchment moves.
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'Asia/Bangkok')::date as d),
  -- The lowest reading of each Bangkok day. Today is still running, so the window ends yesterday.
  floors as (
    select o.station_id,
           (o.ts at time zone 'Asia/Bangkok')::date as day,
           min(o.value) as floor_m,
           max(o.ts) as last_at
      from public.observations o
     where o.variable = 'water_level_msl'
       and o.value is not null
       and o.ts >= now() - interval '11 days'
     group by 1, 2
  ),
  week as (
    select f.station_id,
           array_agg(f.floor_m order by f.day) as floors,
           array_agg(f.day order by f.day) as days,
           max(f.last_at) as last_at
      from floors f, today
     where f.day between today.d - 8 and today.d - 1
     group by 1
  ),
  trend as (
    select w.station_id,
           (select count(*)::integer from generate_series(2, 8) i
             where w.floors[i] > w.floors[i - 1]) as rose_days,
           round((w.floors[8] - w.floors[1])::numeric, 2)::double precision as week_change_m
      from week w, today
      -- Only a station Module 11 keeps, and only with the whole run of days behind it.
     where exists (select 1 from public.season_baseflow b where b.station_id = w.station_id)
       and array_length(w.days, 1) = 8
       and w.days[1] = today.d - 8
       and w.days[8] = today.d - 1
       and w.last_at >= now() - interval '36 hours'
  )
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
         s.warning_m::double precision as bank_m,
         tr.rose_days,
         tr.week_change_m
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
  left join trend tr on tr.station_id = s.id
  order by s.code
$$;
revoke execute on function public.station_status() from public;
grant execute on function public.station_status() to anon, authenticated;
