-- S3: villages (muban) as points, and the buildings per flood-hazard class around each.
--
-- Written by the science pipeline (pipeline/hazard, `villages`). There is no open layer of village
-- outlines, so each village holds the part of its tambon nearer to it than to any other village
-- point of that tambon; building counts are estimates from Google Open Buildings on a 30 m grid,
-- and the classes are the map's, not checked against observed floods.
--
-- Two sources (decision 2026-10-16):
--   dopa2012  the 2012 national village layer. Its terms are unknown, so its rows are read only by
--             admins and verified authorities, and its seed lives in the private data repo
--             (pipeline/data/villages/villages_seed.sql), never in this public one. A row OpenStreetMap
--             also has, by name and place, is marked public and carries OpenStreetMap's names.
--   osm       OpenStreetMap villages and hamlets (ODbL), for the tambons the 2012 layer leaves empty.
--             Public.
-- Town centres have no muban (they are municipal communities), so about 22 tambons have no row.

create table public.villages (
  id text primary key,
  source text not null check (source in ('dopa2012', 'osm')),
  public boolean not null default false,
  tambon_code text not null references public.tambons (code),
  name_th text not null,
  name_en text,
  point extensions.geometry(Point, 4326) not null,
  radar_run text not null,
  land_km2 real not null check (land_km2 >= 0),
  buildings integer not null check (buildings >= 0),
  high_buildings integer not null,
  medium_buildings integer not null,
  low_buildings integer not null,
  minimal_buildings integer not null,
  buildings_medium_or_high_pct real check (buildings_medium_or_high_pct between 0 and 100),
  updated_at timestamptz not null default now()
);

create index villages_point_idx on public.villages using gist (point);
create index villages_tambon_idx on public.villages (tambon_code);

alter table public.villages enable row level security;
-- Everyone reads the public rows; teams and admins read them all.
create policy "villages: everyone reads public rows" on public.villages for select
  to anon, authenticated using (public);
create policy "villages: teams and admins read all" on public.villages for select
  to authenticated using ((select public.is_admin()) or (select public.is_verified_authority()));
-- New tables get write privileges back from the project's default privileges (see
-- 20261009234000_a12_dam_grants.sql), so take them away explicitly. Only the seed writes.
revoke insert, update, delete, truncate on public.villages from anon, authenticated;

-- The nearest village to each of a list of points, within 5 km, as the caller may see villages:
-- a visitor gets only public ones, a team or an admin any. Points come as [[lon, lat], ...];
-- at most 200 a call. Invoker rights on purpose: the policies above decide.
create function public.villages_near(p_points jsonb)
returns table (i integer, village_id text, name_th text, name_en text, tambon_code text, distance_m integer)
language sql stable security invoker set search_path = '' as $$
  with pts as (
    select (o - 1)::integer as i,
           extensions.st_setsrid(extensions.st_makepoint((e ->> 0)::float8, (e ->> 1)::float8), 4326) as g
    from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) with ordinality as a(e, o)
    where jsonb_typeof(e) = 'array' and o <= 200
  )
  select pts.i, v.id, v.name_th, v.name_en, v.tambon_code,
         round(extensions.st_distance(v.point::extensions.geography, pts.g::extensions.geography))::integer
  from pts
  cross join lateral (
    select * from public.villages v
    order by v.point operator(extensions.<->) pts.g
    limit 1
  ) v
  where extensions.st_dwithin(v.point::extensions.geography, pts.g::extensions.geography, 5000);
$$;
revoke all on function public.villages_near(jsonb) from public;
grant execute on function public.villages_near(jsonb) to anon, authenticated;
