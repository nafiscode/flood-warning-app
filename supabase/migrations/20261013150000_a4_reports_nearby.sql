-- Flood reports that the neighbours can see, and that stand until somebody says the water has
-- gone (the owner, 13 Oct 2026).
--
-- Until now a report counted on the public map only once an admin had approved it, and nothing
-- told the people living beside it. From here:
--   * a report counts **at once**, marked as a resident's report that nobody has checked. An admin
--     can still hide one (moderation_status = 'hidden'), and a hidden report counts nowhere;
--   * it **stands** until its own reporter says the water has gone, or until enough other people
--     in the same tambon report dry ground after it, and never longer than the standing time;
--   * everyone gets the same answer: one row per tambon, with counts only. No point, no reporter,
--     no photo, no text (safety rule 6). The exact place stays a hexagon on the map.
--
-- It is never an alert: no level, no alert colour, and the app says who is speaking (safety
-- rule 2). "Confirmed" here means only that several different residents have said the same thing.

insert into public.system_settings (key, value, note) values
  ('flood_reports',
   '{"stand_hours": 72, "confirm_people": 3, "clear_people": 2}'::jsonb,
   'A flood report stands for stand_hours unless ended. A tambon is "confirmed by residents" once confirm_people different people have a standing report there. A report by someone else is ended once clear_people different other people report dry ground in the same tambon after it.')
on conflict (key) do nothing;

alter table public.reports
  -- Set when the reporter says the water has gone or is low enough to travel. Never by an admin:
  -- hiding a report is moderation, and is a different thing.
  add column ended_at timestamptz;

-------------------------------------------------------------------------------
-- The reports that stand right now. Internal: it carries points and reporters.
-------------------------------------------------------------------------------
create function public.standing_flood_reports()
returns table (
  id uuid, reporter_id uuid, tambon text, point extensions.geometry(Point, 4326),
  depth_ref public.depth_ref, trend public.water_trend, road_access public.road_access,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.reporter_id, r.tambon, r.point, r.depth_ref, r.trend, r.road_access, r.created_at
  from public.reports r
  where r.hazard_type = 'flood'
    and r.moderation_status <> 'hidden'
    and r.depth_ref is distinct from 'dry'
    and r.ended_at is null
    and r.created_at > now() - make_interval(
          hours => public.setting_int('flood_reports', 'stand_hours', 72))
    -- The reporter's own later "dry" report ends it...
    and not exists (
      select 1 from public.reports d
      where d.reporter_id = r.reporter_id and d.hazard_type = 'flood'
        and d.depth_ref = 'dry' and d.moderation_status <> 'hidden'
        and d.tambon = r.tambon and d.created_at > r.created_at)
    -- ...and so do enough other people reporting dry ground in the same tambon after it. One
    -- person alone cannot take a neighbour's warning down.
    and (select count(distinct d.reporter_id) from public.reports d
         where d.hazard_type = 'flood' and d.depth_ref = 'dry'
           and d.moderation_status <> 'hidden'
           and d.tambon = r.tambon and d.created_at > r.created_at
           and d.reporter_id is distinct from r.reporter_id)
        < public.setting_int('flood_reports', 'clear_people', 2)
$$;
revoke execute on function public.standing_flood_reports() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- For everyone: the tambons with a standing report, counts only.
-- The time is cut to the hour, as on the hexagons.
-------------------------------------------------------------------------------
create function public.flood_reports_by_tambon()
returns table (
  tambon text, name_th text, name_en text, district text, district_th text, district_en text,
  lat double precision, lon double precision,
  reports integer, people integer, deepest public.depth_ref, worst_road public.road_access,
  latest_trend public.water_trend, first_at timestamptz, latest_at timestamptz, confirmed boolean
)
language sql stable security definer set search_path = '' as $$
  select t.code, t.name_th, t.name_en, t.district_code, d.name_th, d.name_en,
         extensions.st_y(extensions.st_pointonsurface(t.geom_web)),
         extensions.st_x(extensions.st_pointonsurface(t.geom_web)),
         count(*)::integer,
         count(distinct s.reporter_id)::integer,
         max(s.depth_ref),
         max(s.road_access),
         (array_agg(s.trend order by s.created_at desc) filter (where s.trend is not null))[1],
         date_trunc('hour', min(s.created_at)),
         date_trunc('hour', max(s.created_at)),
         count(distinct s.reporter_id)
           >= public.setting_int('flood_reports', 'confirm_people', 3)
  from public.standing_flood_reports() s
  join public.tambons t on t.code = s.tambon
  join public.districts d on d.code = t.district_code
  group by t.code, d.code
  order by max(s.created_at) desc
$$;
revoke execute on function public.flood_reports_by_tambon() from public;
grant execute on function public.flood_reports_by_tambon() to anon, authenticated;

-------------------------------------------------------------------------------
-- The hexagons on the public map now count the standing reports, not the approved ones.
-------------------------------------------------------------------------------
create or replace function public.report_hex_bins(p_hours integer default 72)
returns table (hex jsonb, reports integer, deepest public.depth_ref, latest timestamptz)
language sql stable security definer set search_path = '' as $$
  with r as (
    select extensions.st_transform(s.point, 32647) as p, s.depth_ref, s.created_at
    from public.standing_flood_reports() s
    where s.created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
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

-------------------------------------------------------------------------------
-- The reporter's own reports, and whether each still stands.
-------------------------------------------------------------------------------
create function public.my_flood_reports()
returns table (
  id uuid, tambon text, name_th text, name_en text, depth_ref public.depth_ref,
  created_at timestamptz, state text
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.tambon, t.name_th, t.name_en, r.depth_ref, r.created_at,
         case
           when r.moderation_status = 'hidden' then 'hidden'
           when r.ended_at is not null then 'ended'
           when exists (select 1 from public.standing_flood_reports() s where s.id = r.id)
             then 'standing'
           when r.created_at <= now() - make_interval(
                  hours => public.setting_int('flood_reports', 'stand_hours', 72)) then 'expired'
           else 'cleared'
         end
  from public.reports r
  left join public.tambons t on t.code = r.tambon
  where r.reporter_id = (select auth.uid())
    and r.hazard_type = 'flood'
    and r.depth_ref is distinct from 'dry'
    and r.created_at > now() - interval '7 days'
  order by r.created_at desc
  limit 20
$$;
revoke execute on function public.my_flood_reports() from public, anon;
grant execute on function public.my_flood_reports() to authenticated;

-- "The water has gone, or is low enough to travel": the reporter ends their own report.
create function public.end_my_flood_report(p_report uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  n integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  update public.reports set ended_at = now()
   where id = p_report and reporter_id = uid and ended_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.end_my_flood_report(uuid) from public, anon;
grant execute on function public.end_my_flood_report(uuid) to authenticated;
