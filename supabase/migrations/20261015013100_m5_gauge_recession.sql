-- How long each river gauge took to fall back after its past floods (science plan Module 5, the
-- "safe-return window"; the owner asked for it on 15 Oct 2026).
--
-- Hours from a flood's peak to staying below the bank and below Warning for 12 hours, from the hourly
-- ThaiWater record since 2020, October to March. Written by the pipeline (`safe_return run`, seed 48),
-- read by the admins' signal dashboard beside the Return alert. It is the record of past floods, not a
-- forecast: an admin still writes the return window as a range (safety rule 8). `method` holds the
-- raw durations, the over-bank figures, the rules and the flags (tidal, lake, bank_suspect, usable).

create table public.gauge_recession (
  station_id uuid primary key references public.stations (id) on delete cascade,
  events integer not null default 0,
  to_bank_h_p25 double precision,
  to_bank_h_p50 double precision,
  to_bank_h_p75 double precision,
  to_warning_h_p25 double precision,
  to_warning_h_p50 double precision,
  to_warning_h_p75 double precision,
  above_bank_h_p50 double precision,
  censored integer not null default 0,
  first_season integer,
  last_season integer,
  method jsonb not null default '{}'::jsonb
);
alter table public.gauge_recession enable row level security;
-- Admins read it; nobody writes it but the seed (as the owner).
create policy gauge_recession_admin_read on public.gauge_recession for select to authenticated
  using (public.is_admin());
revoke all on public.gauge_recession from anon, authenticated;
grant select on public.gauge_recession to authenticated;

-- Every gauge's figures, for the dashboard. Admins only.
create function public.admin_gauge_recession()
returns table (station_id uuid, events integer, to_bank_h_p25 double precision, to_bank_h_p50 double precision,
               to_bank_h_p75 double precision, to_warning_h_p25 double precision,
               to_warning_h_p50 double precision, to_warning_h_p75 double precision,
               above_bank_h_p50 double precision, censored integer, first_season integer,
               last_season integer, method jsonb)
language sql stable security definer set search_path = '' as $$
  select r.station_id, r.events, r.to_bank_h_p25, r.to_bank_h_p50, r.to_bank_h_p75, r.to_warning_h_p25,
         r.to_warning_h_p50, r.to_warning_h_p75, r.above_bank_h_p50, r.censored, r.first_season,
         r.last_season, r.method
  from public.gauge_recession r
  where public.is_admin()
$$;
revoke all on function public.admin_gauge_recession() from public, anon;
grant execute on function public.admin_gauge_recession() to authenticated;
