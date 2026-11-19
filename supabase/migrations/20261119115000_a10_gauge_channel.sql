-- The channel at each river gauge, so the cross-section on a gauge's card is that river's shape.
--
-- The owner, 19 Nov 2026: "if we have the river bed and bank width would be nice to make the
-- illustration of the cross section more realistic ... as much as we can, of course no need to
-- wait for the surveyed data."
--
-- There is no surveyed cross-section for these stations and this does not invent one. What it
-- carries is what can honestly be had (pipeline/gauge_section/METHODS.md):
--
--   * `bed_m`, `left_bank_m`, `right_bank_m` - ThaiWater's own station record. The two banks
--     differ at half the stations, sometimes by metres, and the lower one is the one the river
--     leaves first; the bed is the ground level the agency lists, which near the coast is often
--     below mean sea level.
--   * `width_m` - measured across the water OpenStreetMap has digitised, as the median of five
--     transects (c) OpenStreetMap contributors, ODbL. It is the width of the water surface their
--     mappers drew at an unknown river level: not bank-to-bank, and not a survey. A station whose
--     river OSM maps only as a centreline has **no width**, because the river-body layer's
--     buffered half-width is a drawing and would be a figure nobody measured.
--
-- Every column is nullable and a missing figure stays missing: the card then draws its own
-- channel for that station and says the shape is a drawing (safety rules 8 and 10). Nothing here
-- is a level and nothing here can raise one (safety rule 2) - the Watch, Warning and Evacuate
-- lines still come from `gauge_levels`.
--
-- Rebuilt whole from 20261119093000_a10_gauge_levels_public and must be applied after it.

create table public.gauge_channel (
  station_id uuid primary key references public.stations (id) on delete cascade,
  bed_m double precision,
  left_bank_m double precision,
  right_bank_m double precision,
  width_m double precision,
  method jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- A bed at or above the lower bank is not a channel; a negative width is not a width.
  constraint gauge_channel_sane check (
    (bed_m is null or left_bank_m is null or bed_m < left_bank_m)
    and (bed_m is null or right_bank_m is null or bed_m < right_bank_m)
    and (width_m is null or width_m > 0))
);
alter table public.gauge_channel enable row level security;
-- The shape of a river's channel is not sensitive: it is on every map and in the agency's own
-- station list. It leaves through `station_status()` below, which everyone may call, so the table
-- itself needs no reader of its own beyond the admins who look at the method behind a figure.
create policy gauge_channel_admin_read on public.gauge_channel for select to authenticated
  using (public.is_admin());
revoke all on public.gauge_channel from anon, authenticated;
grant select on public.gauge_channel to authenticated;

-- station_status(), with the channel on the end. Rebuilt whole from
-- 20261119093000_a10_gauge_levels_public, line for line apart from the four columns added here.
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
