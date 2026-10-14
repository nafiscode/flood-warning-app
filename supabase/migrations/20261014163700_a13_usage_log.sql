-- Who uses Jaga, counted by Jaga itself (the owner, 14 Oct: an admin dashboard of who has the
-- app open now, on what device, from where, and the places they watch). Four choices of theirs:
--
--  * Jaga's own counter, no analytics service and no server logs: the phone sends a short note
--    when the app opens (through Jaga's server, which adds the rough city it reads from the
--    internet address; the address itself is never stored), and on a page change or every five
--    minutes while the app is on screen (straight to these functions).
--  * Location = the tambon the person chose in the app, plus that rough city. Never GPS.
--  * A phone is a random install code made on the phone, never joined to an account, a name or a
--    number. Raw rows live 90 days; the day totals in usage_daily stay.
--  * Watched places and homes reach the dashboard as counts per tambon only (as in the war room).
--
-- Nothing here is readable by a client: the tables have RLS on and no policy, the two writing
-- functions accept only their own narrow notes, and admin_usage() is the one way to read.

create table public.usage_devices (
  install_id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  device text not null default 'other' check (device in ('phone', 'tablet', 'desktop', 'other')),
  os text not null default 'other' check (length(os) <= 20),
  os_major smallint,
  browser text not null default 'other' check (length(browser) <= 20),
  in_app text check (length(in_app) <= 20),
  installed boolean not null default false,
  push_on boolean not null default false,
  signed_in boolean not null default false,
  locale text check (locale in ('th', 'ms', 'en')),
  tambon text references public.tambons (code) on delete set null,
  area_from text check (area_from in ('gps', 'list', 'account')),
  watched smallint not null default 0 check (watched between 0 and 50),
  country text check (country ~ '^[A-Z]{2}$'),
  region text check (length(region) <= 60),
  city text check (length(city) <= 80),
  -- The internet address's rough place, cut to 0.1 degree (about 11 km) before it is stored.
  ip_lat numeric(4, 1) check (ip_lat between -90 and 90),
  ip_lon numeric(4, 1) check (ip_lon between -180 and 180),
  memory_gb numeric(4, 2) check (memory_gb between 0 and 64),
  cores smallint check (cores between 0 and 256),
  net text check (net in ('slow-2g', '2g', '3g', '4g')),
  screen_w smallint check (screen_w between 0 and 10000),
  opens integer not null default 0
);
create index usage_devices_last_seen_idx on public.usage_devices (last_seen desc);

create table public.usage_sessions (
  session_id uuid primary key,
  install_id uuid not null references public.usage_devices on delete cascade,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  entry text not null,
  path text not null,
  views integer not null default 1,
  beats integer not null default 0,
  -- Where the session was opened from, kept with it so a past day is counted where it happened.
  tambon text,
  country text,
  city text,
  ip_lat numeric(4, 1),
  ip_lon numeric(4, 1),
  -- How fast the first screen came, as the phone measured it (milliseconds).
  fcp_ms integer check (fcp_ms between 0 and 120000),
  ready_ms integer check (ready_ms between 0 and 120000)
);
create index usage_sessions_install_idx on public.usage_sessions (install_id);
create index usage_sessions_started_idx on public.usage_sessions (started_at desc);
create index usage_sessions_last_idx on public.usage_sessions (last_at desc);

create table public.usage_views (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.usage_sessions on delete cascade,
  at timestamptz not null default now(),
  path text not null
);
create index usage_views_session_idx on public.usage_views (session_id);
create index usage_views_at_idx on public.usage_views (at desc);

