-- Forecast rain from five weather models, and its own Watch threshold (the owner's choice,
-- 14 Oct 2026: "wettest of models").
--
-- Scored on the 2024 and 2025 floods (pipeline/thresholds/METHODS.md, "Forecast rain before the
-- floods"): every model was far too dry, so the old rule (the default model's forecast reaching the
-- rain-fallen threshold) caught 1 flood in 6. The wettest of five models each hour, 150 mm in the
-- next 72 hours, would have warned about two days ahead in Pattani and Hat Yai with one or two false
-- alarms a season. Six floods: a starting value, provisional, for an admin to change.
--
--   * `signals_fetch` asks once for the five models (`signal_feed.rain_models`) and stores the
--     default model's mean as before (`rain_1h_mm`, the chart) and the wettest model each hour
--     (`rain_1h_mm_wettest`, the forecast rule).
--   * A new threshold signal, `rain_72h_forecast_mm`, Watch only: a forecast never suggests more.
--   * `admin_signal_wettest()` hands the dashboard the wettest series per zone.

create or replace function public.signals_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'signal_feed'),
                           '{}'::jsonb);
  v_models text[] := array(select jsonb_array_elements_text(coalesce(
      (select s.value -> 'rain_models' from public.system_settings s where s.key = 'signal_feed'),
      '["best_match","ecmwf_ifs025","gfs_seamless","icon_seamless","jma_seamless"]'::jsonb)));
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
  v_cells jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', coalesce(v_feed ->> 'timeout_s', '25'));
  for v_zone in select z.id, z.basin from public.warning_zones z loop
    v_cfg := v_feed -> 'zones' -> v_zone.basin;
    continue when v_cfg is null;

    -- Rain from each model, the mean over the points hour by hour; then the default model's
    -- series and the wettest model's each hour.
    begin
      select string_agg(p ->> 1, ','), string_agg(p ->> 0, ',') into v_lats, v_lons
        from jsonb_array_elements(coalesce(v_cfg -> 'rain_points', '[]'::jsonb)) p;
      if v_lats is not null then
        select * into v_answer from extensions.http_get(
          (v_feed ->> 'rain_url') || '?latitude=' || v_lats || '&longitude=' || v_lons
          || '&hourly=precipitation&past_days=3&forecast_days=5&timezone=UTC&models='
          || array_to_string(v_models, ','));
        if v_answer.status <> 200 then
          v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' rain: http ' || v_answer.status;
        else
          v_body := v_answer.content::jsonb;
          if jsonb_typeof(v_body) <> 'array' then v_body := jsonb_build_array(v_body); end if;
          select jsonb_agg(jsonb_build_object('m', c.m, 't', c.ts, 'mm', c.mm)) into v_cells
            from (select m, t.v as ts, avg((x.v)::double precision) as mm
                    from unnest(v_models) m,
                         jsonb_array_elements(v_body) place,
                         lateral jsonb_array_elements_text(place #> '{hourly,time}') with ordinality t(v, i)
                         join lateral jsonb_array_elements_text(place -> 'hourly' -> ('precipitation_' || m)) with ordinality x(v, i) using (i)
                   group by m, t.v) c;
          select jsonb_agg(c.t order by c.t), jsonb_agg(round(c.mm::numeric, 2) order by c.t) into v_times, v_values
            from jsonb_to_recordset(v_cells) c(m text, t text, mm double precision)
           where c.m = v_models[1] and c.mm is not null;
          v_rows := v_rows + public.signal_store('open_meteo', v_zone.id, 'rain_1h_mm', v_times, v_values);
          select jsonb_agg(w.t order by w.t), jsonb_agg(round(w.mm::numeric, 2) order by w.t) into v_times, v_values
            from (select c.t, max(c.mm) as mm from jsonb_to_recordset(v_cells) c(m text, t text, mm double precision)
                   group by c.t) w
           where w.mm is not null;
          v_rows := v_rows + public.signal_store('open_meteo', v_zone.id, 'rain_1h_mm_wettest', v_times, v_values);
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

-- The wettest model's hourly rain per zone, for the dashboard. Admins only.
create function public.admin_signal_wettest() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_object_agg(z.id, coalesce((
      select jsonb_agg(jsonb_build_array(f.valid_at, f.value) order by f.valid_at)
        from public.forecasts f
       where f.zone_id = z.id and f.source = 'open_meteo' and f.variable = 'rain_1h_mm_wettest'), '[]'::jsonb))
      from public.warning_zones z), '{}'::jsonb);
end $$;
revoke all on function public.admin_signal_wettest() from public, anon;
grant execute on function public.admin_signal_wettest() to authenticated;

-- The new threshold signal may be set by hand like the others.
create or replace function public.admin_set_threshold(p_zone uuid, p_signal text, p_levels jsonb, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_old jsonb;
  v_at timestamptz := now();
begin
  perform public.admin_only();
  if p_signal not in ('rain_72h_mm', 'rain_24h_mm', 'rain_72h_forecast_mm', 'key_level_m', 'upstream_level_m') then
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
  if p_signal = 'rain_72h_forecast_mm' and p_levels ?| array['warning', 'evacuate'] then
    raise exception 'a forecast only ever suggests Watch' using errcode = 'check_violation';
  end if;
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

-- The starting value in every zone, provisional (seed 46 writes the same on a fresh database).
insert into public.thresholds (zone_id, signal, levels, provisional)
select z.id, 'rain_72h_forecast_mm', '{"watch": 150}'::jsonb, true from public.warning_zones z
on conflict (zone_id, signal) do nothing;

update public.system_settings
   set value = value || '{"rain_models": ["best_match", "ecmwf_ifs025", "gfs_seamless", "icon_seamless", "jma_seamless"]}'::jsonb
 where key = 'signal_feed';
