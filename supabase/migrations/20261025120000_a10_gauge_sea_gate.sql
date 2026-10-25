-- The sea beside the river on the public gauge card (the owner, 25 Oct 2026: "tide next to river
-- level ... animated on the map, details when clicked").
--
-- The coastal gate (science plan Module 10) stays admin-only as a table. What leaves it here is one
-- word per tidal gauge - 'open', 'narrowing', 'shut' or 'unknown' - the first day of the longest
-- shut run, and when the forecast behind it was issued. No sea height, no percentile: the model
-- sat about 0.7 m off the Pattani tide gauge, so a height in public would read as a forecast
-- (safety rule 8), and the word is only ever a comparison with the same mouth's own record.
--
-- It is a modifier, never a level (safety rule 2): nothing here feeds an alert, a suggestion or the
-- auto alarm. Missing or old forecast data gives 'unknown', never 'open' - a missing figure is not
-- good news. The rule is the same as lib/coastal-gate.ts `coastalGate()` (a day needs 20 of its 24
-- hours; shut = a day's low water at or over the mouth's p90; two shut days in a row = shut).

create function public.gauge_sea_gate()
returns table (code text, state text, shut_from timestamptz, shut_days integer, issued_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with mouth as (
    select s.code, g.zone_id, g.llw_p50, g.llw_p90
      from public.stations s
      join public.gauge_recession r on r.station_id = s.id
      join public.coastal_gate_reference g on g.zone_id = s.zone_id
     where (r.method -> 'flags' ->> 'tidal')::boolean is true
  ),
  hourly as (
    select m.code, m.llw_p50, m.llw_p90,
           ((f.valid_at at time zone 'Asia/Bangkok')::date) as day,
           f.value, f.issued_at
      from mouth m
      join public.forecasts f
        on f.zone_id = m.zone_id and f.source = 'open_meteo_marine' and f.variable = 'sea_level_m'
     where f.value is not null
       and (f.valid_at at time zone 'Asia/Bangkok')::date >= (now() at time zone 'Asia/Bangkok')::date
  ),
  days as (
    select code, llw_p50, llw_p90, day, min(value) as low, max(issued_at) as issued_at,
           row_number() over (partition by code order by day) as rn
      from hourly
     group by code, llw_p50, llw_p90, day
    having count(*) >= 20
  ),
  flagged as (
    select d.*, (d.llw_p90 is not null and d.low >= d.llw_p90) as shut from days d
  ),
  runs as (
    select code, min(day) as from_day, count(*) as len
      from (select f.*, f.rn - row_number() over (partition by f.code order by f.rn) as grp
              from flagged f where f.shut) s
     group by code, grp
  ),
  best as (
    select distinct on (code) code, from_day, len from runs order by code, len desc, from_day
  ),
  summary as (
    select f.code, max(f.issued_at) as issued_at, count(*) as n,
           bool_and(f.llw_p50 is not null and f.low >= f.llw_p50) as all_over_median,
           max(f.llw_p90) as p90
      from flagged f group by f.code
  )
  select m.code,
         case
           when s.code is null or s.p90 is null or s.issued_at < now() - interval '12 hours' then 'unknown'
           when coalesce(b.len, 0) >= 2 then 'shut'
           when coalesce(b.len, 0) > 0 or s.all_over_median then 'narrowing'
           else 'open'
         end as state,
         case when coalesce(b.len, 0) >= 1 then (b.from_day::timestamp at time zone 'Asia/Bangkok') end as shut_from,
         coalesce(b.len, 0)::integer as shut_days,
         s.issued_at
    from mouth m
    left join summary s on s.code = m.code
    left join best b on b.code = m.code
$$;
revoke all on function public.gauge_sea_gate() from public;
grant execute on function public.gauge_sea_gate() to anon, authenticated;
