-- A1 (5/8): SOS (spec 4.6, 5, 8). Safety rule 1: an SOS is never rejected or delayed.
-- Rows are created only by the submit function in A5 (it merges repeats while a case is open and
-- flags suspected spam, but always delivers). There is deliberately no direct insert policy.

create table public.sos_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles (user_id) on delete set null,
  device_id text check (char_length(device_id) <= 100),
  hazard_type public.hazard_type not null default 'unknown',
  point extensions.geometry(Point, 4326) not null,
  location_accuracy_m real,
  -- set when GPS failed and the requester placed a pin or typed a place
  location_text text check (char_length(location_text) <= 300),
  tambon text references public.tambons (code),
  people_count smallint check (people_count between 1 and 500),
  -- e.g. {"elderly": true, "bedridden": false, "infant_child": true, "needs_oxygen": true}
  vulnerable_flags jsonb not null default '{}'::jsonb,
  depth_ref public.depth_ref,
  injuries text check (char_length(injuries) <= 500),
  voice_url text,
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  text text check (char_length(text) <= 1000),
  battery_pct smallint check (battery_pct between 0 and 100),
  status public.sos_status not null default 'received',
  priority_score real not null default 0,
  -- set by flag_possible_duplicate(); admins decide and merge (never auto-dropped)
  possible_duplicate_of uuid references public.sos_requests (id),
  -- set when an admin merges this case into another
  duplicate_of uuid references public.sos_requests (id),
  created_at timestamptz not null default now(),
  last_location_at timestamptz not null default now(),
  closed_at timestamptz
);
create index sos_requests_point_idx on public.sos_requests using gist (point);
create index sos_requests_tambon_status_idx on public.sos_requests (tambon, status);
create index sos_requests_open_idx on public.sos_requests (created_at desc)
  where status in ('received', 'assigned', 'en_route');
create index sos_requests_requester_idx on public.sos_requests (requester_id);
create index sos_requests_device_idx on public.sos_requests (device_id);

-- The requester's phone (optional). Only the requester reads it directly; authorities and admins
-- use reveal_sos_phone(), which checks coverage and logs every reveal.
create table public.sos_contacts (
  sos_id uuid primary key references public.sos_requests (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+?[0-9]{8,15}$')
);
create index sos_contacts_phone_idx on public.sos_contacts (contact_phone);

-- Spam review, kept apart from sos_requests because the requester must not see the flag
-- (spec 9: "SOS suspected-spam flag: user none"). A flagged SOS is still delivered.
create table public.sos_review (
  sos_id uuid primary key references public.sos_requests (id) on delete cascade,
  suspected_spam boolean not null default false,
  spam_reason text,
  spam_dismissed_by uuid references public.profiles (user_id) on delete set null,
  spam_dismissed_at timestamptz
);

create table public.sos_locations (
  id bigint generated always as identity primary key,
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  point extensions.geometry(Point, 4326) not null,
  accuracy_m real,
  recorded_at timestamptz not null default now()
);
create index sos_locations_sos_idx on public.sos_locations (sos_id, recorded_at desc);

create table public.sos_claims (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  unit_id uuid not null references public.authority_units (id),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text
);
-- One active claim per SOS.
create unique index sos_claims_one_active_idx on public.sos_claims (sos_id) where released_at is null;
create index sos_claims_unit_idx on public.sos_claims (unit_id);

create table public.sos_events (
  id bigint generated always as identity primary key,
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  event text not null, -- e.g. 'received', 'merged_update', 'claimed', 'en_route', 'rescued'
  actor_id uuid references public.profiles (user_id) on delete set null,
  unit_id uuid references public.authority_units (id),
  note text check (char_length(note) <= 1000),
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index sos_events_sos_idx on public.sos_events (sos_id, created_at);

create table public.rescue_confirmations (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  method public.rescue_confirmation_method not null,
  confirmed_by uuid references public.profiles (user_id) on delete set null,
  photos text[] not null default '{}',
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index rescue_confirmations_sos_idx on public.rescue_confirmations (sos_id);

-- Ledger: points are added and revoked, never edited (spec 5.5).
create table public.hero_points (
  id bigint generated always as identity primary key,
  unit_id uuid not null references public.authority_units (id),
  sos_id uuid references public.sos_requests (id) on delete set null,
  points integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index hero_points_unit_idx on public.hero_points (unit_id);
