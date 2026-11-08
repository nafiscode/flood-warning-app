-- A16: severe weather is pushed to the phones that follow a tambon (the owner, 8 Nov 2026).
--
-- What this is NOT: an alert. Safety rule 2 keeps publishing an alert in human hands, and nothing
-- here touches `alerts`, sets a level or colours a tambon. What leaves is advice about the
-- weather - heavy rain, a thunderstorm or strong wind forecast by Open-Meteo - carrying the hours
-- it is expected, the time of the model data and, in its own words, the fact that it is weather
-- and not a flood warning (safety rules 8 and 10).
--
-- The shape follows A7's push dispatch exactly, for the same reason: nobody in particular is
-- doing this at the moment it happens, so it cannot ride on an acting person's rights.
--   * Jaga's server proves itself with the push gate token it already holds.
--   * The database says which places are worth asking the forecast for (`weather_cells`), and
--     the server asks Open-Meteo - never the database, which has no business calling out.
--   * `weather_advisory_push` records one advisory and hands out the phones that are owed it,
--     once each (`weather_push_log`).
--   * `weather_tick()` wakes the server once an hour, so this works with nobody's app open.
--
-- Two things it will not do, both deliberate:
--   * Nothing is sent between 23:00 and 05:00 Bangkok. A forecast is not worth waking a street
--     for at three in the morning, and a phone that does it is a phone whose owner turns Jaga
--     off before the season starts. Real risk at night is what an alert and the alarm are for.
--   * Nothing is sent to a tambon that is at Warning or Evacuate. There the alert is the message
--     of the day, and a second notification about the sky only competes with it.

create table public.weather_advisories (
  id uuid primary key default gen_random_uuid(),
  tambon text not null references public.tambons (code) on delete cascade,
  kind text not null check (kind in ('heavy_rain', 'thunder', 'wind')),
  -- When the weather is expected, as the model has it.
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- mm in the wettest hour, or km/h in the strongest gust: what the words quote.
  peak double precision,
  total_mm double precision,
  -- The time of the model data this came from; shown wherever the advisory is (safety rule 8).
  issued_at timestamptz not null,
  source text not null default 'open_meteo',
  created_at timestamptz not null default now()
);
create index weather_advisories_tambon_idx
  on public.weather_advisories (tambon, kind, created_at desc);

-- Which phone has had which advisory. One advisory reaches a phone once.
create table public.weather_push_log (
  advisory_id uuid not null references public.weather_advisories (id) on delete cascade,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (advisory_id, endpoint)
);

-- An advisory is public knowledge about the weather, not about a person: it names a tambon and
-- nothing else. It is still read through functions only, because nothing in the app needs to
-- list them and the log beside it names push addresses (safety rule 5).
alter table public.weather_advisories enable row level security;
alter table public.weather_push_log enable row level security;
revoke all on public.weather_advisories from public, anon, authenticated;
revoke all on public.weather_push_log from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The hours Jaga stays quiet, and the places worth asking about.
-------------------------------------------------------------------------------
-- The clock is a parameter so the rule itself can be tested at any hour of the day; the server
-- never passes one, and the only caller that could is Jaga's own, holding the gate token.
create function public.weather_quiet_now(p_at timestamptz default now()) returns boolean
language sql stable set search_path = '' as $$
  select extract(hour from (coalesce(p_at, now()) at time zone 'Asia/Bangkok')) >= 23
      or extract(hour from (coalesce(p_at, now()) at time zone 'Asia/Bangkok')) < 5
$$;
revoke execute on function public.weather_quiet_now(timestamptz) from public, anon, authenticated;

