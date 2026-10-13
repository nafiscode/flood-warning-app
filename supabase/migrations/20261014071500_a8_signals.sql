-- A8, second slice: forecast rain, modelled discharge and the tide per warning zone, the read the
-- admins' signal dashboard is drawn from, and changing a threshold by hand.
--
--   * Three free Open-Meteo services, asked once an hour by a database job like the gauges': rain
--     (its best-match weather model, three days back and five ahead, averaged over points spread
--     across the zone's catchment), river discharge (GloFAS, a week back and a week ahead, at the
--     cell chosen in the hindcast) and sea level at the river's mouth. No key, no account.
--   * The rain the thresholds were set on is satellite rain (GSMaP). What is fetched here is a
--     weather model's rain. They are not the same measurement and the dashboard says so.
--   * Nothing here grades anything. `admin_signals` hands the figures to the dashboard, which
--     works out a *suggested* level and shows its reasons; only a person publishes (safety rule 2).

create table public.signal_feed_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  rows_stored integer,
  error text
);
alter table public.signal_feed_log enable row level security;
create policy "signal_feed_log: admins read" on public.signal_feed_log for select to authenticated
  using (public.is_admin());
revoke insert, update, delete, truncate on public.signal_feed_log from anon, authenticated;

-- One series of one source for one zone: the old rows go and the new ones come in together.
create function public.signal_store(p_source text, p_zone uuid, p_variable text, p_times jsonb, p_values jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.forecasts where source = p_source and zone_id = p_zone and variable = p_variable;
  insert into public.forecasts (source, zone_id, issued_at, valid_at, variable, value)
  select p_source, p_zone, now(), (t.v)::timestamp at time zone 'UTC', p_variable, (x.v)::double precision
    from jsonb_array_elements_text(p_times) with ordinality t(v, i)
    join jsonb_array_elements_text(p_values) with ordinality x(v, i) using (i)
   where x.v is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.signal_store(text, uuid, text, jsonb, jsonb) from public, anon, authenticated;

create function public.signals_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'signal_feed'),
                           '{}'::jsonb);
  v_zone record;
  v_cfg jsonb;
  v_answer extensions.http_response;
  v_body jsonb;
  v_times jsonb;
  v_values jsonb;
  v_rows integer := 0;
  v_failed text;
  v_lats text;
  v_lons text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', coalesce(v_feed ->> 'timeout_s', '25'));
  for v_zone in select z.id, z.basin from public.warning_zones z loop
    v_cfg := v_feed -> 'zones' -> v_zone.basin;
    continue when v_cfg is null;

    -- Rain: the mean over the points, hour by hour.
    begin
      select string_agg(p ->> 1, ','), string_agg(p ->> 0, ',') into v_lats, v_lons
        from jsonb_array_elements(coalesce(v_cfg -> 'rain_points', '[]'::jsonb)) p;
      if v_lats is not null then
        select * into v_answer from extensions.http_get(
          (v_feed ->> 'rain_url') || '?latitude=' || v_lats || '&longitude=' || v_lons
          || '&hourly=precipitation&past_days=3&forecast_days=5&timezone=UTC');
        if v_answer.status <> 200 then
          v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' rain: http ' || v_answer.status;
        else
          v_body := v_answer.content::jsonb;
          if jsonb_typeof(v_body) <> 'array' then v_body := jsonb_build_array(v_body); end if;
          with cells as (
            select t.v as ts, avg((x.v)::double precision) as mm
              from jsonb_array_elements(v_body) place,
                   lateral jsonb_array_elements_text(place #> '{hourly,time}') with ordinality t(v, i)
                   join lateral jsonb_array_elements_text(place #> '{hourly,precipitation}') with ordinality x(v, i) using (i)
             group by t.v
          )
          select jsonb_agg(ts order by ts), jsonb_agg(round(mm::numeric, 2) order by ts) into v_times, v_values from cells;
          v_rows := v_rows + public.signal_store('open_meteo', v_zone.id, 'rain_1h_mm', v_times, v_values);
        end if;
      end if;
    exception when others then
      v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' rain: ' || left(sqlerrm, 120);
    end;

    -- Modelled discharge at the zone's key gauge.
    begin
      if v_cfg -> 'glofas' is not null then
        select * into v_answer from extensions.http_get(
          (v_feed ->> 'flood_url') || '?latitude=' || (v_cfg -> 'glofas' ->> 1) || '&longitude=' || (v_cfg -> 'glofas' ->> 0)
          || '&daily=river_discharge&past_days=7&forecast_days=7');
        if v_answer.status <> 200 then
          v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' discharge: http ' || v_answer.status;
        else
          v_body := v_answer.content::jsonb;
          v_rows := v_rows + public.signal_store('glofas', v_zone.id, 'discharge_cms',
                                                 v_body #> '{daily,time}', v_body #> '{daily,river_discharge}');
        end if;
      end if;
    exception when others then
      v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' discharge: ' || left(sqlerrm, 120);
    end;

    -- Sea level at the river's mouth.
    begin
      if v_cfg -> 'tide' is not null then
        select * into v_answer from extensions.http_get(
          (v_feed ->> 'marine_url') || '?latitude=' || (v_cfg -> 'tide' ->> 1) || '&longitude=' || (v_cfg -> 'tide' ->> 0)
          || '&hourly=sea_level_height_msl&past_days=1&forecast_days=5&timezone=UTC');
        if v_answer.status <> 200 then
          v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' tide: http ' || v_answer.status;
        else
          v_body := v_answer.content::jsonb;
          v_rows := v_rows + public.signal_store('open_meteo_marine', v_zone.id, 'sea_level_m',
                                                 v_body #> '{hourly,time}', v_body #> '{hourly,sea_level_height_msl}');
        end if;
      end if;
    exception when others then
      v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' tide: ' || left(sqlerrm, 120);
    end;
  end loop;

  insert into public.signal_feed_log (ok, rows_stored, error) values (v_failed is null, v_rows, v_failed);
  delete from public.signal_feed_log where at < now() - interval '30 days';
  return v_rows;
end $$;
revoke all on function public.signals_fetch() from public, anon, authenticated;

select cron.schedule('jaga-signal-forecasts', '11 * * * *', 'select public.signals_fetch()');

-------------------------------------------------------------------------------
-- Everything the signal dashboard draws, in one read. Admins only.
-------------------------------------------------------------------------------
create function public.admin_signals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'signal_feed'),
                           '{}'::jsonb);
  v_out jsonb;
begin
  perform public.admin_only();
  select jsonb_build_object(
    'now', now(),
    'feeds', jsonb_build_object(
      'gauges', (select to_jsonb(g) from (select at, ok, error from public.gauge_feed_log order by id desc limit 1) g),
      'signals', (select to_jsonb(f) from (select at, ok, error from public.signal_feed_log order by id desc limit 1) f)),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'basin', z.basin, 'name', z.name,
        'roles', coalesce(v_feed -> 'zones' -> z.basin -> 'gauges', '{}'::jsonb),
        'thresholds', coalesce((
          select jsonb_agg(jsonb_build_object('signal', t.signal, 'levels', t.levels, 'provisional', t.provisional,
                                              'updatedAt', t.updated_at) order by t.signal)
            from public.thresholds t where t.zone_id = z.id), '[]'::jsonb),
        'gauges', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'code', s.code, 'thaiwaterId', s.thaiwater_id, 'name', s.name, 'agency', s.agency,
                   'bank', s.warning_m, 'watch', s.watch_m,
                   'series', coalesce((
                     select jsonb_agg(jsonb_build_array(o.ts, o.value) order by o.ts)
                       from public.observations o
                      where o.station_id = s.id and o.variable = 'water_level_msl'
                        and o.ts >= now() - interval '96 hours'), '[]'::jsonb)) order by s.code)
            from public.stations s where s.zone_id = z.id), '[]'::jsonb),
        'rain', coalesce((
          select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f
           where f.zone_id = z.id and f.source = 'open_meteo' and f.variable = 'rain_1h_mm'), '[]'::jsonb),
        'discharge', coalesce((
          select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f
           where f.zone_id = z.id and f.source = 'glofas' and f.variable = 'discharge_cms'), '[]'::jsonb),
        'tide', coalesce((
          select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
            from public.forecasts f
           where f.zone_id = z.id and f.source = 'open_meteo_marine' and f.variable = 'sea_level_m'), '[]'::jsonb),
        'issuedAt', (select max(f.issued_at) from public.forecasts f where f.zone_id = z.id)
      ) order by z.basin)
      from public.warning_zones z), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke all on function public.admin_signals() from public, anon;
