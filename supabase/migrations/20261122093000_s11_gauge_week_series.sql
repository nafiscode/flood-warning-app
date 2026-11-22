-- The week a river has had, as eight figures a card can draw - and a guard against the one bad
-- day that was inventing an eleven-metre rise.
--
-- The owner, 22 Nov 2026: "now that we have the records of 7 days water level to tell the user if
-- it's been risen for the past 7 days, instead of just word we should have a minimal graph to
-- support the wording as well, trend graphs".
--
-- `station_status()` has counted the week since 10 Nov (20261110170000_s11_gauge_week_trend) but
-- kept the series to itself: it returned how many days the daily low rose and how much it moved
-- in all, and threw the eight daily lows away. They are what a line needs, so one column carries
-- them out:
--
--   * `week_floors` - the eight daily lows the two existing figures were computed from, in day
--     order, oldest first, m MSL. The same gate as `rose_days`: null unless the whole run is
--     there, so a drawing can never be made out of a partial week.
--
-- It is the same measurement said a second way, and the card prints every one of the eight
-- figures in words beside the line (components/map/GaugeWeek.tsx). The drawing carries no level:
-- a *daily low* below Watch says nothing about whether that day's peak was, so putting the alert
-- thresholds on this line would be a claim the series cannot support (safety rules 2 and 8).
--
-- **The guard, which is the reason this is not only a drawing.** Looking at the series for the
-- first time showed what the counting could not: on jaga-dev, 22 Nov 2026, X.73A read a daily low
-- of 11.31 m on 14 November between two days of 22.3 m, and the river has no business falling
-- eleven metres and climbing back inside a day. That single dropout was the whole of the station's
-- `week_change_m`, so the public map was saying the Pattani river at X.73A had risen **10.91 m in
-- eight days**. It had not moved. A sensor fault was being published as a flood signal.
--
-- So a day whose daily low differs from the day before it AND the day after it by more than 2 m,
-- in opposite directions, is treated as the fault it is - and the station becomes unjudgeable for
-- the week, exactly as an incomplete run already does: null for all three columns and the card's
-- existing "the week's trend cannot be read at this station". It is not quietly corrected and the
-- bad day is not dropped from the series, because either would publish a figure nobody measured.
--
-- Why that shape and that threshold:
--
--   * **Both sides, opposite directions.** A real flood rises and stays, or falls back over days.
--     A one-day V or spike in a series of daily *minima* is an instrument, not a river. A rise
--     that holds for even one more day is untouched.
--   * **2 m.** Measured over the twelve days to 22 Nov 2026 across every station, exactly two days
--     anywhere answered the shape at all: X.73A's 10.93 m dropout, and X.113 on 16 November with
--     0.62 m, which is the size of a real night's rain and is left alone. The threshold sits in
--     open ground between the two, an order of magnitude from either.
--   * **It can only ever silence a figure, never raise one.** The worst a wrong guess here can do
--     is make Jaga say "this cannot be read" about a station it could have read. It cannot publish
--     anything, cannot colour a tambon and cannot move a level (safety rule 2).
--
-- The neighbour a day is tested against may be the day before the window or today-so-far; today is
-- a part day and is never a data point, but "did the level come back?" is a fair question to ask of
-- it. Where a neighbour is missing the day is not tested, because a gap cannot prove a fault.
--
-- Rebuilt whole from 20261119115000_a10_gauge_channel and must be applied after it. Diffed against
-- the live `pg_get_functiondef()` on jaga-dev before writing (CLAUDE.local.md, 19 Nov): the body
-- below is that one, with the `spikes` CTE and the `week_floors` column added and nothing else
-- changed.

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
  week_floors double precision[],
  watch_m double precision,
  warning_m double precision,
  evacuate_m double precision,
  levels_provisional boolean,
  bed_m double precision,
  left_bank_m double precision,
  right_bank_m double precision,
  channel_width_m double precision
)
language sql
stable
-- Reads `gauge_levels`, `season_baseflow` and `gauge_channel`. From `season_baseflow` nothing
-- leaves: it is used only to ask whether this station is one the catchment moves. From the other
-- two exactly the figures below leave, and nothing of who set them or how.
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
  -- A one-day V or spike deeper than 2 m on both sides: an instrument, not a river. See the
  -- header. The day before the window and today-so-far are allowed as neighbours, as the
  -- shoulders of the test only; a day whose neighbour is missing is not tested, because a gap
  -- cannot prove a fault.
  spikes as (
    select distinct n.station_id
      from (
        select f.station_id, f.day, f.floor_m,
               lag(f.floor_m) over (partition by f.station_id order by f.day) as prev,
               lead(f.floor_m) over (partition by f.station_id order by f.day) as next
          from floors f, today
         where f.day between today.d - 9 and today.d
      ) n, today
     where n.day between today.d - 8 and today.d - 1
       and n.prev is not null
       and n.next is not null
       and abs(n.floor_m - n.prev) > 2.0
       and abs(n.next - n.floor_m) > 2.0
       and sign(n.floor_m - n.prev) = -sign(n.next - n.floor_m)
  ),
  trend as (
    select w.station_id,
           (select count(*)::integer from generate_series(2, 8) i
             where w.floors[i] > w.floors[i - 1]) as rose_days,
           round((w.floors[8] - w.floors[1])::numeric, 2)::double precision as week_change_m,
           -- The eight figures the two above were computed from, for the card's line.
           w.floors as week_floors
      from week w, today
      -- Only a station Module 11 keeps, and only with the whole run of days behind it.
     where exists (select 1 from public.season_baseflow b where b.station_id = w.station_id)
       and array_length(w.days, 1) = 8
       and w.days[1] = today.d - 8
       and w.days[8] = today.d - 1
       and w.last_at >= now() - interval '36 hours'
       -- A station with a sensor fault in the window is not judged at all, rather than judged on
       -- the fault. Null reads as "cannot be read", never as a quiet week (safety rule 10).
       and not exists (select 1 from spikes sp where sp.station_id = w.station_id)
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
         tr.week_floors,
         -- The levels the picture draws: the very ones the word above was decided on.
         l.watch_m,
         l.warning_m,
         l.evacuate_m,
         coalesce(gl.provisional, true) as levels_provisional,
         -- The channel itself. Measured or quoted, never modelled; null where it is not known.
         gc.bed_m,
         gc.left_bank_m,
         gc.right_bank_m,
         gc.width_m as channel_width_m
  from public.stations s
  -- The gauge's own levels where it has them; the `stations` columns, and the old bank - 0.5 m
  -- guess for Watch, only where it does not.
  left join public.gauge_levels gl on gl.station_id = s.id
  left join lateral (
    select coalesce(gl.watch_m, s.watch_m, s.warning_m - 0.5) as watch_m,
           coalesce(gl.warning_m, s.warning_m) as warning_m,
           gl.evacuate_m as evacuate_m
  ) l on true
  left join public.gauge_channel gc on gc.station_id = s.id
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
