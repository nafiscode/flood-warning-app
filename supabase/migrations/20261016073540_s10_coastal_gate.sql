-- The coastal gate (science plan Module 10; the owner asked for it on 16 Oct 2026 after a friend in
-- Narathiwat described the Bang Nara flooding while the sea stood high and the water could not get out).
--
-- A river drains while the sea is below it, so what keeps water in after the rain stops is the low
-- tide, not the high one: the floor the river has to get over. Monsoon set-up lifts that floor, and
-- when the tidal range collapses at the same time it never drops. In both the 2024 and the 2025
-- floods the low water at all four mouths stood at the 96th-99th percentile of flood-season days
-- while the high water was unremarkable (pipeline/coastal_gate/report.md).
--
-- This table is only the yardstick: what the sea normally does at each mouth in October to January,
-- written by the pipeline (`coastal_gate run`, seed 49). The live side is the sea level that
-- signals_fetch() already stores per zone, read against these percentiles on the admins' signal
-- dashboard.
--
-- It is advisory and it stays advisory. It can never raise a level and it can never publish
-- (safety rule 2); it tells an admin how long water will take to leave, which is the safe-return
-- window's question, not the alert level's. Absolute metres are not transferable: the model sat
-- about 0.7 m off the Pattani tide gauge (A8), so only percentiles within one mouth's own series
-- mean anything (safety rule 8).

create table public.coastal_gate_reference (
  -- The mouth: 'pattani_river', 'kolok', 'u_taphao', 'bang_nara'.
  id text primary key,
  -- The warning zone whose live tide series this reference belongs to. Null for a mouth with no
  -- zone yet: Mueang Narathiwat (tambons 9601xx) is in none, so the Bang Nara has a reference and
  -- no live feed until a zone exists.
  zone_id uuid references public.warning_zones (id) on delete set null,
  name jsonb not null,
  -- The model cell actually read, a few kilometres offshore of the mouth, not the mouth itself.
  lat double precision not null,
  lon double precision not null,
  -- Daily lower low water, flood-season percentiles. p90 is the line the live flag uses.
  llw_p50 double precision,
  llw_p90 double precision,
  llw_p98 double precision,
  -- The non-tidal set-up (Godin-filtered), same months, same percentiles.
  setup_p50 double precision,
  setup_p90 double precision,
  setup_p98 double precision,
  season_days integer not null default 0,
  -- Grid point, archive window, filter, the monthly cut, the floods on record, the base-rate
  -- spells, the wind correlation and the caveats.
  method jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.coastal_gate_reference enable row level security;
-- Admins read it; nobody writes it but the seed (as the owner). No personal data is involved, but
-- it stays admin-only because it is only meaningful beside the rest of the signal dashboard, and a
-- bare sea-level percentile shown in public would read as a forecast (safety rule 8).
create policy coastal_gate_reference_admin_read on public.coastal_gate_reference for select
  to authenticated using (public.is_admin());
revoke all on public.coastal_gate_reference from anon, authenticated;
grant select on public.coastal_gate_reference to authenticated;

-- Every mouth's reference, for the dashboard. Admins only.
create function public.admin_coastal_gate()
returns table (id text, zone_id uuid, basin text, name jsonb, lat double precision,
               lon double precision, llw_p50 double precision, llw_p90 double precision,
               llw_p98 double precision, setup_p50 double precision, setup_p90 double precision,
               setup_p98 double precision, season_days integer, method jsonb,
               updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.zone_id, z.basin, g.name, g.lat, g.lon, g.llw_p50, g.llw_p90, g.llw_p98,
         g.setup_p50, g.setup_p90, g.setup_p98, g.season_days, g.method, g.updated_at
    from public.coastal_gate_reference g
    left join public.warning_zones z on z.id = g.zone_id
   where public.is_admin()
   order by g.id
$$;
revoke all on function public.admin_coastal_gate() from public, anon;
grant execute on function public.admin_coastal_gate() to authenticated;
