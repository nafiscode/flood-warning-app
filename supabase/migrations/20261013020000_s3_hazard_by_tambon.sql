-- S3: how much of each tambon lies in each flood-hazard class, and how many of its buildings.
--
-- One row per tambon, written by the science pipeline (pipeline/hazard, `tambons`) and loaded from
-- supabase/seed/45_hazard_by_tambon.sql. The classes are the ones the map draws: from height above
-- the nearest stream and nine seasons of satellite radar, not checked against observed floods and
-- not a forecast. Building counts are estimates from Google Open Buildings on a 30 m grid.
--
-- The table says how much of a tambon is in each class. It never gives a tambon one class: a
-- tambon with 5 % of its land High can hold most of its houses there, which is why both are kept.
-- `medium_or_high_by_elevation_only_pct` says how much of the Medium and High land rests on
-- elevation alone, where the radar cannot see (towns, masked ground).

create table public.hazard_by_tambon (
  tambon_code text primary key references public.tambons (code),
  -- The radar run the classes were built from, so a later run can be told from this one.
  radar_run text not null,
  land_km2 real not null check (land_km2 >= 0),
  buildings integer not null check (buildings >= 0),
  high_km2 real not null,
  high_pct real,
  high_buildings integer not null,
  medium_km2 real not null,
  medium_pct real,
  medium_buildings integer not null,
  low_km2 real not null,
  low_pct real,
  low_buildings integer not null,
  minimal_km2 real not null,
  minimal_pct real,
  minimal_buildings integer not null,
  buildings_medium_or_high_pct real check (buildings_medium_or_high_pct between 0 and 100),
  medium_or_high_by_elevation_only_pct real
    check (medium_or_high_by_elevation_only_pct between 0 and 100),
  updated_at timestamptz not null default now()
);

-- Public to read, like the map layer it summarises. Nobody writes it from a client; the seed does.
alter table public.hazard_by_tambon enable row level security;
create policy "hazard_by_tambon: everyone reads" on public.hazard_by_tambon for select
  to anon, authenticated using (true);
-- New tables get write privileges back from the project's default privileges (see
-- 20261009234000_a12_dam_grants.sql), so take them away explicitly.
revoke insert, update, delete, truncate on public.hazard_by_tambon from anon, authenticated;