-- One row per Bangkok day, written by the nightly roll-up and kept after the raw rows go.
create table public.usage_daily (
  day date primary key,
  devices integer not null,
  new_devices integer not null,
  returning_devices integer not null,
  sessions integer not null,
  views integer not null,
  minutes integer not null,
  installed integer not null,
  push_on integer not null,
  signed_in integer not null,
  watching integer not null,
  by_province jsonb not null default '{}',
  by_device jsonb not null default '{}',
  by_os jsonb not null default '{}',
  by_browser jsonb not null default '{}',
  by_locale jsonb not null default '{}',
  by_country jsonb not null default '{}',
  by_screen jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

alter table public.usage_devices enable row level security;
alter table public.usage_sessions enable row level security;
alter table public.usage_views enable row level security;
alter table public.usage_daily enable row level security;
revoke all on public.usage_devices, public.usage_sessions, public.usage_views, public.usage_daily
  from public, anon, authenticated;

insert into public.system_settings (key, value)
values ('usage', jsonb_build_object(
  'keep_days', 90,
  'live_minutes', 6,
  'session_gap_minutes', 30,
  'max_sessions_per_hour', 30
))
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- A screen's address as it is counted: no language prefix, no ids, nothing after a "?".
-------------------------------------------------------------------------------
create function public.usage_path(p_path text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_path is null then '/'
    else coalesce(nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(split_part(split_part(left(p_path, 200), '?', 1), '#', 1)),
            '^/(th|ms|en)(?=/|$)', ''),
          '/([0-9a-f-]{8,}|[0-9]+)(?=/|$)', '/:id', 'g'),
        '[^a-z0-9/:_-]', '', 'g'),
      ''), '/')
  end
$$;