grant execute on function public.admin_signals() to authenticated;

-------------------------------------------------------------------------------
-- An admin changes a threshold by hand. It stops being provisional, the hindcast's next seed
-- leaves it alone, and the change is logged.
-------------------------------------------------------------------------------
create function public.admin_set_threshold(p_zone uuid, p_signal text, p_levels jsonb, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_old jsonb;
  v_at timestamptz := now();
begin
  perform public.admin_only();
  if p_signal not in ('rain_72h_mm', 'rain_24h_mm', 'key_level_m', 'upstream_level_m') then
    raise exception 'unknown signal' using errcode = 'check_violation';
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'object' or p_levels = '{}'::jsonb then
    raise exception 'a threshold needs at least one level' using errcode = 'check_violation';
  end if;
  for v_key in select jsonb_object_keys(p_levels) loop
    if v_key not in ('watch', 'warning', 'evacuate') or jsonb_typeof(p_levels -> v_key) <> 'number'
       or (p_levels ->> v_key)::double precision <= 0 then
      raise exception 'levels are watch, warning or evacuate, each a number above nought' using errcode = 'check_violation';
    end if;
  end loop;
  if not exists (select 1 from public.warning_zones z where z.id = p_zone) then
    raise exception 'no such zone' using errcode = 'no_data_found';
  end if;
  select t.levels into v_old from public.thresholds t where t.zone_id = p_zone and t.signal = p_signal;
  insert into public.thresholds (zone_id, signal, levels, provisional, set_by, updated_at)
    values (p_zone, p_signal, p_levels, false, auth.uid(), v_at)
    on conflict (zone_id, signal) do update
      set levels = excluded.levels, provisional = false, set_by = excluded.set_by, updated_at = excluded.updated_at;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'threshold_set', 'warning_zones', p_zone,
            jsonb_build_object('signal', p_signal, 'from', v_old, 'to', p_levels, 'note', p_note));
  return v_at;
end $$;
revoke all on function public.admin_set_threshold(uuid, text, jsonb, text) from public, anon;
grant execute on function public.admin_set_threshold(uuid, text, jsonb, text) to authenticated;
