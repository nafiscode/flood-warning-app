-- A12 part 1 (1/2): Bang Lang dam on the map - the dam, the reservoir, and the path released
-- water takes (spec section 15, docs/science-plan.md Module 7, the owner's request of 10 Oct).
--
-- Everything here is public and carries no personal data: it is the shape of a river and a
-- reservoir, plus figures the dam's operator already publishes. So it is readable by anon, like
-- the rest of the public map (spec 4.2). Nothing in this file touches safety rule 5's data.
--
-- Two things are deliberate:
--
--   * Every reach carries a `source`. The lines loaded today are OpenStreetMap's, decided on
--     10 Oct 2026 as the interim source; S7 steps 2-3 will produce a zone from HAND and the
--     radar extents, and the owner asked to see both side by side before one replaces the other.
--     So `source` is part of the key and two versions can sit here at once.
--
--   * There is no arrival time anywhere. Travel times are S7 step 2 and have not been measured.
--     A column for a time we cannot compute would get filled with a guess, so there is none.

create type public.dam_reach_kind as enum ('outlet', 'main', 'tributary');

-------------------------------------------------------------------------------
-- The dam itself. Loaded from supabase/seed/40_dams.sql, written by pipeline/dam_release.
-------------------------------------------------------------------------------
create table public.dams (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  -- Our own names, in th/ms/en. Not OpenStreetMap's: its name:en for this reservoir is wrong.
  name jsonb not null,
  river jsonb not null,
  operator text not null,
  province_code text references public.provinces (code),
  -- ThaiWater lists the same dam twice: the operator's hourly feed and the RID's daily report.
  thaiwater_hourly_id integer,
  thaiwater_daily_id integer,
  point extensions.geometry(Point, 4326) not null,
  spillway_point extensions.geometry(Point, 4326),
  -- Head of the mapped outlet channel, which is roughly the powerhouse tailwater. Approximate
  -- and still to be confirmed: it is not a surveyed position.
  outlet_point extensions.geometry(Point, 4326),
  reservoir extensions.geometry(MultiPolygon, 4326),
  storage_max_mcm double precision,
  storage_normal_mcm double precision,
  geometry_source text not null default 'osm',
  -- The limits to show wherever this is drawn (safety rule 8): where the geometry came from,
  -- what it does and does not say, how many tributaries are mapped.
  geometry_note jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index dams_point_idx on public.dams using gist (point);
create index dams_reservoir_idx on public.dams using gist (reservoir);

-------------------------------------------------------------------------------
-- The path. One row per reach: the channel leaving the dam, the river itself, and the lower
-- reach of each stream that joins it (spec 15: a rising main stem backs water into them).
-------------------------------------------------------------------------------
create table public.dam_reaches (
  id uuid primary key default gen_random_uuid(),
  dam_code text not null references public.dams (code) on delete cascade,
  kind public.dam_reach_kind not null,
  source text not null default 'osm',
  seq integer not null,
  name jsonb not null default '{}'::jsonb,
  -- Where this reach meets the river, measured down the river from the dam.
  km_from_dam double precision,
  length_km double precision,
  line extensions.geometry(LineString, 4326) not null,
  unique (dam_code, source, kind, seq)
);
create index dam_reaches_line_idx on public.dam_reaches using gist (line);
create index dam_reaches_dam_idx on public.dam_reaches (dam_code, source);

-------------------------------------------------------------------------------
-- Which tambons the river runs through, worked out from the reaches rather than listed by hand,
-- so it cannot drift from the lines actually drawn.
--
-- This is a *geometric* list: the tambons the water passes through. It is not a flood zone and
-- it is not an estimate of who gets wet. Until S7 steps 2-3 that distinction is the whole point,
-- and `via` keeps it honest by saying whether the river itself or only a tributary touches it.
-------------------------------------------------------------------------------
create table public.dam_tambons (
  dam_code text not null references public.dams (code) on delete cascade,
  source text not null,
  tambon_code text not null references public.tambons (code),
  -- 'main' where the river itself runs through, 'tributary' where only a lower reach does.
  via public.dam_reach_kind not null,
  -- How far down the river the nearest touched point is. Distance, never a time.
  km_from_dam double precision,
  primary key (dam_code, source, tambon_code)
);
create index dam_tambons_tambon_idx on public.dam_tambons (tambon_code);

-- Rebuild the tambon list for one dam and one source of geometry. Called at the end of the seed.
create function public.dam_tambons_rebuild(p_dam text, p_source text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  delete from public.dam_tambons where dam_code = p_dam and source = p_source;
  insert into public.dam_tambons (dam_code, source, tambon_code, via, km_from_dam)
  select p_dam, p_source, t.code,
         -- The river itself outranks a tributary: a tambon the main stem runs through is named
         -- for that, even when a tributary also clips it.
         case when bool_or(r.kind in ('main', 'outlet')) then 'main'::public.dam_reach_kind
              else 'tributary'::public.dam_reach_kind end,
         min(r.km_from_dam)
  from public.tambons t
  join public.dam_reaches r
    on r.dam_code = p_dam and r.source = p_source and extensions.st_intersects(t.geom, r.line)
  group by t.code;
  select count(*) into v_rows from public.dam_tambons
   where dam_code = p_dam and source = p_source;
  return v_rows;
end $$;
revoke execute on function public.dam_tambons_rebuild(text, text) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Row-level security. Public to read, nobody but the service role to write: the geometry comes
-- from the seed, so there is no client that should ever change it.
-------------------------------------------------------------------------------
alter table public.dams enable row level security;
alter table public.dam_reaches enable row level security;
alter table public.dam_tambons enable row level security;

create policy "dams: everyone reads" on public.dams for select to anon, authenticated using (true);
create policy "dam_reaches: everyone reads" on public.dam_reaches for select
  to anon, authenticated using (true);
create policy "dam_tambons: everyone reads" on public.dam_tambons for select
  to anon, authenticated using (true);

-------------------------------------------------------------------------------
-- What the map asks for: the dam, the reservoir and the lines, in one answer.
--
-- The geometry is simplified again here, to about 50 m, because the map draws it at province
-- zoom and the full detail is bytes down a 3G line for nothing (CLAUDE.md, mobile-first). The
-- stored lines keep their 10 m detail for anything that measures.
-------------------------------------------------------------------------------
create function public.dam_map(p_source text default 'osm')
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
           where r.dam_code = d.code and r.source = p_source),
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = p_source),
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = p_source and t.via = 'main')
    from public.dams d
   where d.geometry_source = p_source
$$;
grant execute on function public.dam_map(text) to anon, authenticated;

-- Is this tambon on the river below the dam? Used to decide whose screen the quiet notice
-- belongs on. A plain geometric question with a plain answer.
create function public.dam_tambon_on_path(p_tambon text, p_source text default 'osm')
returns table (dam_code text, via public.dam_reach_kind, km_from_dam double precision)
language sql stable security definer set search_path = '' as $$
  select t.dam_code, t.via, t.km_from_dam
    from public.dam_tambons t
   where t.tambon_code = p_tambon and t.source = p_source
   order by t.km_from_dam
$$;
grant execute on function public.dam_tambon_on_path(text, text) to anon, authenticated;