-- The tambons at least one phone follows, most-followed first, with a point to ask the forecast
-- for. Tambons already under a Warning or an Evacuate are left out: there the alert speaks.
create function public.weather_cells(
  p_token text,
  p_limit integer default 60,
  p_at timestamptz default now()
)
returns table (
  tambon text,
  name_th text,
  name_en text,
  lat double precision,
  lon double precision,
  followers bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if public.weather_quiet_now(p_at) then
    return;
  end if;
  return query
    select t.code,
           t.name_th,
           t.name_en,
           round(extensions.st_y(extensions.st_pointonsurface(t.geom))::numeric, 2)::double precision,
           round(extensions.st_x(extensions.st_pointonsurface(t.geom))::numeric, 2)::double precision,
           count(*) as followers
      from public.push_subscriptions s
      cross join lateral unnest(s.tambons) as followed(code)
      join public.tambons t on t.code = followed.code
     where public.tambon_level(t.code, 'flood') in ('normal', 'watch', 'return')
     group by t.code, t.name_th, t.name_en, t.geom
     order by followers desc, t.code
     limit greatest(1, least(coalesce(p_limit, 60), 300));
end $$;
revoke execute on function public.weather_cells(text, integer, timestamptz)
  from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Record one advisory and hand out the phones that are owed it.
--
-- Nothing is recorded twice: the same kind for the same tambon within `p_gap_hours` is the same
-- weather said again, and the forecast is refreshed every hour. The caller gets no rows then, so
-- no phone is told twice either.
-------------------------------------------------------------------------------
create function public.weather_advisory_push(
  p_token text,
  p_tambon text,
  p_kind text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_peak double precision,
  p_total_mm double precision,
  p_issued_at timestamptz,
  p_gap_hours integer default 12,
  p_at timestamptz default now()
)
returns table (
  advisory_id uuid,
  endpoint text,
  keys jsonb,
  locale text,
  kind text,
  tambon_th text,
  tambon_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  peak double precision,
  total_mm double precision,
  issued_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_th text;
  v_en text;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if public.weather_quiet_now(p_at) then
    return;
  end if;
  if p_kind not in ('heavy_rain', 'thunder', 'wind') then
    raise exception 'Not a kind of weather Jaga sends' using errcode = 'invalid_parameter_value';
  end if;
  -- The alert owns the moment where there is one.
  if public.tambon_level(p_tambon, 'flood') in ('warning', 'evacuate') then
    return;
  end if;
  select t.name_th, t.name_en into v_th, v_en from public.tambons t where t.code = p_tambon;
  if v_th is null then
    return;
  end if;
  if exists (
    select 1 from public.weather_advisories a
     where a.tambon = p_tambon and a.kind = p_kind
       and a.created_at > coalesce(p_at, now())
                          - make_interval(hours => greatest(1, coalesce(p_gap_hours, 12)))
  ) then
    return;
  end if;

  insert into public.weather_advisories
    (tambon, kind, starts_at, ends_at, peak, total_mm, issued_at)
  values (p_tambon, p_kind, p_starts_at, p_ends_at, p_peak, p_total_mm, p_issued_at)
  returning id into v_id;

  return query
    with owed as (
      select s.endpoint, s.keys, s.locale
        from public.push_subscriptions s
       where s.tambons @> array[p_tambon]
    ), noted as (
      insert into public.weather_push_log (advisory_id, endpoint)
      select v_id, o.endpoint from owed o
      on conflict do nothing
      returning endpoint
    )
    select v_id, o.endpoint, o.keys, o.locale, p_kind, v_th, v_en,
           p_starts_at, p_ends_at, p_peak, p_total_mm, p_issued_at
      from owed o
      join noted n on n.endpoint = o.endpoint;
end $$;
revoke execute on function public.weather_advisory_push(
  text, text, text, timestamptz, timestamptz, double precision, double precision, timestamptz,
  integer, timestamptz) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The hourly tick. It sends nothing itself: it wakes Jaga's server, which asks the forecast.
-- Skipped while the gate is not set up (a fresh database, a test database), while Jaga is quiet,
-- and while no phone follows anything - so it can never fail loudly or call an address nobody
-- chose, and a laptop's database never talks to the live site.
-------------------------------------------------------------------------------
create function public.weather_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.push_gate;
begin
  select * into g from public.push_gate limit 1;
  if g.site_url is null or public.weather_quiet_now() then
    return;
  end if;
  if not exists (select 1 from public.push_subscriptions limit 1) then
    return;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  perform extensions.http((
    'POST', g.site_url || '/api/weather/advisories',
    array[extensions.http_header('x-jaga-push', g.token)],
    'application/json', '{}'
  )::extensions.http_request);
exception when others then
  -- A site that is down must not fill the cron log, or stop the next hour's try.
  null;
end $$;
revoke execute on function public.weather_tick() from public, anon, authenticated;

-- Five past the hour, so it never starts in the same second as the one-minute push tick.
select cron.schedule('jaga-weather-tick', '5 * * * *', 'select public.weather_tick()');
