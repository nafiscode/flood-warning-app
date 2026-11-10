-- The rain already fallen, day by day: what the season-state block needs (science plan Module 11).
--
-- `signals_fetch` asked Open-Meteo for three days of hourly rain behind and five ahead, which is
-- the right window for the 24- and 72-hour thresholds and no use at all for "how wet is this
-- catchment already". This adds one more request per zone in the same hourly round: daily
-- precipitation over the last ninety-two days, stored as `rain_1d_mm`, from which the fifteen-day
-- and thirty-day totals and the running total since the first of October are read against the
-- terciles in `season_rain`.
--
-- Nothing else changes. The block has its own exception handler like the other three, so a failure
-- here cannot cost the hourly rain, the discharge or the tide; and it stores a figure, not a
-- judgement - no threshold, no level, no alert (safety rule 2).

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

    -- Rain already fallen, day by day, back to the start of the season. The hourly series above
    -- reaches three days back, which cannot answer "how wet is this catchment already": the
    -- fifteen-day and thirty-day totals and the running total since the first of October are read
    -- against the terciles in season_rain (science plan Module 11). About ninety-three daily
    -- values per zone, asked for in the same hourly round as the rest.
    --
    -- Days are Bangkok days, because that is the day the terciles are built on and the day an
    -- admin lives in. `valid_at` is therefore that Bangkok date at midnight UTC: a label for the
    -- day, not an instant.
    begin
      select string_agg(p ->> 1, ','), string_agg(p ->> 0, ',') into v_lats, v_lons
        from jsonb_array_elements(coalesce(v_cfg -> 'rain_points', '[]'::jsonb)) p;
      if v_lats is not null then
        select * into v_answer from extensions.http_get(
          (v_feed ->> 'rain_url') || '?latitude=' || v_lats || '&longitude=' || v_lons
          || '&daily=precipitation_sum&past_days=92&forecast_days=1&timezone=Asia%2FBangkok');
        if v_answer.status <> 200 then
          v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' daily rain: http ' || v_answer.status;
        else
          v_body := v_answer.content::jsonb;
          if jsonb_typeof(v_body) <> 'array' then v_body := jsonb_build_array(v_body); end if;
          select jsonb_agg(c.t order by c.t), jsonb_agg(round(c.mm::numeric, 2) order by c.t)
            into v_times, v_values
            from (select t.v as t, avg((x.v)::double precision) as mm
                    from jsonb_array_elements(v_body) place,
                         lateral jsonb_array_elements_text(place #> '{daily,time}') with ordinality t(v, i)
                         join lateral jsonb_array_elements_text(place -> 'daily' -> 'precipitation_sum') with ordinality x(v, i) using (i)
                   group by t.v) c
           where c.mm is not null;
          v_rows := v_rows + public.signal_store('open_meteo', v_zone.id, 'rain_1d_mm', v_times, v_values);
        end if;
      end if;
    exception when others then
      v_failed := coalesce(v_failed || '; ', '') || v_zone.basin || ' daily rain: ' || left(sqlerrm, 120);
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
