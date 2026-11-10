-- Season state (science plan Module 11; the owner asked for it on 9 November 2026: "do we have the
-- monthly trend of the river gauges, so we can see the water is rising in the wet month ... with
-- the rainfall continuously happening, so we can determine an alert for preparation?").
--
-- Jaga could not answer that. The signal dashboard sees ninety-six hours of gauge, three days of
-- rain behind and five ahead; nothing says whether a river is running higher than it should be for
-- mid-November, and nothing notices a slow build-up. These two tables are the yardstick it needs,
-- written by the pipeline (`season_state run`, seed 61):
--
--   season_baseflow  per kept gauge, per flood-season month: the lower third, median and upper
--                    third of its daily-minimum floor, and of that floor's seven-day change.
--   season_rain      per warning zone, per month: the same three for basin rain over fifteen days,
--                    thirty days, and running from the first of October.
--
-- The live side is what the database already fetches: the gauge readings in `observations` and the
-- rain in `forecasts`, read against these terciles.
--
-- Three things this is not.
--   * Not a forecast. Every figure is rain already fallen and a river level already read (safety
--     rule 8). The seasons behind each cell are stored beside it, and a month with fewer than three
--     seasons holds nulls rather than a number resting on one year.
--   * Not comparable between gauges. A floor of 12 m at X.40A and 0.7 m at X.44 say nothing about
--     each other; only a position in a gauge's own record travels. Hence terciles, not metres, on
--     the dashboard - and terciles rather than high percentiles, because the RID key gauges start
--     in February 2020 and six seasons is the most any of them has.
--   * Not able to raise a level or publish anything, ever (safety rule 2). It is read beside an
--     admin's judgement, like the coastal gate and the safe-return window.
--
-- Only the gauges the catchment actually moves are in here. A harmonic fit separates the sea's
-- periods (M2 12.42 h, K1 23.93 h, O1 25.82 h) from the exactly-24-hour line, which is human: the
-- gauges below Bang Lang were dropped because their floor follows the turbine schedule, and the
-- river-mouth gauges because theirs is the low tide. X.77 is dropped here and is **unchanged**
-- everywhere else: Module 3 and the automated alarm still read it exactly as before.

create table public.season_baseflow (
  station_id uuid not null references public.stations (id) on delete cascade,
  -- A flood-season month: 10, 11, 12 or 1.
  month smallint not null check (month between 1 and 12),
  -- The daily minimum's lower third, median and upper third for this gauge in this month.
  floor_p33 double precision,
  floor_p50 double precision,
  floor_p67 double precision,
  -- How far that floor moves over seven days, same thirds. Negative is a falling river.
  rise_p33 double precision,
  rise_p50 double precision,
  rise_p67 double precision,
  -- How many whole seasons and how many days are behind the figures above. Under
  -- method.rules.min_seasons the three thirds are null and this says why.
  seasons integer not null default 0,
  days integer not null default 0,
  -- The harmonic fit: the sea's three constituents combined, and the exactly-24-hour line.
  sea_m double precision,
  pulse_m double precision,
  -- The gauge's code, zone and role, its record span, the rules, and the whole harmonic fit.
  method jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (station_id, month)
);
alter table public.season_baseflow enable row level security;
-- Admins read it; nobody writes it but the seed (as the owner). Admin-only for the same reason the
-- coastal gate is: a bare river-level tercile shown in public would read as a forecast.
create policy season_baseflow_admin_read on public.season_baseflow for select
  to authenticated using (public.is_admin());
revoke all on public.season_baseflow from anon, authenticated;
grant select on public.season_baseflow to authenticated;

create table public.season_rain (
  zone_id uuid not null references public.warning_zones (id) on delete cascade,
  month smallint not null check (month between 1 and 12),
  -- Basin-mean rain already fallen over fifteen days, thirty days, and since 1 October, each as
  -- that basin's own lower third, median and upper third for this month, in millimetres.
  d15_p33 double precision,
  d15_p50 double precision,
  d15_p67 double precision,
  d30_p33 double precision,
  d30_p50 double precision,
  d30_p67 double precision,
  std_p33 double precision,
  std_p50 double precision,
  std_p67 double precision,
  seasons integer not null default 0,
  days integer not null default 0,
  -- The basin, the record span, the rules, the rain source, and how often the soft notice's rule
  -- would have held in each past season.
  method jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (zone_id, month)
);
alter table public.season_rain enable row level security;
create policy season_rain_admin_read on public.season_rain for select
  to authenticated using (public.is_admin());
revoke all on public.season_rain from anon, authenticated;
grant select on public.season_rain to authenticated;

-- The whole reference in one answer, for the signal dashboard. Admins only; a non-admin gets no
-- rows rather than an error, as admin_gauge_recession() and admin_coastal_gate() do, so a missing
-- block simply is not drawn.
create function public.admin_season_state()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', now(),
    'gauges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stationId', b.station_id, 'thaiwaterId', s.thaiwater_id, 'code', s.code,
               'month', b.month,
               'floor', jsonb_build_object('p33', b.floor_p33, 'p50', b.floor_p50, 'p67', b.floor_p67),
               'rise', jsonb_build_object('p33', b.rise_p33, 'p50', b.rise_p50, 'p67', b.rise_p67),
               'seasons', b.seasons, 'days', b.days, 'seaM', b.sea_m, 'pulseM', b.pulse_m,
               'method', b.method, 'updatedAt', b.updated_at)
               order by s.code, b.month)
        from public.season_baseflow b
        join public.stations s on s.id = b.station_id), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'zoneId', r.zone_id, 'basin', z.basin, 'month', r.month,
               'd15', jsonb_build_object('p33', r.d15_p33, 'p50', r.d15_p50, 'p67', r.d15_p67),
               'd30', jsonb_build_object('p33', r.d30_p33, 'p50', r.d30_p50, 'p67', r.d30_p67),
               'std', jsonb_build_object('p33', r.std_p33, 'p50', r.std_p50, 'p67', r.std_p67),
               'seasons', r.seasons, 'days', r.days, 'method', r.method, 'updatedAt', r.updated_at)
               order by z.basin, r.month)
        from public.season_rain r
        join public.warning_zones z on z.id = r.zone_id), '[]'::jsonb))
  where public.is_admin()
$$;
revoke all on function public.admin_season_state() from public, anon;
grant execute on function public.admin_season_state() to authenticated;
