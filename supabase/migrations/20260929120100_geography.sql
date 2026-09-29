-- A1 (2/8): admin areas and warning zones. EPSG:4326; distances use geography (CLAUDE.md).
-- Codes are official DOPA codes: province 2 digits, district 4, tambon 6.
-- Boundaries: Royal Thai Survey Department via OCHA HDX COD-AB (CC BY-IGO), simplified by
-- pipeline/admin_boundaries; loaded from supabase/seed/.

create type public.province_status as enum ('active', 'coming_soon');

create table public.provinces (
  code text primary key check (code ~ '^[0-9]{2}$'),
  name_th text not null,
  name_en text not null,
  status public.province_status not null default 'coming_soon',
  geom extensions.geometry(MultiPolygon, 4326) not null,
  geom_web extensions.geometry(MultiPolygon, 4326) not null
);

create table public.districts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  province_code text not null references public.provinces (code),
  name_th text not null,
  name_en text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  geom_web extensions.geometry(MultiPolygon, 4326) not null,
  check (left(code, 2) = province_code)
);

create table public.tambons (
  code text primary key check (code ~ '^[0-9]{6}$'),
  district_code text not null references public.districts (code),
  province_code text not null references public.provinces (code),
  name_th text not null,
  name_en text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  geom_web extensions.geometry(MultiPolygon, 4326) not null,
  check (left(code, 4) = district_code and left(code, 2) = province_code)
);

create index provinces_geom_idx on public.provinces using gist (geom);
create index districts_geom_idx on public.districts using gist (geom);
create index districts_province_idx on public.districts (province_code);
create index tambons_geom_idx on public.tambons using gist (geom);
create index tambons_district_idx on public.tambons (district_code);
create index tambons_province_idx on public.tambons (province_code);

create table public.warning_zones (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null,
  basin text not null,
  hazard_type public.hazard_type not null default 'flood',
  geom extensions.geometry(MultiPolygon, 4326)
);
create index warning_zones_geom_idx on public.warning_zones using gist (geom);

create table public.warning_zone_tambons (
  zone_id uuid not null references public.warning_zones (id) on delete cascade,
  tambon_code text not null references public.tambons (code),
  primary key (zone_id, tambon_code)
);
