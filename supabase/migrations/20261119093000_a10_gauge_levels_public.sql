-- The three levels of a river gauge, as numbers, on the public map.
--
-- The owner, 19 Nov 2026: a gauge opened from the map should show "the river bed with the river
-- live level with the line of the watch, alert and evacuate, similar to the one in Nara flood".
-- That picture cannot be drawn from a word: it needs the metres of Watch, Warning and Evacuate.
--
-- `station_status()` has graded on `public.gauge_levels` since 20261021120000, but deliberately let
-- nothing out of it but the word and the bank level. This widens that by exactly three numbers and
-- one flag, and nothing else:
--
--   * `watch_m`, `warning_m`, `evacuate_m` - the SAME coalesced levels the grading above uses, so
--     the picture and the word can never disagree. Where the gauge has no row in `gauge_levels`
--     the old `stations` fallback still stands (and for Watch that fallback is the flat guess of
--     bank - 0.5 m), which is why the flag below matters.
--   * `levels_provisional` - true unless an admin has marked this gauge's own row reviewed. A gauge
--     with no row of its own is provisional by definition. The card says so in words beside the
--     drawing: these are Jaga's own figures from past floods, not an authority's published levels.
--
-- Nothing else from `gauge_levels` leaves the function: not who set them, not when, not the method.
-- A level is still only ever the start of a suggestion or of the automated alarm an admin ticked;
-- a reading drawn against it is a measurement and not an alert (safety rule 2), and the card that
-- draws it says that too.
--
-- Rebuilt whole from 20261110170000_s11_gauge_week_trend, which is the newest definition and which
-- this keeps line for line apart from the four columns added below. **It must be applied after
-- that one** (timestamp order does this); applied before it, Module 11's `rose_days` and
-- `week_change_m` would come back and take these four away again.

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
  week_change_m double precision,
  watch_m double precision,
  warning_m double precision,
  evacuate_m double precision,
  levels_provisional boolean
)
language sql
stable
-- Reads `gauge_levels` and `season_baseflow`, which only admins may select. From `season_baseflow`
-- nothing leaves: it is used only to ask whether this station is one the catchment moves. From
-- `gauge_levels` exactly the three levels and the provisional flag leave, by the decision above.
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
         tr.week_change_m,
         -- The levels the picture draws: the very ones the word above was decided on.
         l.watch_m,
         l.warning_m,
         l.evacuate_m,
         coalesce(gl.provisional, true) as levels_provisional
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
