-- gauges_fetch() stops rewriting a reading that has not changed (the owner, 28 Nov 2026, asked what
-- eats the free plans).
--
-- The feed answers every fifteen minutes with each station's LATEST reading. A station reports
-- about hourly, so three answers in four repeat a reading already stored, and the upsert wrote it
-- again: a new row version, two index entries and the write-ahead log, for the same number
-- (observations: 146,000 updates against 127,000 inserts since the counters began). The upsert now
-- updates only when the value differs.
--
-- Measured, so it is not oversold: the steady writes of this function are about 40 MB a day, a
-- fraction of one percent of what the free instance's disk can take. This is tidiness that also
-- keeps the table from bloating, not the cure for the Disk IO warning.
--
-- What does NOT change: a reading with a new timestamp is inserted, a corrected value for the
-- same timestamp is updated, the agency's grade is still stamped `fetched_at` on every answer
-- (that is how the page knows the feed is alive), and nothing reads `rows_stored` for a decision:
-- it counts rows written, so a repeat now logs 0 for those. The two things the automated alarm
-- reads, the two latest readings and how recent they are, are the same rows as before.
--
-- Everything else is the live definition (`pg_get_functiondef`, 28 Nov 2026), unchanged.

CREATE OR REPLACE FUNCTION public.gauges_fetch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'gauge_feed'),
                           '{}'::jsonb);
  v_url text := v_feed ->> 'url';
  v_timeout text := coalesce(v_feed ->> 'timeout_s', '25');
  v_keep integer := coalesce((v_feed ->> 'keep_days')::integer, 90);
  v_max_age integer := coalesce((v_feed ->> 'max_age_days')::integer, 7);
  v_province text;
  v_answer extensions.http_response;
  v_rows integer := 0;
  v_seen integer := 0;
  v_n integer;
  v_status integer;
  v_failed text;
begin
  if v_url is null then
    insert into public.gauge_feed_log (ok, error) values (false, 'no url in the gauge_feed setting');
    return 0;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', v_timeout);

  for v_province in select jsonb_array_elements_text(coalesce(v_feed -> 'provinces', '[]'::jsonb)) loop
    begin
      select * into v_answer from extensions.http_get(v_url || '?province_code=' || v_province);
      v_status := v_answer.status;
      if v_answer.status <> 200 then
        v_failed := coalesce(v_failed || '; ', '') || v_province || ': http ' || v_answer.status;
        continue;
      end if;
      -- One row per station that reported: its own time (Bangkok clock), level and flow.
      with reported as (
        select (r #>> '{station,id}')::bigint as thaiwater_id,
               ((r ->> 'waterlevel_datetime') || ':00')::timestamp at time zone 'Asia/Bangkok' as ts,
               nullif(r ->> 'waterlevel_msl', '')::double precision as level,
               nullif(r ->> 'discharge', '')::double precision as flow,
               -- The agency's own grading, kept as published and never computed from.
               nullif(r ->> 'situation_level', '')::smallint as grade,
               nullif(r ->> 'storage_percent', '')::double precision as full_pct,
               nullif(r ->> 'diff_wl_bank', '')::double precision as bank_gap,
               nullif(r ->> 'diff_wl_bank_text', '') as bank_gap_text,
               nullif(r #>> '{station,min_bank}', '')::double precision as agency_bank
          from jsonb_array_elements(
                 coalesce(v_answer.content::jsonb #> '{waterlevel_data,data}', '[]'::jsonb)) r
         where r #>> '{station,id}' is not null and r ->> 'waterlevel_datetime' is not null
      ), ours as (
        select s.id, x.ts, x.level, x.flow, x.grade, x.full_pct, x.bank_gap, x.bank_gap_text,
               x.agency_bank
          from reported x
          join public.stations s on s.thaiwater_id = x.thaiwater_id
         -- A reading from the future or from long ago is the feed's mistake, not a measurement.
         where x.ts <= now() + interval '1 hour' and x.ts >= now() - make_interval(days => v_max_age)
      ), stored as (
        insert into public.observations (station_id, ts, variable, value)
        select id, ts, 'water_level_msl', level from ours where level is not null
        union all
        select id, ts, 'discharge', flow from ours where flow is not null
        on conflict (station_id, variable, ts) do update set value = excluded.value
          where public.observations.value is distinct from excluded.value
        returning 1
      ), graded as (
        insert into public.gauge_agency_grade as g
          (station_id, situation_level, channel_full_pct, bank_distance_m, bank_distance_text,
           agency_bank_m, observed_at, fetched_at, changed_at, previous_level)
        select id, grade, full_pct, bank_gap, bank_gap_text, agency_bank, ts, now(),
               case when grade is null then null else now() end, null
          from ours
        on conflict (station_id) do update
          set situation_level = excluded.situation_level,
              channel_full_pct = excluded.channel_full_pct,
              bank_distance_m = excluded.bank_distance_m,
              bank_distance_text = excluded.bank_distance_text,
              agency_bank_m = excluded.agency_bank_m,
              observed_at = excluded.observed_at,
              fetched_at = excluded.fetched_at,
              -- Only a real change of grade moves these; a repeat of the same grade leaves the
              -- last transition where it was, which is the whole reason for keeping them.
              changed_at = case
                when excluded.situation_level is distinct from g.situation_level then now()
                else g.changed_at end,
              previous_level = case
                when excluded.situation_level is distinct from g.situation_level then g.situation_level
                else g.previous_level end
        returning 1
      )
      select (select count(*) from stored), (select count(*) from ours) into v_n, v_seen;
      v_rows := v_rows + coalesce(v_n, 0);
    exception when others then
      v_failed := coalesce(v_failed || '; ', '') || v_province || ': ' || left(sqlerrm, 160);
    end;
  end loop;

  delete from public.observations where ts < now() - make_interval(days => v_keep);
  insert into public.gauge_feed_log (ok, http_status, rows_stored, stations_seen, error)
    values (v_failed is null, v_status, v_rows, v_seen, v_failed);
  delete from public.gauge_feed_log where at < now() - interval '30 days';
  return v_rows;
end;
$function$;
