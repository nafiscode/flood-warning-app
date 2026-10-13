-- A8, first slice: the river gauges, live.
--
-- Until now only the dam was fetched (hourly). The gauges were collected weekly into the science
-- archive and the app's `stations` and `observations` tables were empty, so the map had no gauge
-- to show. This fetches ThaiWater's latest reading for every gauge in the four provinces every
-- 15 minutes, with the same pattern as the dam: a database job, no Edge Function, no secret.
--
--   * ThaiWater publishes the latest value per station, with its own time (Bangkok clock). The
--     series here therefore grows one reading at a time; the feed often lags by an hour or more,
--     and `station_status` already calls a gauge silent after six hours (safety rule 3's habit).
--   * Nothing here grades a flood or suggests a level. The thresholds from the hindcast are
--     loaded by the seed (provisional) and read by the admins' signal dashboard, which only ever
--     suggests (safety rule 2).

alter table public.stations
  add column if not exists thaiwater_id bigint,
  add column if not exists agency text;
create unique index if not exists stations_thaiwater_id_idx on public.stations (thaiwater_id)
  where thaiwater_id is not null;

insert into public.system_settings (key, value, note) values
  ('gauge_feed',
   '{"url": "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load", "provinces": ["90", "94", "95", "96"], "timeout_s": 25, "keep_days": 90, "max_age_days": 7}'::jsonb,
   'Where the river gauges'' latest readings come from, which provinces are asked for, and how long readings are kept. Fetched every 15 minutes by gauges_fetch().')
  on conflict (key) do nothing;

create table public.gauge_feed_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  http_status integer,
  rows_stored integer,
  stations_seen integer,
  error text
);
alter table public.gauge_feed_log enable row level security;
create policy "gauge_feed_log: admins read" on public.gauge_feed_log for select to authenticated
  using (public.is_admin());
revoke insert, update, delete, truncate on public.gauge_feed_log from anon, authenticated;

create function public.gauges_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
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
               nullif(r ->> 'discharge', '')::double precision as flow
          from jsonb_array_elements(
                 coalesce(v_answer.content::jsonb #> '{waterlevel_data,data}', '[]'::jsonb)) r
         where r #>> '{station,id}' is not null and r ->> 'waterlevel_datetime' is not null
      ), ours as (
        select s.id, x.ts, x.level, x.flow
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
$$;
revoke all on function public.gauges_fetch() from public, anon, authenticated;

select cron.schedule('jaga-gauge-readings', '3-59/15 * * * *', 'select public.gauges_fetch()');
