-- A12 (addition, 12 Oct 2026, the owner's request): the last fortnight day by day, so that a
-- release that has been growing for days can be seen growing rather than read one hour at a time.
--
-- "People can see if it's continuously increased for few days or a week" (the owner). A single
-- hour cannot show that, and neither can yesterday's mean on its own: it takes the run of days.
--
-- Three things this file does:
--
--   * `dam_days()` - one row per Bangkok calendar day, with the mean release, the mean spill and
--     the volumes behind them. Every day in the window is returned, including days with no
--     readings at all: a gap in the feed must look like a gap, not like a quiet day.
--   * `dam_fetch_range()` - the fetch-and-store half of `dam_fetch()`, lifted out so that the
--     archive can be filled for any window without a second copy of the parsing to drift.
--     `dam_fetch()` keeps its own behaviour: its window from the settings, then the grade and the
--     notice for the admins. Nothing about the hourly job changes.
--   * `dam_state()` gains `days`, so the app still makes one read.
--
-- As everywhere in this feed: a mean is over the hours that exist, the count travels with it, and
-- nothing here grades, alerts or sends (safety rules 2 and 8).

-------------------------------------------------------------------------------
-- The fetch, for any window. Returns the rows stored. Raises no notice: a backfill of old hours
-- must never wake an admin about a release that ended years ago.
-------------------------------------------------------------------------------
create function public.dam_fetch_range(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_url text := v_feed ->> 'graph_url';
  v_timeout text := coalesce(v_feed ->> 'timeout_s', '25');
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
                || '&start_date=' || to_char(p_from, 'YYYY-MM-DD')
                || '&end_date=' || to_char(p_to, 'YYYY-MM-DD'));
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
  end loop;

  insert into public.dam_feed_log (ok, http_status, rows_stored, error)
    values (v_failed is null, v_status, v_rows, v_failed);
  return v_rows;
end $$;
revoke execute on function public.dam_fetch_range(date, date) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The hourly job, now one window's fetch plus the grade and the admins' notice. Same behaviour as
-- before; the parsing simply lives in one place.
-------------------------------------------------------------------------------
create or replace function public.dam_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_days integer := coalesce((v_feed ->> 'days')::integer, 3);
  -- Bangkok, so the window matches the days the feed is keyed by.
  v_from date := ((now() at time zone 'Asia/Bangkok')::date - (v_days - 1));
  v_to date := ((now() at time zone 'Asia/Bangkok')::date + 1);
  v_rows integer;
  v_dam record;
  v_signal record;
begin
  v_rows := public.dam_fetch_range(v_from, v_to);

  for v_dam in select code from public.dams where thaiwater_hourly_id is not null loop
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
      -- The release is over: an open notice is closed so the war room does not keep asking.
      update public.dam_notices
         set status = 'ended', ended_at = now()
       where dam_code = v_dam.code and status = 'open';
    end if;
  end loop;
  return v_rows;
end $$;

-------------------------------------------------------------------------------
-- The fortnight, day by day.
-------------------------------------------------------------------------------
create function public.dam_days(p_dam text, p_days integer default 14)
returns table (
  day date,
  -- Hourly readings behind this day's figures. Zero means the feed published nothing for it,
  -- which is why every day in the window is returned rather than only the days with data.
  hours integer,
  released_mean_cms double precision,
  spilled_mean_cms double precision,
  outflow_mean_cms double precision,
  outflow_mcm double precision,
  spilled_mcm double precision,
  -- Where the reservoir stood at the end of the day, for the trend behind the releases.
  storage_end_mcm double precision,
  level_end_m double precision
)
language sql stable security definer set search_path = '' as $$
  with newest as (
    select (max(r.observed_at) at time zone 'Asia/Bangkok')::date as last_day
      from public.dam_readings r where r.dam_code = p_dam
  ),
  span as (
    select generate_series(n.last_day - (greatest(p_days, 1) - 1), n.last_day,
                           interval '1 day')::date as day
      from newest n where n.last_day is not null
  ),
  by_day as (
    select (r.observed_at at time zone 'Asia/Bangkok')::date as day,
           count(*) filter (where r.released_mcm_h is not null
                              or r.spilled_mcm_h is not null)::integer as hours,
           sum(r.released_mcm_h) as released_mcm,
           sum(r.spilled_mcm_h) as spilled_mcm,
           sum(coalesce(r.released_mcm_h, 0) + coalesce(r.spilled_mcm_h, 0))
             filter (where r.released_mcm_h is not null or r.spilled_mcm_h is not null)
             as outflow_mcm,
           (array_agg(r.storage_mcm order by r.observed_at desc)
              filter (where r.storage_mcm is not null))[1] as storage_end_mcm,
           (array_agg(r.level_m order by r.observed_at desc)
              filter (where r.level_m is not null))[1] as level_end_m
      from public.dam_readings r
     where r.dam_code = p_dam
     group by 1
  )
  select s.day,
         coalesce(d.hours, 0),
         -- Means over the hours that exist, as cubic metres a second.
         case when coalesce(d.hours, 0) > 0
              then d.released_mcm * 1000000.0 / (d.hours * 3600.0) end,
         case when coalesce(d.hours, 0) > 0
              then d.spilled_mcm * 1000000.0 / (d.hours * 3600.0) end,
         case when coalesce(d.hours, 0) > 0
              then d.outflow_mcm * 1000000.0 / (d.hours * 3600.0) end,
         d.outflow_mcm,
         d.spilled_mcm,
         d.storage_end_mcm,
         d.level_end_m
    from span s left join by_day d on d.day = s.day
   order by s.day
$$;
grant execute on function public.dam_days(text, integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- One read for the app: the dam, the hour, the day, and now the fortnight.
-------------------------------------------------------------------------------
drop function public.dam_state(text);
create function public.dam_state(p_source text default 'osm')
returns table (
  code text, name jsonb, river jsonb, operator text,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_note jsonb, signal json, daily json, days json
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator, d.storage_max_mcm, d.storage_normal_mcm,
         d.geometry_note,
         (select row_to_json(s) from public.dam_signal(d.code) s),
         (select row_to_json(x) from public.dam_daily(d.code) x),
         (select coalesce(json_agg(h), '[]'::json) from public.dam_days(d.code) h)
    from public.dams d
   where d.geometry_source = p_source
$$;
grant execute on function public.dam_state(text) to anon, authenticated;
