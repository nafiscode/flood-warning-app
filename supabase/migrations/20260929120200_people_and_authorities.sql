-- A1 (3/8): profiles, saved places, households, organizations and authority units (spec 3, 8).
--
-- Privacy design (spec 9, safety rule 5): row-level security decides which rows a role can see;
-- it cannot hide single columns or log reads. So personal phone numbers and vulnerable-household
-- data live in tables that only their owner can read directly. Everyone else (authorities, admins)
-- reads them only through security-definer functions that check coverage and capability and write
-- an audit_log row (migration 8).

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'user',
  display_name text not null default '' check (char_length(display_name) <= 80),
  line_user_id text unique,
  preferred_locale text not null default 'th' check (preferred_locale in ('th', 'ms', 'en')),
  home_point extensions.geometry(Point, 4326),
  home_tambon text references public.tambons (code),
  -- PDPA: consent per purpose with its timestamp, e.g. {"location": "2026-10-01T...Z"}
  consents jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_home_tambon_idx on public.profiles (home_tambon);
create index profiles_role_idx on public.profiles (role) where role <> 'user';

-- Owner-only. Admins read a phone only through reveal_profile_phone() (logged).
create table public.profile_contacts (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  phone text check (phone ~ '^\+?[0-9]{8,15}$'),
  -- true when the phone came from OTP sign-in; false when typed after LINE Login
  phone_verified boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  point extensions.geometry(Point, 4326) not null,
  tambon text references public.tambons (code),
  created_at timestamptz not null default now()
);
create index saved_places_user_idx on public.saved_places (user_id);
create index saved_places_tambon_idx on public.saved_places (tambon);

-- Max 3 saved places per user (spec 3).
create function public.enforce_saved_place_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.saved_places where user_id = new.user_id) >= 3 then
    raise exception 'A user can save at most 3 places' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger saved_places_limit before insert on public.saved_places
  for each row execute function public.enforce_saved_place_limit();

-- Owner-only (read/write/delete). Authorities with rescue or coordination capability in the
-- tambon, and admins, read through households_in_tambon() (logged).
create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (user_id) on delete cascade,
  point extensions.geometry(Point, 4326) not null,
  tambon text references public.tambons (code),
  size smallint check (size between 1 and 50),
  -- counts by category, e.g. {"elderly": 1, "bedridden": 0, "infant_child": 2, ...}
  vulnerable jsonb not null default '{}'::jsonb,
  mobility_notes text check (char_length(mobility_notes) <= 500),
  contact_phone text check (contact_phone ~ '^\+?[0-9]{8,15}$'),
  consent_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index households_point_idx on public.households using gist (point);
create index households_tambon_idx on public.households (tambon);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  type public.org_type not null,
  -- Public only when the organization opts in (decision e).
  official_phone text check (official_phone ~ '^\+?[0-9]{3,15}$'),
  public_contact_opt_in boolean not null default false,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.authority_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  unit_name text not null check (char_length(unit_name) between 2 and 200),
  capabilities public.authority_capability[] not null default '{}',
  status public.authority_status not null default 'pending',
  verified_by uuid references public.profiles (user_id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index authority_units_user_idx on public.authority_units (user_id);
create index authority_units_status_idx on public.authority_units (status);

-- The point-of-contact's name and phone. Readable directly only by the unit's own user;
-- others use reveal_poc_phone() (shared coverage only, logged).
create table public.authority_unit_contacts (
  unit_id uuid primary key references public.authority_units (id) on delete cascade,
  poc_name text not null check (char_length(poc_name) between 2 and 120),
  poc_phone text not null check (poc_phone ~ '^\+?[0-9]{8,15}$'),
  poc_phone_verified boolean not null default false,
  -- decision o: when the SMS provider isn't ready, an admin verifies by calling the POC
  poc_phone_verified_by_call boolean not null default false
);

-- What the unit selected (province, district or tambon) and the expanded tambon list.
create table public.authority_coverage (
  unit_id uuid not null references public.authority_units (id) on delete cascade,
  tambon text not null references public.tambons (code),
  selected_level public.admin_level not null,
  selected_code text not null,
  primary key (unit_id, tambon)
);
create index authority_coverage_tambon_idx on public.authority_coverage (tambon);
