-- A12 part 1 (fix 2): read the dam's hourly series, not its daily snapshot.
--
-- dam_fetch() read ThaiWater's /analyst/dam, which turns out to carry **one row a day** for this
-- dam: checked on 10 Oct 2026, it answered with the 00:00 reading and nothing since. Storing one
-- reading a day would have made the confirmation rule take two days to confirm a release, and
-- the rate of rise meaningless. So it now reads /analyst/dam_hourly_graph, which returns the
-- real hourly series and lets a later run fill in hours that were not published yet.
--
-- The other thing that check showed: the feed lags. At 06:00 Bangkok the newest hour published
-- was 00:00 and the hours between were missing. This is a record that trails reality by hours,
-- not a real-time release warning - which is why the app always shows the reading's own time and
-- age, and why the dam operator's own screen (spec section 15) is the thing that would actually
-- give a warning in time. stale_after_h moves from 6 to 12 so that "stale" still means
-- something; the age itself is always on screen.
--
-- Its dates carry a "Z" but are Bangkok clock times, as everywhere else in this API.

update public.system_settings
   set value = value
     || '{"graph_url": "https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam_hourly_graph",
          "days": 3}'::jsonb,
       updated_at = now()
 where key = 'dam_feed';

-- Only if an admin has not already chosen their own number.
update public.system_settings
   set value = jsonb_set(value, '{stale_after_h}', '12'::jsonb), updated_at = now()
 where key = 'dam_grades' and value ->> 'stale_after_h' = '6';

create or replace function public.dam_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_url text := v_feed ->> 'graph_url';
  v_timeout text := coalesce(v_feed ->> 'timeout_s', '25');
  v_days integer := coalesce((v_feed ->> 'days')::integer, 3);
  -- ThaiWater's data_type -> our column. Its hourly flows are million m3 in that hour.
  v_types jsonb := '{"dam_storage": "storage_mcm", "dam_level": "level_m",
                     "dam_inflow": "inflow_mcm_h", "dam_released": "released_mcm_h",
                     "dam_spilled": "spilled_mcm_h"}'::jsonb;
  v_dam record;
  v_type text;
  v_answer extensions.http_response;
  v_series jsonb;
  v_points jsonb;
  v_rows integer := 0;
  v_stored integer;
  v_status integer;
  v_failed text;
  v_signal record;
  -- Bangkok, so the window matches the days the feed is keyed by.
  v_from date := ((now() at time zone 'Asia/Bangkok')::date - (v_days - 1));
  v_to date := ((now() at time zone 'Asia/Bangkok')::date + 1);
begin
  if v_url is null then
    insert into public.dam_feed_log (ok, error) values (false, 'no graph_url in dam_feed');
    return 0;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', v_timeout);

  for v_dam in select code, thaiwater_hourly_id from public.dams
                where thaiwater_hourly_id is not null loop
    v_series := '{}'::jsonb;
    for v_type in select jsonb_object_keys(v_types) loop
      begin
        select * into v_answer from extensions.http_get(
          v_url || '?dam_id=' || v_dam.thaiwater_hourly_id
                || '&data_type=' || v_type
                || '&start_date=' || to_char(v_from, 'YYYY-MM-DD')
                || '&end_date=' || to_char(v_to, 'YYYY-MM-DD'));
      exception when others then
        v_failed := coalesce(v_failed || '; ', '') || v_type || ': ' || left(sqlerrm, 120);
        continue;
      end;
      v_status := v_answer.status;
      if v_answer.status <> 200 then
        v_failed := coalesce(v_failed || '; ', '') || v_type || ': http ' || v_answer.status;
        continue;
      end if;
      begin
        -- Every year block the answer carries, flattened into one list of points.
        select coalesce(jsonb_agg(point), '[]'::jsonb) into v_points
          from jsonb_array_elements(
                 coalesce(v_answer.content::jsonb #> '{data,graph_data}', '[]'::jsonb)) as block,
               jsonb_array_elements(coalesce(block -> 'data', '[]'::jsonb)) as point;
      exception when others then
        v_failed := coalesce(v_failed || '; ', '') || v_type || ': not JSON';
        continue;
      end;
      v_series := v_series || jsonb_build_object(v_types ->> v_type, v_points);
    end loop;

    if v_series = '{}'::jsonb then
      continue;
    end if;

    -- One row per hour, with each variable in its own column. A null value is left null rather
    -- than written as zero: "not published" and "no water" are not the same thing.
    with points as (
      select (replace(point ->> 'date', 'Z', '')::timestamp at time zone 'Asia/Bangkok') as ts,
             k.column_name, (point ->> 'value')::double precision as value
        from jsonb_each(v_series) as k(column_name, payload),
             jsonb_array_elements(payload) as point
       where point ->> 'value' is not null and point ->> 'date' is not null
    ),
    hourly as (
      select ts,
             max(value) filter (where column_name = 'storage_mcm') as storage_mcm,
             max(value) filter (where column_name = 'level_m') as level_m,
             max(value) filter (where column_name = 'inflow_mcm_h') as inflow_mcm_h,
             max(value) filter (where column_name = 'released_mcm_h') as released_mcm_h,
             max(value) filter (where column_name = 'spilled_mcm_h') as spilled_mcm_h
        from points group by ts
    )
    insert into public.dam_readings (dam_code, observed_at, storage_mcm, level_m,
                                     inflow_mcm_h, released_mcm_h, spilled_mcm_h)
    select v_dam.code, ts, storage_mcm, level_m, inflow_mcm_h, released_mcm_h, spilled_mcm_h
      from hourly
    on conflict (dam_code, observed_at) do update set
      storage_mcm = coalesce(excluded.storage_mcm, public.dam_readings.storage_mcm),
      level_m = coalesce(excluded.level_m, public.dam_readings.level_m),
      inflow_mcm_h = coalesce(excluded.inflow_mcm_h, public.dam_readings.inflow_mcm_h),
      released_mcm_h = coalesce(excluded.released_mcm_h, public.dam_readings.released_mcm_h),
      spilled_mcm_h = coalesce(excluded.spilled_mcm_h, public.dam_readings.spilled_mcm_h),
      fetched_at = now();
    get diagnostics v_stored = row_count;
    v_rows := v_rows + coalesce(v_stored, 0);

    select * into v_signal from public.dam_signal(v_dam.code);
    if v_signal.grade = 'releasing' then
      -- One notice per episode: a second reading of the same release gives an admin nothing new
      -- to decide, it is the same event still waiting on the same judgement.
      if not exists (select 1 from public.dam_notices n
                      where n.dam_code = v_dam.code and n.status in ('open', 'sent')) then
        insert into public.dam_notices (dam_code, observed_at, grade, reasons, figures)
          values (v_dam.code, v_signal.observed_at, v_signal.grade, v_signal.reasons,
                  to_jsonb(v_signal));
      end if;
    elsif v_signal.grade = 'quiet' then
      -- Kept, marked ended: what happened and whether anyone acted on it is the record (spec 16).
      update public.dam_notices set status = 'ended', ended_at = now()
       where dam_code = v_dam.code and status = 'open';
    end if;
  end loop;

  insert into public.dam_feed_log (ok, http_status, rows_stored, error)
    values (v_failed is null, v_status, v_rows, v_failed);
  -- A log for seeing the feed is alive, not a second archive.
  delete from public.dam_feed_log where id < (select max(id) - 500 from public.dam_feed_log);
  return v_rows;
end $$;
revoke execute on function public.dam_fetch() from public, anon, authenticated;