-------------------------------------------------------------------------------
-- The app was opened: through Jaga's server only (it holds the push gate token, the same proof
-- the push tick uses), because the rough city comes from there and must not be typed by anyone.
-------------------------------------------------------------------------------
create function public.usage_open(p_token text, p_hit jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_install uuid;
  v_session uuid;
  v_path text := public.usage_path(p_hit ->> 'path');
  v_tambon text;
  v_settings jsonb;
  v_country text := upper(nullif(p_hit ->> 'country', ''));
begin
  if not public.push_gate_ok(p_token) then return false; end if;
  begin
    v_install := (p_hit ->> 'install')::uuid;
    v_session := (p_hit ->> 'session')::uuid;
  exception when others then
    return false;
  end;
  if v_install is null or v_session is null then return false; end if;
  select value into v_settings from public.system_settings where key = 'usage';

  -- A phone that opens more than this an hour is a script, not a person: count it no further.
  if (select count(*) from public.usage_sessions s
      where s.install_id = v_install and s.started_at > now() - interval '1 hour')
     >= coalesce((v_settings ->> 'max_sessions_per_hour')::int, 30) then
    return false;
  end if;

  select t.code into v_tambon from public.tambons t where t.code = p_hit ->> 'tambon';
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;

  insert into public.usage_devices as d (
    install_id, device, os, os_major, browser, in_app, installed, push_on, signed_in, locale,
    tambon, area_from, watched, country, region, city, ip_lat, ip_lon, memory_gb, cores, net,
    screen_w, opens
  ) values (
    v_install,
    coalesce(nullif(p_hit ->> 'device', ''), 'other'),
    left(coalesce(nullif(p_hit ->> 'os', ''), 'other'), 20),
    nullif(p_hit ->> 'osMajor', '')::smallint,
    left(coalesce(nullif(p_hit ->> 'browser', ''), 'other'), 20),
    left(nullif(p_hit ->> 'inApp', ''), 20),
    coalesce((p_hit ->> 'installed')::boolean, false),
    coalesce((p_hit ->> 'push')::boolean, false),
    coalesce((p_hit ->> 'signedIn')::boolean, false),
    case when p_hit ->> 'locale' in ('th', 'ms', 'en') then p_hit ->> 'locale' end,
    v_tambon,
    case when v_tambon is not null and p_hit ->> 'areaFrom' in ('gps', 'list', 'account')
         then p_hit ->> 'areaFrom' end,
    least(greatest(coalesce((p_hit ->> 'watched')::int, 0), 0), 50),
    v_country,
    left(nullif(p_hit ->> 'region', ''), 60),
    left(nullif(p_hit ->> 'city', ''), 80),
    round((p_hit ->> 'lat')::numeric, 1),
    round((p_hit ->> 'lon')::numeric, 1),
    least((p_hit ->> 'memory')::numeric, 64),
    least((p_hit ->> 'cores')::int, 256),
    case when p_hit ->> 'net' in ('slow-2g', '2g', '3g', '4g') then p_hit ->> 'net' end,
    least((p_hit ->> 'screen')::int, 10000),
    1
  )
  on conflict (install_id) do update set
    last_seen = now(), device = excluded.device, os = excluded.os, os_major = excluded.os_major,
    browser = excluded.browser, in_app = excluded.in_app, installed = excluded.installed,
    push_on = excluded.push_on, signed_in = excluded.signed_in, locale = excluded.locale,
    tambon = excluded.tambon, area_from = excluded.area_from, watched = excluded.watched,
    country = excluded.country, region = excluded.region, city = excluded.city,
    ip_lat = excluded.ip_lat, ip_lon = excluded.ip_lon, memory_gb = excluded.memory_gb,
    cores = excluded.cores, net = excluded.net, screen_w = excluded.screen_w,
    opens = d.opens + 1;

  insert into public.usage_sessions (
    session_id, install_id, entry, path, tambon, country, city, ip_lat, ip_lon, fcp_ms, ready_ms
  )
  select v_session, v_install, v_path, v_path, v_tambon, v_country,
         left(nullif(p_hit ->> 'city', ''), 80),
         round((p_hit ->> 'lat')::numeric, 1), round((p_hit ->> 'lon')::numeric, 1),
         case when (p_hit ->> 'fcp')::int between 0 and 120000 then (p_hit ->> 'fcp')::int end,
         case when (p_hit ->> 'ready')::int between 0 and 120000 then (p_hit ->> 'ready')::int end
  on conflict (session_id) do nothing;
  if found then
    insert into public.usage_views (session_id, path) values (v_session, v_path);
  end if;
  return true;
exception when others then
  -- A counter must never cost the person anything: a bad note is simply not counted.
  return false;
end $$;
revoke execute on function public.usage_open(text, jsonb) from public;
grant execute on function public.usage_open(text, jsonb) to anon, authenticated;

-------------------------------------------------------------------------------
-- A page change ('view') or "still on screen" ('beat'), straight from the phone. It can only
-- add to a session that was opened through usage_open in the last day, and is slowed down: a
-- view at most every 2 s, a beat at most every minute.
-------------------------------------------------------------------------------
create function public.usage_ping(p_session uuid, p_kind text, p_path text default null)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_last timestamptz;
  v_install uuid;
  v_path text := public.usage_path(p_path);
begin
  if p_kind not in ('view', 'beat') then return false; end if;
  select s.last_at, s.install_id into v_last, v_install
  from public.usage_sessions s
  where s.session_id = p_session and s.started_at > now() - interval '1 day'
  for update;
  if not found then return false; end if;
  if p_kind = 'view' then
    if v_last > now() - interval '2 seconds' then return false; end if;
    insert into public.usage_views (session_id, path) values (p_session, v_path);
    update public.usage_sessions
       set last_at = now(), path = v_path, views = views + 1
     where session_id = p_session;
  else
    if v_last > now() - interval '1 minute' then return false; end if;
    update public.usage_sessions
       set last_at = now(), beats = beats + 1,
           path = case when p_path is null then path else v_path end
     where session_id = p_session;
  end if;
  update public.usage_devices set last_seen = now() where install_id = v_install;
  return true;
exception when others then
  return false;
end $$;
revoke execute on function public.usage_ping(uuid, text, text) from public;
grant execute on function public.usage_ping(uuid, text, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The nightly roll-up: every finished Bangkok day not yet counted (and yesterday again, since a
-- session can run past midnight), then the raw rows older than the keeping time go.
-------------------------------------------------------------------------------
create function public.usage_count_by(p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
  from (select value ->> 'k' as k, count(*) as n
        from jsonb_array_elements(p_rows) group by 1) x
  where k is not null
$$;
revoke execute on function public.usage_count_by(jsonb) from public, anon, authenticated;

create function public.usage_rollup() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_from date;
  v_day date;
  v_done integer := 0;
  v_keep integer;
begin
  select coalesce((value ->> 'keep_days')::int, 90) into v_keep
  from public.system_settings where key = 'usage';
  v_keep := coalesce(v_keep, 90);

  select least(
           coalesce((select max(day) from public.usage_daily), v_today - 1),
           coalesce((select min((started_at at time zone 'Asia/Bangkok')::date)
                     from public.usage_sessions
                     where (started_at at time zone 'Asia/Bangkok')::date >
                           coalesce((select max(day) from public.usage_daily), '1900-01-01')),
                    v_today - 1))
    into v_from;

  v_day := v_from;
  while v_day < v_today loop
    with s as (
      select s.*, (s.started_at at time zone 'Asia/Bangkok')::date as d
      from public.usage_sessions s
      where s.started_at >= (v_day::timestamp at time zone 'Asia/Bangkok')
        and s.started_at < ((v_day + 1)::timestamp at time zone 'Asia/Bangkok')
    ),
    dev as (
      select d.* from public.usage_devices d where d.install_id in (select install_id from s)
    )
    insert into public.usage_daily as u (
      day, devices, new_devices, returning_devices, sessions, views, minutes, installed, push_on,
      signed_in, watching, by_province, by_device, by_os, by_browser, by_locale, by_country,
      by_screen, computed_at
    )
    select v_day,
      (select count(*) from dev),
      (select count(*) from public.usage_devices d
        where (d.first_seen at time zone 'Asia/Bangkok')::date = v_day),
      (select count(*) from dev where (dev.first_seen at time zone 'Asia/Bangkok')::date < v_day),
      (select count(*) from s),
      (select coalesce(sum(views), 0) from s),
      (select coalesce(round(sum(extract(epoch from (last_at - started_at)) / 60)), 0) from s),
      (select count(*) from dev where installed),
      (select count(*) from dev where push_on),
      (select count(*) from dev where signed_in),
      (select count(*) from dev where watched > 0),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k',
        coalesce(left(dev.tambon, 2), 'none'))), '[]') from dev)),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k', dev.device)), '[]') from dev)),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k', dev.os)), '[]') from dev)),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k', dev.browser)), '[]') from dev)),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k',
        coalesce(dev.locale, 'none'))), '[]') from dev)),
      public.usage_count_by((select coalesce(jsonb_agg(jsonb_build_object('k',
        coalesce(dev.country, 'none'))), '[]') from dev)),
      (select coalesce(jsonb_object_agg(path, n), '{}') from (
        select v.path, count(*) as n from public.usage_views v join s on s.session_id = v.session_id
        group by v.path) p),
      now()
    on conflict (day) do update set
      devices = excluded.devices, new_devices = excluded.new_devices,
      returning_devices = excluded.returning_devices, sessions = excluded.sessions,
      views = excluded.views, minutes = excluded.minutes, installed = excluded.installed,
      push_on = excluded.push_on, signed_in = excluded.signed_in, watching = excluded.watching,
      by_province = excluded.by_province, by_device = excluded.by_device, by_os = excluded.by_os,
      by_browser = excluded.by_browser, by_locale = excluded.by_locale,
      by_country = excluded.by_country, by_screen = excluded.by_screen, computed_at = now();
    v_done := v_done + 1;
    v_day := v_day + 1;
  end loop;

  delete from public.usage_sessions where last_at < now() - make_interval(days => v_keep);
  delete from public.usage_devices where last_seen < now() - make_interval(days => v_keep);
  return v_done;
