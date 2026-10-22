-- A report hexagon on the public map appears only once at least two different people have a
-- standing report in it (owner's answer to the A10 security review, 22 Oct 2026). In the
-- countryside a hexagon holding one person's report nearly points at one house (safety rule 6).
-- Several reports from one person still count as one person. A report whose account was deleted
-- has no reporter and so counts towards no one. The per-tambon list is unchanged: a tambon is
-- far too large to point at a house.

insert into public.system_settings (key, value, note) values
  ('report_hex', '{"min_people": 2}'::jsonb,
   'A hexagon of flood reports is shown on the public map only once min_people different people have a standing report in it.')
on conflict (key) do nothing;

create or replace function public.report_hex_bins(p_hours integer default 72)
returns table (hex jsonb, reports integer, deepest public.depth_ref, latest timestamptz)
language sql stable security definer set search_path = '' as $$
  with r as (
    select extensions.st_transform(s.point, 32647) as p, s.reporter_id, s.depth_ref, s.created_at
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
  having count(distinct r.reporter_id)
         >= greatest(public.setting_int('report_hex', 'min_people', 2), 2)
  order by count(*) desc
  limit 2000
$$;
