-- A1 (6/8): alerts and notifications, monitoring data, admin tables (spec 6, 7, 8).
-- Safety rule 2: only humans publish alerts. Code may store signals and suggestions; an alert row
-- always has a human issuer. Safety rule 3: level, area, issuer, issue time, reason and next
-- update are all required.

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  hazard_type public.hazard_type not null default 'flood',
  level public.alert_level not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  -- built only from reviewed templates, per locale: {"th": "...", "ms": "..."}; th is required
  messages jsonb not null check (messages ? 'th'),
  issued_by uuid not null references public.profiles (user_id),
  issued_at timestamptz not null default now(),
  next_update_at timestamptz not null,
  -- always shown as ranges with an "estimate" label (safety rule 8)
  expected_onset_window tstzrange,
  expected_return_window tstzrange,
  superseded_by uuid references public.alerts (id),
  cancelled_at timestamptz,
  signals_snapshot jsonb not null default '{}'::jsonb,
  check (next_update_at > issued_at)
);
create index alerts_active_idx on public.alerts (issued_at desc)
  where superseded_by is null and cancelled_at is null;

create table public.alert_tambons (
  alert_id uuid not null references public.alerts (id) on delete cascade,
  tambon text not null references public.tambons (code),
  primary key (alert_id, tambon)
);
create index alert_tambons_tambon_idx on public.alert_tambons (tambon);

create table public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  channel public.delivery_channel not null,
  recipients integer not null default 0,
  line_messages_used integer not null default 0,
  status text not null default 'pending',
  sent_at timestamptz
);
create index alert_deliveries_alert_idx on public.alert_deliveries (alert_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.line_quota_usage (
  month date primary key check (extract(day from month) = 1),
  messages_used integer not null default 0,
  monthly_limit integer not null
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  source text not null, -- e.g. 'thaiwater'
  code text not null,
  name jsonb not null,
  point extensions.geometry(Point, 4326) not null,
  basin text,
  zone_id uuid references public.warning_zones (id),
  bankfull_m real,
  watch_m real,
  warning_m real,
  critical_m real,
  unique (source, code)
);
create index stations_point_idx on public.stations using gist (point);

create table public.observations (
  station_id uuid not null references public.stations (id) on delete cascade,
  ts timestamptz not null,
  variable text not null, -- 'water_level_msl', 'discharge', 'rain_1h', 'rain_daily'
  value double precision,
  primary key (station_id, variable, ts)
);
create index observations_ts_idx on public.observations (ts desc);

create table public.forecasts (
  id bigint generated always as identity primary key,
  source text not null, -- 'glofas', 'open_meteo', ...
  zone_id uuid references public.warning_zones (id),
  point extensions.geometry(Point, 4326),
  issued_at timestamptz not null,
  valid_at timestamptz not null,
  variable text not null,
  value double precision,
  member smallint,
  check (zone_id is not null or point is not null)
);
create index forecasts_zone_valid_idx on public.forecasts (zone_id, variable, valid_at);

-- Advisory thresholds per zone and signal; values per level, e.g. {"watch": 3.1, "warning": 3.8}
create table public.thresholds (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.warning_zones (id) on delete cascade,
  signal text not null,
  levels jsonb not null,
  provisional boolean not null default true,
  set_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (zone_id, signal)
);

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email_or_phone text not null,
  role public.user_role not null check (role in ('admin', 'super_admin')),
  invited_by uuid not null references public.profiles (user_id),
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Written only by security-definer functions; admins read it.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles (user_id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  ts timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index audit_log_ts_idx on public.audit_log (ts desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create table public.handover_notes (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles (user_id),
  note text not null check (char_length(note) between 1 and 4000),
  created_at timestamptz not null default now()
);
