-- A8 item 4: gauge status on the public map.
--
-- `station_status` gains three things the public map draws: the station's code, its bank level,
-- and how much the river has risen or fallen in about three hours (the reading nearest to three
-- hours before the newest, between two and four hours back; null when there is none). And a gauge
-- that has no level of its own between normal and its bank (every gauge but a zone's key gauge)
-- is now "near its bank" half a metre below it, as the admins' map already says.
--
-- The output columns change, so the function is dropped and made again. Its grants go with it.

drop function if exists public.station_status();

create function public.station_status()
returns table (
  id uuid, code text, name jsonb, basin text, lat double precision, lon double precision,
  value double precision, observed_at timestamptz, status text,
  rise_3h double precision, bank_m double precision
)
language sql stable set search_path = '' as $$
  select s.id, s.code, s.name, s.basin, extensions.st_y(s.point), extensions.st_x(s.point),
         o.value, o.ts,
         case
           when o.ts is null or o.ts < now() - interval '6 hours' then 'no_recent_data'
           when s.warning_m is not null and o.value >= s.warning_m then 'above_warning'
           when coalesce(s.watch_m, s.warning_m - 0.5) is not null
                and o.value >= coalesce(s.watch_m, s.warning_m - 0.5) then 'above_watch'
           when s.watch_m is null and s.warning_m is null then 'no_levels'
           else 'normal'
         end,
         case when o.ts is not null and o.ts >= now() - interval '6 hours'
              then round((o.value - b.value)::numeric, 2)::double precision end,
         s.warning_m::double precision
  from public.stations s
  left join lateral (
    select ob.value, ob.ts from public.observations ob
    where ob.station_id = s.id and ob.variable = 'water_level_msl' and ob.value is not null
    order by ob.ts desc limit 1
  ) o on true
  left join lateral (
    select ob.value from public.observations ob
    where ob.station_id = s.id and ob.variable = 'water_level_msl' and ob.value is not null
      and ob.ts between o.ts - interval '4 hours' and o.ts - interval '2 hours'
    order by abs(extract(epoch from (ob.ts - (o.ts - interval '3 hours')))) limit 1
  ) b on true
  order by s.code
$$;
revoke execute on function public.station_status() from public;
grant execute on function public.station_status() to anon, authenticated;
