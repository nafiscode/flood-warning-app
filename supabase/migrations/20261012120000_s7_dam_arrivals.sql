-- S7 steps 2-3: when released water reaches each tambon on a dam's path.
--
-- One row per tambon, written by the science pipeline (pipeline/dam_release, `travel`) and loaded
-- from supabase/seed/41_dam_arrivals.sql. Every time is a range in hours, measured from the river
-- gauges (the turbines' daily pulses and the floods since 2020). It is not a forecast and there
-- is no hydraulic model behind it, which is why nothing here is a single time (safety rule 8):
--
--   earliest_h .. latest_h            the first rise, hours after the gates open
--   warn_from_h                       the earliest time with the safety margin taken off; what a
--                                     warning counts down to (docs/spec.md section 15)
--   peak_earliest_h .. peak_latest_h  the highest water, hours after the highest release
--
-- `source` names the version of the measurement, so a later one can sit beside this one and be
-- compared before it replaces it - the same habit as dam_reaches.

create table public.dam_arrivals (
  dam_code text not null references public.dams (code) on delete cascade,
  source text not null,
  tambon_code text not null references public.tambons (code),
  -- 'main' where the river itself runs through, 'tributary' where only a lower reach does; a
  -- tributary's tambon takes the times of the place where its stream joins the river.
  via public.dam_reach_kind not null,
  -- River distance from the dam to where the river first touches the tambon.
  km_from_dam double precision not null check (km_from_dam >= 0),
  warn_from_h double precision not null check (warn_from_h >= 0),
  earliest_h double precision not null,
  latest_h double precision not null,
  peak_earliest_h double precision not null,
  peak_latest_h double precision not null,
  -- What the times rest on, for the screen that shows them.
  method jsonb not null default '{}'::jsonb,
  primary key (dam_code, source, tambon_code),
  check (warn_from_h <= earliest_h and earliest_h <= latest_h),
  check (peak_earliest_h <= peak_latest_h)
);
create index dam_arrivals_tambon_idx on public.dam_arrivals (tambon_code);

-- Public to read, like the river's line: it is a property of the river, and people need it
-- before anyone has sent them an alert. Nobody writes it from a client; the seed does.
alter table public.dam_arrivals enable row level security;
create policy "dam_arrivals: everyone reads" on public.dam_arrivals for select
  to anon, authenticated using (true);
-- New tables get write privileges back from the project's default privileges (see
-- 20261009234000_a12_dam_grants.sql), so take them away explicitly.
revoke insert, update, delete, truncate on public.dam_arrivals from anon, authenticated;
