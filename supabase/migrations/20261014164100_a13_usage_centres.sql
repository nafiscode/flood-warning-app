-- The usage dashboard asks every 30 seconds; working out a point inside all 377 tambons took
-- about 0.65 s of each read. Only the tambons that appear in the answer (chosen areas, watched
-- places, homes) need one.

create or replace function public.admin_usage(p_days integer default 30) returns jsonb
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
    where t.code in (
      select d.tambon from public.usage_devices d where d.tambon is not null
      union select sp.tambon from public.saved_places sp where sp.tambon is not null
      union select pr.home_tambon from public.profiles pr where pr.home_tambon is not null
    )
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
