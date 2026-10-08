-- A3: what the public home screen and map read (spec 4.1-4.3, safety rules 3, 6 and 10).
-- Everything here is safe for a visitor: alert status per tambon, public safe places, gauge
-- status, and flood reports only as counts per hexagon. No exact report or SOS location, no
-- reporter and no issuer identity leaves these functions.

-------------------------------------------------------------------------------
-- Alerts in force: not superseded, not cancelled. Newest first, so for a tambon in two alerts
-- the caller takes the first one it meets (the latest word from the admins).
-- The issuer's identity stays out: the public line says "Jaga admin" (decision 2026-09-29).
-------------------------------------------------------------------------------
create function public.public_alert_status()
returns table (
  alert_id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz,
  onset_from timestamptz, onset_to timestamptz, return_from timestamptz, return_to timestamptz,
  source text, tambons text[]
)
language sql stable set search_path = '' as $$
  select a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at, a.next_update_at,
         lower(a.expected_onset_window), upper(a.expected_onset_window),
         lower(a.expected_return_window), upper(a.expected_return_window),
         a.signals_snapshot ->> 'source',
         coalesce((select array_agg(at.tambon order by at.tambon)
                   from public.alert_tambons at where at.alert_id = a.id), '{}')
  from public.alerts a
  where a.superseded_by is null and a.cancelled_at is null
  order by a.issued_at desc
$$;

-------------------------------------------------------------------------------
-- Areas by name, for choosing a tambon from a list. The point is a place inside the tambon,
-- used to rank safe places for someone who chose an area without sharing a location.
-------------------------------------------------------------------------------
create function public.tambon_directory()
returns table (
  code text, name_th text, name_en text,
  district_code text, district_th text, district_en text, province_code text,
  lat double precision, lon double precision
)
language sql stable set search_path = '' as $$
  select t.code, t.name_th, t.name_en, d.code, d.name_th, d.name_en, t.province_code,
         round(extensions.st_y(p.pt)::numeric, 5)::double precision,
         round(extensions.st_x(p.pt)::numeric, 5)::double precision
  from public.tambons t
  join public.districts d on d.code = t.district_code
  cross join lateral (select extensions.st_pointonsurface(t.geom_web) as pt) p
  order by t.code
$$;

-- Where a point is: its tambon in a covered province, or else only the province, so the app can
-- say "Jaga doesn't cover this province yet" instead of showing a status (safety rule 10).
-- Nothing is stored.
create function public.locate_area(p_lat double precision, p_lon double precision)
returns table (
  tambon_code text, tambon_th text, tambon_en text, district_th text, district_en text,
  province_code text, province_th text, province_en text, province_status public.province_status
)
language sql stable set search_path = '' as $$
  with pt as (select extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326) as g),
  hit as (
    select t.code, t.name_th, t.name_en, t.district_code, t.province_code
    from public.tambons t, pt
    where extensions.st_intersects(t.geom, pt.g)
    order by t.code limit 1
  ),
  prov as (
    select pr.code from public.provinces pr, pt
    where extensions.st_intersects(pr.geom, pt.g)
    order by pr.code limit 1
  )
  select h.code, h.name_th, h.name_en, d.name_th, d.name_en,
         pr.code, pr.name_th, pr.name_en, pr.status
  from public.provinces pr
  left join hit h on h.province_code = pr.code
  left join public.districts d on d.code = h.district_code
  where pr.code = coalesce((select province_code from hit), (select code from prov))
$$;

-------------------------------------------------------------------------------
-- Safe places: the ranking can now be asked for shelters only or for car parking only
-- (spec 4.3 lists high-ground parking separately). Same weights as before.
-------------------------------------------------------------------------------
drop function public.rank_safe_places(extensions.geometry, integer, public.hazard_type);
create function public.rank_safe_places(
  p_point extensions.geometry,
  p_limit integer default 3,
  p_hazard public.hazard_type default 'flood',
  -- null: every kind; true: only high ground for parking cars; false: only places for people
  p_parking boolean default null
) returns table (
  id uuid, name jsonb, type public.safe_place_type, status public.safe_place_status,
  distance_m double precision, score real, rank_score double precision
)
language sql stable set search_path = '' as $$
  with candidates as (
    select sp.id, sp.name, sp.type, sp.status, sp.score,
           extensions.st_distance(sp.point::extensions.geography,
                                  extensions.st_setsrid(p_point, 4326)::extensions.geography) as distance_m
    from public.safe_places sp
    where sp.status <> 'closed'
      and sp.verification_status <> 'rejected'
      and p_hazard = any (sp.suitable_for)
      and (p_parking is null or (sp.type = 'high_ground_parking') = p_parking)
      and extensions.st_dwithin(sp.point::extensions.geography,
                                extensions.st_setsrid(p_point, 4326)::extensions.geography, 50000)
  )
  select c.id, c.name, c.type, c.status, c.distance_m, c.score,
         0.5 * coalesce(c.score, 0) + 0.5 * greatest(0, 1 - c.distance_m / 20000.0) as rank_score
  from candidates c
  order by rank_score desc, c.distance_m
  limit greatest(1, least(p_limit, 20))
