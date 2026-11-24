-- Keep ThaiWater's own grading of each gauge, which we were already fetching and throwing away.
--
-- 24 Nov 2026. The owner asked why the alarm was silent while rivers were up. The alarm was right:
-- nothing stood above Jaga's own Warning. What the owner was looking at was ThaiWater's own map,
-- which had 15 of our 48 stations at `situation_level` 4. Jaga could not see that at all, so the
-- two could disagree with nobody able to tell why.
--
-- The payload `gauges_fetch()` already collects every 15 minutes carries three figures per station
-- that were being dropped on the floor:
--
--   * `situation_level`  - ThaiWater's own 1-5 grade for the station;
--   * `storage_percent`  - how much of the channel's depth is filled, (level - bed) / (bank - bed);
--   * `diff_wl_bank`     - the distance to the bank, as a magnitude, with its direction in
--                          `diff_wl_bank_text` ("ต่ำกว่าตลิ่ง (ม.)" = below the bank).
--
-- **`storage_percent` is not a flood warning and must never be read as one.** It is channel
-- fullness: PAT001 reads 85.8 % while sitting 2.63 m below its bank, because its channel is 18.6 m
-- deep. A river running comfortably in a deep channel is 80-90 % "full" by that measure. It is kept
-- as the agency's own view, to be set beside Jaga's, not as a second opinion on whether to warn.
--
-- `diff_wl_bank`'s sign lives in its text, so the number is stored with the text beside it and
-- nothing here computes from it. Guessing the sign of a distance to a bank is how a gauge ends up
-- reported on the wrong side of it.
--
-- One row per station, overwritten each fetch, because this is "what does the agency say now" and
-- not a series: a row per reading would be ~830,000 rows a season on a free plan for a figure that
-- moves slowly. The last change of grade is kept (`changed_at`, `previous_level`) so a transition
-- is still visible without storing every repeat.
--
-- Advisory, like the coastal gate and the gauge recession before it. Nothing here publishes, raises
-- or suggests a level, and `auto_alarm_check()` is untouched: a level still comes only from a
-- reviewed template, and the alarm only from a gauge an admin has ticked (safety rule 2).

-------------------------------------------------------------------------------
-- 1. The table.
-------------------------------------------------------------------------------
create table public.gauge_agency_grade (
  station_id uuid primary key references public.stations (id) on delete cascade,
  -- ThaiWater's own grade, 1-5. Null when the agency publishes none: 17 of our stations are RID
  -- gauges, which carry no grade at all, and a missing grade is never an all-clear (safety rule 10).
  situation_level smallint,
  -- Its `storage_percent`: channel fullness, NOT a flood level. See the note above.
  channel_full_pct double precision,
  -- Its `diff_wl_bank`, as published: a magnitude whose direction is in `bank_distance_text`.
  bank_distance_m double precision,
  bank_distance_text text,
  -- The bank the agency is grading against, which is not always the bank `stations.warning_m` has.
  agency_bank_m double precision,
  -- The reading this grade belongs to, on the agency's own clock.
  observed_at timestamptz,
  fetched_at timestamptz not null default now(),
  -- When `situation_level` last became something different, and what it was before.
  changed_at timestamptz,
  previous_level smallint
);

comment on table public.gauge_agency_grade is
  'ThaiWater''s own grading of each river gauge, as published: its 1-5 situation level, its channel '
  'fullness and its distance to the bank. One row per station, overwritten each fetch. Advisory '
  'only - it is the agency''s view set beside Jaga''s, never an input to a level or an alarm '
  '(safety rule 2). channel_full_pct is how full the channel is, not how near a flood: a river '
  'running comfortably in a deep channel reads 80-90 %.';

alter table public.gauge_agency_grade enable row level security;

-- Admins only, matching the other advisory tables (season_state_reference, gauge_recession). There
-- is nothing sensitive here - it is published data - but it is a console cross-check, and the
-- public map says what Jaga itself grades, from one set of levels, so that readers see one answer.
create policy "gauge_agency_grade: admins read" on public.gauge_agency_grade
  for select to authenticated using (public.is_admin());
revoke all on public.gauge_agency_grade from anon, authenticated;
grant select on public.gauge_agency_grade to authenticated;

-------------------------------------------------------------------------------
-- 2. The fetch keeps them. Everything else about it is unchanged.
-------------------------------------------------------------------------------
-- Rewritten whole from `20261014061500_a8_gauges_live.sql`, which is the only migration that has
-- ever defined it (checked against the live body with pg_get_functiondef before writing this, as
-- the house habit of 19 Nov requires). The additions are the `graded` CTE and the upsert; the
-- readings, the province loop, the per-province exception block, the future/stale guards, the
-- retention delete and the feed log are byte-for-byte the same.
create or replace function public.gauges_fetch() returns integer
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
$$;
revoke all on function public.gauges_fetch() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The reader for the admins' signal dashboard.
-------------------------------------------------------------------------------
-- Jaga's own grade beside the agency's, and whether they disagree. `disagrees` is deliberately a
-- plain statement of fact - the agency calls it high and we do not, or the other way about - and
-- not a judgement about which is right: the two measure different things, and the column exists so
-- an admin can see the gap that left the owner looking at two maps with different answers.
create function public.admin_gauge_agency_grade()
returns table (
  code text,
  name jsonb,
  situation_level smallint,
  channel_full_pct double precision,
  bank_distance_m double precision,
  bank_distance_text text,
  agency_bank_m double precision,
  observed_at timestamptz,
  changed_at timestamptz,
  previous_level smallint,
  jaga_grade text,
  jaga_bank_m double precision,
  disagrees boolean
)
language sql stable security definer set search_path = '' as $$
  select s.code, s.name, g.situation_level, g.channel_full_pct, g.bank_distance_m,
         g.bank_distance_text, g.agency_bank_m, g.observed_at, g.changed_at, g.previous_level,
         case
           when l.evacuate_m is not null and o.value >= l.evacuate_m then 'above_evacuate'
           when coalesce(l.warning_m, l.evacuate_m) is not null
                and o.value >= coalesce(l.warning_m, l.evacuate_m) then 'above_warning'
           when l.watch_m is not null and o.value >= l.watch_m then 'above_watch'
           when l.watch_m is null then 'no_levels'
           else 'normal'
         end as jaga_grade,
         coalesce(l.evacuate_m, s.warning_m) as jaga_bank_m,
         -- The agency at 4 or 5 while Jaga says normal, or Jaga above a line while the agency is
         -- at 1 or 2. Null where either side has nothing to say, which is not agreement.
         case
           when g.situation_level is null or l.watch_m is null or o.value is null then null
           when g.situation_level >= 4 and o.value < l.watch_m then true
           when g.situation_level <= 2 and o.value >= l.watch_m then true
           else false
         end as disagrees
    from public.gauge_agency_grade g
    join public.stations s on s.id = g.station_id
    left join public.gauge_levels l on l.station_id = g.station_id
    left join lateral (
      select ob.value from public.observations ob
       where ob.station_id = g.station_id and ob.variable = 'water_level_msl' and ob.value is not null
       order by ob.ts desc limit 1) o on true
   where public.is_admin()
   order by g.situation_level desc nulls last, s.code
$$;
revoke all on function public.admin_gauge_agency_grade() from public, anon;
grant execute on function public.admin_gauge_agency_grade() to authenticated;
