-- S7: the dam's downstream zone as an area, and the app following whichever geometry a dam has.
--
-- Until now the release path was OpenStreetMap's river line plus the lowest 5 km of the side
-- streams, and the functions the app reads assumed that source ('osm') by default. On 14 Oct 2026
-- the owner chose the zone built from the elevation model, with its outer band
-- (docs/decisions.md; pipeline/dam_release/METHODS.md, "The zone"). The seed
-- supabase/seed/42_dam_zone.sql loads it under source 's7' and points the dam at it.
--
--   * `dam_zones` holds the two outlines: 'zone' (land the river has been high enough to reach)
--     and 'outer' (one metre above anything recorded). They are not flood extents and not a
--     forecast; the note beside them says what they rest on (safety rule 8).
--   * Under 's7' the river keeps its mapped line, the side-stream lines are gone, and in
--     `dam_tambons` / `dam_arrivals` the kind `tributary` means "the river does not run through
--     this tambon, but it has low land the river's water can reach". The enum's name is older
--     than the zone; the screens' wording covers both.
--   * `dam_map`, `dam_state` and `dam_tambon_on_path` now follow each dam's own
--     `geometry_source` when no source is asked for.

create table public.dam_zones (
  dam_code text not null references public.dams (code) on delete cascade,
  source text not null,
  band text not null check (band in ('zone', 'outer')),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  -- What the outline rests on, for the screen that draws it.
  method jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (dam_code, source, band)
);
create index dam_zones_geom_idx on public.dam_zones using gist (geom);

alter table public.dam_zones enable row level security;
create policy "dam_zones: everyone reads" on public.dam_zones for select
  to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.dam_zones from anon, authenticated;

-- The outlines for the map, simplified to about 50 m like the river's own line.
create function public.dam_zone_map(p_dam text default null)
returns table (dam_code text, source text, band text, geom json, method jsonb)
language sql stable security definer set search_path = '' as $$
  select z.dam_code, z.source, z.band,
         extensions.st_asgeojson(extensions.st_simplifypreservetopology(z.geom, 0.00045), 5)::json,
         z.method
    from public.dam_zones z
    join public.dams d on d.code = z.dam_code and d.geometry_source = z.source
   where p_dam is null or z.dam_code = p_dam
   order by z.dam_code, case z.band when 'outer' then 0 else 1 end
$$;
grant execute on function public.dam_zone_map(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The three reads that took 'osm' for granted. Same signatures and columns; with no source
-- given they now answer for the geometry each dam actually has.
-------------------------------------------------------------------------------
create or replace function public.dam_map(p_source text default null)
returns table (
  code text, name jsonb, river jsonb, operator text,
  point json, spillway_point json, outlet_point json, reservoir json,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_source text, geometry_note jsonb,
  reaches json, tambons integer, tambons_main integer
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator,
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
$$;

create or replace function public.dam_state(p_source text default null)
returns table (
  code text, name jsonb, river jsonb, operator text,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_note jsonb, signal json, daily json, days json
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator, d.storage_max_mcm, d.storage_normal_mcm,
         d.geometry_note,
         (select row_to_json(s) from public.dam_signal(d.code) s),
         (select row_to_json(x) from public.dam_daily(d.code) x),
         (select coalesce(json_agg(h), '[]'::json) from public.dam_days(d.code) h)
    from public.dams d
   where p_source is null or d.geometry_source = p_source
$$;

create or replace function public.dam_tambon_on_path(p_tambon text, p_source text default null)
returns table (dam_code text, via public.dam_reach_kind, km_from_dam double precision)
language sql stable security definer set search_path = '' as $$
  select t.dam_code, t.via, t.km_from_dam
    from public.dam_tambons t
    join public.dams d on d.code = t.dam_code
   where t.tambon_code = p_tambon and t.source = coalesce(p_source, d.geometry_source)
   order by t.km_from_dam
$$;
