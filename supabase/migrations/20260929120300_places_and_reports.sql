-- A1 (4/8): safe places and reports (spec 4.3, 4.5, 8).

create table public.safe_places (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null, -- {"th": "...", "en": "..."}
  type public.safe_place_type not null,
  point extensions.geometry(Point, 4326) not null,
  tambon text references public.tambons (code),
  elevation_m real,
  -- elevation margin above the highest recent flood
  freeboard_m real,
  flood_freq real,
  flooded_2024 boolean,
  flooded_2025 boolean,
  -- 0–1, from the science pipeline (science-plan Module 2)
  score real check (score between 0 and 1),
  score_components jsonb not null default '{}'::jsonb,
  capacity integer check (capacity >= 0),
  facilities jsonb not null default '{}'::jsonb,
  parking boolean not null default false,
  verification_status public.verification_status not null default 'unverified',
  verified_by uuid references public.profiles (user_id) on delete set null,
  status public.safe_place_status not null default 'unknown',
  needs text check (char_length(needs) <= 500),
  -- A flood shelter on high ground may be unsafe in an earthquake or fire (spec 8).
  suitable_for public.hazard_type[] not null default '{flood}',
  updated_at timestamptz not null default now()
);
create index safe_places_point_idx on public.safe_places using gist (point);
create index safe_places_tambon_idx on public.safe_places (tambon);
create index safe_places_status_idx on public.safe_places (status, verification_status);

-- Exact location and reporter: the reporter, verified authorities in coverage, and admins.
-- The public sees only hex-bin counts and moderated photos, through functions added in A3/A4.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (user_id) on delete set null,
  hazard_type public.hazard_type not null default 'flood',
  point extensions.geometry(Point, 4326) not null,
  tambon text references public.tambons (code),
  depth_ref public.depth_ref,
  trend public.water_trend,
  road_access public.road_access,
  details jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  voice_url text,
  text text check (char_length(text) <= 1000),
  moderation_status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index reports_point_idx on public.reports using gist (point);
create index reports_tambon_time_idx on public.reports (tambon, created_at desc);
create index reports_moderation_idx on public.reports (moderation_status) where moderation_status = 'pending';
