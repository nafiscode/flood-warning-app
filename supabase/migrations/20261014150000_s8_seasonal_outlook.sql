-- S8: the seasonal outlook, for the admins' signal dashboard (science plan Module 9).
--
-- One row per method per issue, written by the science pipeline (pipeline/seasonal_outlook,
-- `outlook`) and loaded from supabase/seed/60_seasonal_outlook.sql. An outlook gives odds that the
-- coming November-to-January season falls in the drier, middle or wetter third of past seasons,
-- with how often such a lean was right before. It is never a flood forecast: the bursts that flood
-- towns are not predictable this far ahead. `lean = 'none'` means no method can be trusted this
-- time, and is the honest answer, not a gap.
--
-- Admins only. Whether the public sees an outlook at all is the owner's decision (prompt S8, step 4).
-- Nothing may issue or change an alert from it (safety rule 2).

create table public.seasonal_outlooks (
  id bigint generated always as identity primary key,
  -- The season, named by the year it starts in (November to January).
  season integer not null check (season between 1980 and 2100),
  issued_on date not null,
  -- 'summary' is the line to read first; the others are the methods behind it.
  method text not null check (method ~ '^[a-z0-9_]+$'),
  lean text not null check (lean in ('dry', 'normal', 'wet', 'none')),
  odds_dry smallint check (odds_dry between 0 and 100),
  odds_normal smallint check (odds_normal between 0 and 100),
  odds_wet smallint check (odds_wet between 0 and 100),
  -- How often this method's lean matched the season's third in the seasons it was scored on, and
  -- what chance alone would give.
  past_hit_pct real check (past_hit_pct between 0 and 100),
  chance_hit_pct real check (chance_hit_pct between 0 and 100),
  past_seasons integer check (past_seasons >= 0),
  -- False when the method's lean is not to be used this time, with the reason in `note`.
  usable boolean not null,
  note text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (season, issued_on, method),
  check (
    (odds_dry is null and odds_normal is null and odds_wet is null)
    or (odds_dry + odds_normal + odds_wet between 98 and 102)
  )
);

alter table public.seasonal_outlooks enable row level security;
create policy "seasonal_outlooks: admins read" on public.seasonal_outlooks for select
  to authenticated using (public.is_admin());
-- Written by the seed only. New tables get write grants back from the project's default
-- privileges, so they are taken away here (see the dam tables, 9 Oct).
revoke insert, update, delete, truncate on public.seasonal_outlooks from anon, authenticated;