end $$;
revoke execute on function public.usage_rollup() from public, anon, authenticated;

select cron.schedule('jaga-usage-rollup', '37 17 * * *', 'select public.usage_rollup()');

-------------------------------------------------------------------------------
-- Everything the usage dashboard draws, in one read. Admins only. Counts and rough places only:
-- no install code, no session id and no single phone's row ever leaves the database.
-------------------------------------------------------------------------------
create function public.admin_usage(p_days integer default 30) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_now timestamptz := now();
  v_live interval;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_since timestamptz;
  v_out jsonb;
begin
  perform public.admin_only();
  select make_interval(mins => coalesce((value ->> 'live_minutes')::int, 6)) into v_live
  from public.system_settings where key = 'usage';
  v_live := coalesce(v_live, interval '6 minutes');
  v_since := ((v_today - v_days + 1)::timestamp at time zone 'Asia/Bangkok');

  with
  live as (
    select s.*, d.device, d.signed_in, d.installed
    from public.usage_sessions s join public.usage_devices d using (install_id)
    where s.last_at >= v_now - v_live
  ),
  live_dev as (select distinct on (install_id) * from live order by install_id, last_at desc),
  win_s as (select * from public.usage_sessions s where s.started_at >= v_since),
  win_d as (
    select d.* from public.usage_devices d
    where d.install_id in (select install_id from win_s)
  ),
  centre as (
    select t.code, t.name_th, t.name_en, t.province_code,
           round(extensions.st_y(extensions.st_pointonsurface(t.geom))::numeric, 4) as lat,
           round(extensions.st_x(extensions.st_pointonsurface(t.geom))::numeric, 4) as lon
    from public.tambons t
  ),
  today_s as (
    select * from public.usage_sessions s
    where s.started_at >= (v_today::timestamp at time zone 'Asia/Bangkok')
  )
  select jsonb_build_object(
    'at', v_now,
    'days', v_days,
    'now', jsonb_build_object(
      'live', (select count(*) from live_dev),
      'signedIn', (select count(*) from live_dev where signed_in),
      'installed', (select count(*) from live_dev where installed),
      'tambons', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'nameTh', c.name_th,
          'nameEn', c.name_en, 'province', c.province_code, 'lat', c.lat, 'lon', c.lon, 'n', x.n)
          order by x.n desc), '[]')
        from (select tambon, count(*) as n from live_dev where tambon is not null group by 1) x
        join centre c on c.code = x.tambon),
      'noArea', (select count(*) from live_dev where tambon is null),
      'places', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'city', city,
          'lat', ip_lat, 'lon', ip_lon, 'n', n) order by n desc), '[]')
        from (select country, city, ip_lat, ip_lon, count(*) as n from live_dev
              where ip_lat is not null group by 1, 2, 3, 4) x),
      'screens', (select coalesce(jsonb_agg(jsonb_build_object('k', path, 'n', n) order by n desc), '[]')
        from (select path, count(*) as n from live_dev group by 1) x),
      'devices', (select coalesce(jsonb_agg(jsonb_build_object('k', device, 'n', n) order by n desc), '[]')
        from (select device, count(*) as n from live_dev group by 1) x)
    ),
    -- Phones on screen in each five minutes of the last three hours.
    'pulse', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'n',
        (select count(distinct s.install_id) from public.usage_sessions s
          where s.started_at < b + interval '5 minutes' and s.last_at >= b)) order by b), '[]')
      from generate_series(date_bin('5 minutes', v_now - interval '3 hours', '2000-01-01'),
                           date_bin('5 minutes', v_now, '2000-01-01'), interval '5 minutes') b),
    -- Phones that had the app open in each hour of the last two days.
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('t', h, 'n',
        (select count(distinct s.install_id) from public.usage_sessions s
          where s.started_at < h + interval '1 hour' and s.last_at >= h)) order by h), '[]')
      from generate_series(date_trunc('hour', v_now - interval '47 hours'),
                           date_trunc('hour', v_now), interval '1 hour') h),
    'today', jsonb_build_object(
      'devices', (select count(distinct install_id) from today_s),
      'sessions', (select count(*) from today_s),
      'views', (select coalesce(sum(views), 0) from today_s),
      'newDevices', (select count(*) from public.usage_devices d
        where (d.first_seen at time zone 'Asia/Bangkok')::date = v_today),
      'minutes', (select coalesce(round(sum(extract(epoch from (last_at - started_at)) / 60)), 0)
        from today_s)
    ),
    -- The days of the window: finished days from the roll-up, today counted now.
    'series', (select coalesce(jsonb_agg(x order by x ->> 'day'), '[]') from (
        select jsonb_build_object('day', u.day, 'devices', u.devices, 'newDevices', u.new_devices,
          'returning', u.returning_devices, 'sessions', u.sessions, 'views', u.views,
          'minutes', u.minutes) as x
        from public.usage_daily u where u.day > v_today - v_days and u.day < v_today
        union all
        select jsonb_build_object('day', v_today,
          'devices', (select count(distinct install_id) from today_s),
          'newDevices', (select count(*) from public.usage_devices d
             where (d.first_seen at time zone 'Asia/Bangkok')::date = v_today),
          'returning', (select count(distinct t.install_id) from today_s t
             join public.usage_devices d using (install_id)
             where (d.first_seen at time zone 'Asia/Bangkok')::date < v_today),
          'sessions', (select count(*) from today_s),
          'views', (select coalesce(sum(views), 0) from today_s),
          'minutes', (select coalesce(round(sum(extract(epoch from (last_at - started_at)) / 60)), 0)
             from today_s))
      ) days),
    'totals', jsonb_build_object(
      'devicesEver', (select coalesce(sum(new_devices), 0) from public.usage_daily where day < v_today)
        + (select count(*) from public.usage_devices d
           where (d.first_seen at time zone 'Asia/Bangkok')::date = v_today),
      'sessionsEver', (select coalesce(sum(sessions), 0) from public.usage_daily where day < v_today)
        + (select count(*) from today_s),
      'viewsEver', (select coalesce(sum(views), 0) from public.usage_daily where day < v_today)
        + (select coalesce(sum(views), 0) from today_s),
      'minutesEver', (select coalesce(sum(minutes), 0) from public.usage_daily where day < v_today)
        + (select coalesce(round(sum(extract(epoch from (last_at - started_at)) / 60)), 0) from today_s),
      'since', (select least(min(day), v_today) from public.usage_daily),
      'devices', (select count(*) from win_d),
      'installed', (select count(*) from win_d where installed),
      'pushOn', (select count(*) from win_d where push_on),
      'signedIn', (select count(*) from win_d where signed_in),
      'watching', (select count(*) from win_d where watched > 0),
      'withArea', (select count(*) from win_d where tambon is not null),
      'abroad', (select count(*) from win_d where country is not null and country <> 'TH'),
      'abroadWatching', (select count(*) from win_d
        where country is not null and country <> 'TH' and watched > 0)
    ),
    -- What day of the week and hour people open the app (Bangkok time), over the window.
    'rhythm', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'n', n)), '[]')
      from (select extract(isodow from started_at at time zone 'Asia/Bangkok')::int as dow,
                   extract(hour from started_at at time zone 'Asia/Bangkok')::int as hr,
                   count(*) as n
            from win_s group by 1, 2) x),
    'mix', jsonb_build_object(
      'device', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select device as k, count(*) as n from win_d group by 1) x),
      'os', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select os as k, count(*) as n from win_d group by 1) x),
      'browser', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select browser as k, count(*) as n from win_d group by 1) x),
      'inApp', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select in_app as k, count(*) as n from win_d where in_app is not null group by 1) x),
      'locale', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select coalesce(locale, 'none') as k, count(*) as n from win_d group by 1) x),
      'net', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select coalesce(net, 'unknown') as k, count(*) as n from win_d group by 1) x),
      'memory', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by k), '[]')
        from (select case when memory_gb is null then 'unknown'
                          when memory_gb <= 2 then 'le2' when memory_gb <= 4 then 'le4'
                          else 'gt4' end as k, count(*) as n from win_d group by 1) x),
      'country', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]')
        from (select coalesce(country, 'none') as k, count(*) as n from win_d group by 1) x)
    ),
    'screens', (select coalesce(jsonb_agg(jsonb_build_object('k', path, 'views', views,
        'devices', devices) order by views desc), '[]')
      from (select v.path, count(*) as views, count(distinct s.install_id) as devices
            from public.usage_views v join win_s s using (session_id)
            group by 1 order by 2 desc limit 15) x),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('k', entry, 'n', n) order by n desc), '[]')
      from (select entry, count(*) as n from win_s group by 1 order by 2 desc limit 8) x),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'nameTh', c.name_th,
        'nameEn', c.name_en, 'province', c.province_code, 'lat', c.lat, 'lon', c.lon, 'n', x.n)
        order by x.n desc), '[]')
      from (select tambon, count(*) as n from win_d where tambon is not null group by 1) x
      join centre c on c.code = x.tambon),
    'ipPlaces', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'city', city,
        'lat', ip_lat, 'lon', ip_lon, 'n', n) order by n desc), '[]')
      from (select country, city, ip_lat, ip_lon, count(*) as n from win_d
            where ip_lat is not null group by 1, 2, 3, 4 order by 5 desc limit 200) x),
    -- Watched places and saved homes: all of them, counted per tambon (never a point).
    'watched', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'nameTh', c.name_th,
        'nameEn', c.name_en, 'province', c.province_code, 'lat', c.lat, 'lon', c.lon,
        'places', coalesce(w.places, 0), 'owners', coalesce(w.owners, 0),
        'homes', coalesce(h.homes, 0)) order by coalesce(w.places, 0) + coalesce(h.homes, 0) desc), '[]')
      from centre c
      left join (select sp.tambon, count(*) as places, count(distinct sp.user_id) as owners
                 from public.saved_places sp where sp.tambon is not null group by 1) w
        on w.tambon = c.code
      left join (select pr.home_tambon as tambon, count(*) as homes from public.profiles pr
                 where pr.home_tambon is not null group by 1) h
        on h.tambon = c.code
      where w.places is not null or h.homes is not null),
    'engagement', jsonb_build_object(
      'medianSeconds', (select percentile_cont(0.5) within group (
          order by extract(epoch from (last_at - started_at))) from win_s),
      'medianViews', (select percentile_cont(0.5) within group (order by views) from win_s),
      'sessionsPerDevice', (select round(count(*)::numeric / nullif(count(distinct install_id), 0), 2)
        from win_s),
      'cohort', (select count(*) from public.usage_devices d
        where d.first_seen < v_now - interval '8 days'),
      'backWithinWeek', (select count(*) from public.usage_devices d
        where d.first_seen < v_now - interval '8 days'
          and exists (select 1 from public.usage_sessions s where s.install_id = d.install_id
                      and s.started_at > d.first_seen + interval '1 day'
                      and s.started_at <= d.first_seen + interval '8 days')),
      'stillAfterWeek', (select count(*) from public.usage_devices d
        where d.first_seen < v_now - interval '8 days'
          and d.last_seen > d.first_seen + interval '7 days'),
      'dau', (select round(avg(devices)) from public.usage_daily
        where day >= v_today - 30 and day < v_today),
      'mau', (select count(distinct install_id) from public.usage_sessions
        where started_at > v_now - interval '30 days')
    ),
    'speed', jsonb_build_object(
      'fcp50', (select percentile_cont(0.5) within group (order by fcp_ms) from win_s where fcp_ms is not null),
      'fcp75', (select percentile_cont(0.75) within group (order by fcp_ms) from win_s where fcp_ms is not null),
      'ready50', (select percentile_cont(0.5) within group (order by ready_ms) from win_s where ready_ms is not null),
      'ready75', (select percentile_cont(0.75) within group (order by ready_ms) from win_s where ready_ms is not null),
      'measured', (select count(*) from win_s where fcp_ms is not null)
    ),
    -- What people did with it in the same window, from the app's own records.
    'actions', jsonb_build_object(
      'sos', (select count(*) from public.sos_requests r where r.created_at >= v_since),
      'reports', (select count(*) from public.reports r where r.created_at >= v_since),
      'accounts', (select count(*) from public.profiles p where p.created_at >= v_since),
      'watchedPlaces', (select count(*) from public.saved_places p where p.created_at >= v_since),
      'pushSubs', (select count(*) from public.push_subscriptions p where p.created_at >= v_since),
      'lineFollows', (select count(*) from public.line_follows l
        where l.following and l.changed_at >= v_since)
    ),
    -- Alerts issued in the window, so a rise in opens can be read against them.
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('at', a.issued_at, 'level', a.level)
        order by a.issued_at), '[]')
      from public.alerts a where a.issued_at >= v_since and not a.is_drill)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.admin_usage(integer) from public, anon;
grant execute on function public.admin_usage(integer) to authenticated;
