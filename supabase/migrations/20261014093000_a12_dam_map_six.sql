-- The map answer carries what tells one reservoir from another (the owner, 14 Oct 2026).
--
-- Two new fields and one new order. `feed` says whether the figures come once an hour or once a
-- day, which is the difference between "released 0 m3/s" meaning this hour and meaning yesterday;
-- `figure_provinces` is whose home screen the dam's card reaches, which used to be one list in
-- the app's code and is now the dam's own. The biggest reservoir comes first, so a screen that
-- shows one dam shows the one that can do the most.
drop function if exists public.dam_map(text);
create function public.dam_map(p_source text default null)
returns table (
  code text, name jsonb, river jsonb, operator text, feed text, figure_provinces text[],
  point json, spillway_point json, outlet_point json, reservoir json,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_source text, geometry_note jsonb, reaches json, tambons integer, tambons_main integer
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator, d.feed, d.figure_provinces,
         extensions.st_asgeojson(d.point)::json,
         extensions.st_asgeojson(d.spillway_point)::json,
         extensions.st_asgeojson(d.outlet_point)::json,
         extensions.st_asgeojson(
           extensions.st_simplifypreservetopology(d.reservoir, 0.00045))::json,
         d.storage_max_mcm, d.storage_normal_mcm, d.geometry_source, d.geometry_note,
         (select coalesce(json_agg(json_build_object(
                   'kind', r.kind, 'seq', r.seq, 'name', r.name,
                   'kmFromDam', r.km_from_dam, 'lengthKm', r.length_km,
                   'line', extensions.st_asgeojson(
                             extensions.st_simplify(r.line, 0.00045))::json)
                 order by r.kind, r.seq), '[]'::json)
            from public.dam_reaches r
           where r.dam_code = d.code and r.source = d.geometry_source),
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = d.geometry_source),
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = d.geometry_source and t.via = 'main')
    from public.dams d
   where p_source is null or d.geometry_source = p_source
   order by d.storage_max_mcm desc nulls last, d.code
$$;
grant execute on function public.dam_map(text) to anon, authenticated;