$$;

-- The ranked places with what a card shows (spec 4.3).
create function public.safe_places_near(
  p_lat double precision,
  p_lon double precision,
  p_limit integer default 3,
  p_parking boolean default false,
  p_hazard public.hazard_type default 'flood'
) returns table (
  id uuid, name jsonb, type public.safe_place_type, status public.safe_place_status,
  verification_status public.verification_status, distance_m double precision,
  lat double precision, lon double precision, freeboard_m real,
  flooded_2024 boolean, flooded_2025 boolean, capacity integer, facilities jsonb, needs text,
  updated_at timestamptz
)
language sql stable set search_path = '' as $$
  select sp.id, sp.name, sp.type, sp.status, sp.verification_status, r.distance_m,
         extensions.st_y(sp.point), extensions.st_x(sp.point), sp.freeboard_m,
         sp.flooded_2024, sp.flooded_2025, sp.capacity, sp.facilities, sp.needs, sp.updated_at
  from public.rank_safe_places(extensions.st_makepoint(p_lon, p_lat), p_limit, p_hazard, p_parking) r
  join public.safe_places sp on sp.id = r.id
  order by r.rank_score desc, r.distance_m
$$;

-------------------------------------------------------------------------------
-- Flood reports for the public map: counts per hexagon only (safety rule 6).
-- Approved reports of the last p_hours, on a fixed grid of hexagons with 600 m sides (about
-- 1 km2) in UTM 47N, so a hexagon never moves with the data. The time is cut to the hour.
-- Security definer: visitors cannot read the reports table itself.
-------------------------------------------------------------------------------
create function public.report_hex_bins(p_hours integer default 72)
returns table (hex jsonb, reports integer, deepest public.depth_ref, latest timestamptz)
language sql stable security definer set search_path = '' as $$
  with r as (
    select extensions.st_transform(rp.point, 32647) as p, rp.depth_ref, rp.created_at
    from public.reports rp
    where rp.moderation_status = 'approved'
      and rp.hazard_type = 'flood'
      and rp.created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
  ),
  bounds as (
    select extensions.st_setsrid(extensions.st_extent(r.p)::extensions.geometry, 32647) as b
    from r having count(*) > 0
  )
  select extensions.st_asgeojson(extensions.st_transform(h.geom, 4326), 5)::jsonb,
         count(*)::integer, max(r.depth_ref), date_trunc('hour', max(r.created_at))
  from bounds
  cross join lateral extensions.st_hexagongrid(600, bounds.b) h
  join r on extensions.st_intersects(h.geom, r.p)
  group by h.geom
  order by count(*) desc
  limit 2000
$$;
revoke execute on function public.report_hex_bins(integer) from public;
grant execute on function public.report_hex_bins(integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- River gauges: the last water level and how it compares with the station's levels.
-- A station without levels, or without a reading in the last 6 hours, is never "normal".
-------------------------------------------------------------------------------
create function public.station_status()
returns table (
  id uuid, name jsonb, basin text, lat double precision, lon double precision,
  value double precision, observed_at timestamptz, status text
)
language sql stable set search_path = '' as $$
  select s.id, s.name, s.basin, extensions.st_y(s.point), extensions.st_x(s.point), o.value, o.ts,
         case
           when o.ts is null or o.ts < now() - interval '6 hours' then 'no_recent_data'
           when s.warning_m is not null and o.value >= s.warning_m then 'above_warning'
           when s.watch_m is not null and o.value >= s.watch_m then 'above_watch'
           when s.watch_m is null and s.warning_m is null then 'no_levels'
           else 'normal'
         end
  from public.stations s
  left join lateral (
    select ob.value, ob.ts from public.observations ob
    where ob.station_id = s.id and ob.variable = 'water_level_msl' and ob.value is not null
    order by ob.ts desc limit 1
  ) o on true
  order by s.code
$$;
