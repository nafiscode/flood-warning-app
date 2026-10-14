-- Every reservoir that matters to the flood, not only Bang Lang (the owner, 14 Oct 2026).
--
-- ThaiWater serves five more in the four provinces, all the Royal Irrigation Department's, and
-- they differ from Bang Lang in two ways that reach into every function here:
--
--   1. **They publish once a day, not once an hour.** A reading now says how long it covers
--      (`window_h`), so a day's volume is not mistaken for an hour's. Everything that turns a
--      volume into a flow, or counts hours behind a mean, reads that column.
--   2. **Bang Lang's grade rules are its own numbers** - 160 m3/s of turbines, 500 m3/s of inflow,
--      4 Mm3/h of rise - and mean nothing for a 6 Mm3 reservoir. Each dam may now carry its own
--      rules in `dams.grades`, merged over the shared defaults, so one dam's thresholds can never
--      silently grade another.
--
-- What has not changed: code still only grades, and only a person sends a notice (safety rule 2).

-------------------------------------------------------------------------------
-- 1. What a dam is, and how it reports
-------------------------------------------------------------------------------
alter table public.dams
  -- 'hourly' is ThaiWater's dam_hourly_graph (EGAT's dams); 'daily' is the figure the RID
  -- publishes once a day in the /analyst/dam answer, which has no history endpoint at all.
  add column if not exists feed text not null default 'hourly'
    check (feed in ('hourly', 'daily')),
  -- Merged over system_settings.dam_grades. Null means the shared defaults, which are Bang Lang's.
  add column if not exists grades jsonb;

comment on column public.dams.grades is
  'Grade rules for this dam alone, merged over system_settings.dam_grades. Keys: turbine_max_cms, '
  'inflow_high_cms, rise_mcm_per_h, rise_window_h, stale_after_h, min_consecutive_h, '
  'release_reason (above_turbines | release_high).';

alter table public.dam_readings
  -- How many hours the reading covers: 1 for an hourly feed, 24 for a daily one. The flows stored
  -- beside it are volumes over that window, exactly as the operator published them.
  add column if not exists window_h integer not null default 1
    check (window_h between 1 and 24);

comment on column public.dam_readings.inflow_mcm_h is
  'Million cubic metres over this reading window (window_h hours), as published.';

-- A volume over a window, as cubic metres a second. The one-hour helper stays for the callers
-- that have an hourly reading in hand.
create or replace function public.mcm_over_hours_to_cms(p_mcm double precision, p_hours integer)
returns double precision language sql immutable set search_path = '' as $$
  select case when p_mcm is null or coalesce(p_hours, 0) < 1 then null
              else p_mcm * 1000000.0 / (p_hours * 3600.0) end
$$;
grant execute on function public.mcm_over_hours_to_cms(double precision, integer)
  to anon, authenticated;

-------------------------------------------------------------------------------
-- 2. The grade, per dam
-------------------------------------------------------------------------------
create or replace function public.dam_signal(p_dam text)
returns table (
  observed_at timestamptz, fetched_at timestamptz,
  storage_mcm double precision, percent_full double precision, level_m double precision,
  inflow_cms double precision, released_cms double precision, spilled_cms double precision,
  outflow_cms double precision,
  rise_mcm_per_h double precision, rise_window_h integer,
  grade public.dam_grade, reasons text[], awaiting text[],
  readings integer, stale boolean, confirmed_over integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  -- The shared defaults, with this dam's own rules on top: jsonb concat lets a dam override one
  -- key and inherit the rest.
  g jsonb;
  v_turbine double precision;
  v_inflow double precision;
  v_rise double precision;
  v_window integer;
  v_stale integer;
  v_consecutive integer;
  v_release_reason text;
  v_normal double precision;
  v_max double precision;
begin
  select coalesce((select s.value from public.system_settings s where s.key = 'dam_grades'),
                  '{}'::jsonb) || coalesce(d.grades, '{}'::jsonb),
         d.storage_normal_mcm, d.storage_max_mcm
    into g, v_normal, v_max
    from public.dams d where d.code = p_dam;
  if not found then
    return;
  end if;
  v_turbine := coalesce((g ->> 'turbine_max_cms')::double precision, 160);
  v_inflow := coalesce((g ->> 'inflow_high_cms')::double precision, 500);
  v_rise := coalesce((g ->> 'rise_mcm_per_h')::double precision, 4.0);
  v_window := greatest(coalesce((g ->> 'rise_window_h')::integer, 6), 1);
  v_stale := coalesce((g ->> 'stale_after_h')::integer, 6);
  v_consecutive := greatest(coalesce((g ->> 'min_consecutive_h')::integer, 2), 1);
  -- A reservoir with no power station has no "above the turbines": the same rule is then the
  -- plain one, that it is letting a lot of water go.
  v_release_reason := case when (g ->> 'release_reason') = 'release_high' then 'release_high'
                           else 'above_turbines' end;

  return query
  with recent as (
    select r.*,
           coalesce(public.mcm_over_hours_to_cms(r.released_mcm_h, r.window_h), 0)
             + coalesce(public.mcm_over_hours_to_cms(r.spilled_mcm_h, r.window_h), 0) as outflow,
           public.mcm_over_hours_to_cms(r.inflow_mcm_h, r.window_h) as inflow_rate,
           row_number() over (order by r.observed_at desc) as back
      from public.dam_readings r
     where r.dam_code = p_dam
     order by r.observed_at desc
     limit (v_consecutive + v_window + 2)
  ),
  risen as (
    select recent.*,
           case when lag(storage_mcm, v_window) over w is null or storage_mcm is null then null
                else (storage_mcm - lag(storage_mcm, v_window) over w)
                     / greatest(extract(epoch from (observed_at
                                                    - lag(observed_at, v_window) over w))
                                / 3600.0, 1)
           end as rise
      from recent
    window w as (order by observed_at)
  ),
  tested as (
    select risen.*,
           (coalesce(spilled_mcm_h, 0) > 0 or outflow > v_turbine) as is_releasing,
           (storage_mcm > v_normal
            or coalesce(inflow_rate, 0) > v_inflow
            or coalesce(rise, 0) > v_rise) as is_watchful
      from risen
  ),
  latest as (select * from tested where back = 1),
  held as (
    select bool_and(is_releasing) filter (where back <= v_consecutive) as releasing_held,
           bool_and(is_watchful) filter (where back <= v_consecutive) as watchful_held,
           count(*) filter (where back <= v_consecutive) as have
      from tested
  )
  select l.observed_at, l.fetched_at, l.storage_mcm,
         case when v_max > 0 then round((l.storage_mcm / v_max * 100)::numeric, 1)::double precision
              end,
         l.level_m,
         l.inflow_rate,
         public.mcm_over_hours_to_cms(l.released_mcm_h, l.window_h),
         public.mcm_over_hours_to_cms(l.spilled_mcm_h, l.window_h),
         l.outflow,
         round(l.rise::numeric, 2)::double precision, v_window,
         case
           when h.have >= v_consecutive and h.releasing_held then 'releasing'::public.dam_grade
           when h.have >= v_consecutive and h.watchful_held then 'watchful'::public.dam_grade
           else 'quiet'::public.dam_grade
         end,
         (select array_remove(array[
            case when coalesce(l.spilled_mcm_h, 0) > 0 and h.releasing_held then 'spilling' end,
            case when l.outflow > v_turbine and h.releasing_held then v_release_reason end,
            case when l.storage_mcm > v_normal and h.watchful_held then 'above_normal_high' end,
            case when coalesce(l.inflow_rate, 0) > v_inflow
                      and h.watchful_held then 'inflow_high' end,
            case when coalesce(l.rise, 0) > v_rise and h.watchful_held then 'rising_fast' end
          ], null)),
         (select array_remove(array[
            case when l.is_releasing and not coalesce(h.releasing_held, false)
                 then 'release_unconfirmed' end,
            case when l.is_watchful and not coalesce(h.watchful_held, false)
                 then 'watch_unconfirmed' end
          ], null)),
         (select count(*)::integer from tested),
         l.observed_at < now() - make_interval(hours => v_stale),
         v_consecutive
    from latest l, held h;
end $$;
grant execute on function public.dam_signal(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The day behind the newest reading, and the fortnight: hours from the window, not from the
--    number of rows. One daily reading is twenty-four hours of water, and saying it is one would
--    make a release look twenty-four times smaller.
-------------------------------------------------------------------------------
create or replace function public.dam_daily(p_dam text, p_hours integer default 24)
returns table (
  window_h integer, until timestamptz,
  inflow_hours integer, inflow_mean_cms double precision, inflow_mcm double precision,
  outflow_hours integer, outflow_mean_cms double precision, outflow_mcm double precision,
  spilled_mcm double precision
)
language sql stable security definer set search_path = '' as $$
  with newest as (
    select max(r.observed_at) as until from public.dam_readings r where r.dam_code = p_dam
  ),
  window_rows as (
    select r.* from public.dam_readings r, newest n
     where r.dam_code = p_dam
       and r.observed_at <= n.until
       and r.observed_at > n.until - make_interval(hours => greatest(p_hours, 1))
  ),
  summed as (
    select coalesce(sum(w.window_h) filter (where w.inflow_mcm_h is not null), 0)::integer
             as inflow_hours,
           sum(w.inflow_mcm_h) as inflow_mcm,
           coalesce(sum(w.window_h) filter (where w.released_mcm_h is not null
                                              or w.spilled_mcm_h is not null), 0)::integer
             as outflow_hours,
           sum(coalesce(w.released_mcm_h, 0) + coalesce(w.spilled_mcm_h, 0)) as outflow_mcm,
           sum(w.spilled_mcm_h) as spilled_mcm
      from window_rows w
  )
  select greatest(p_hours, 1),
         n.until,
         s.inflow_hours,
         case when s.inflow_hours > 0
              then s.inflow_mcm * 1000000.0 / (s.inflow_hours * 3600.0) end,
         s.inflow_mcm,
         s.outflow_hours,
         case when s.outflow_hours > 0
              then s.outflow_mcm * 1000000.0 / (s.outflow_hours * 3600.0) end,
         s.outflow_mcm,
         s.spilled_mcm
    from summed s, newest n
   where n.until is not null;
$$;
grant execute on function public.dam_daily(text, integer) to anon, authenticated;

create or replace function public.dam_days(p_dam text, p_days integer default 14)
returns table (
  day date, hours integer,
  released_mean_cms double precision, spilled_mean_cms double precision,
  outflow_mean_cms double precision, outflow_mcm double precision, spilled_mcm double precision,
  storage_end_mcm double precision, level_end_m double precision
)
language sql stable security definer set search_path = '' as $$
  with days as (
    select generate_series(
             ((now() at time zone 'Asia/Bangkok')::date - (greatest(p_days, 1) - 1)),
             ((now() at time zone 'Asia/Bangkok')::date),
             interval '1 day')::date as day
  ),
  readings as (
    select (r.observed_at at time zone 'Asia/Bangkok')::date as day, r.*
      from public.dam_readings r
     where r.dam_code = p_dam
       and r.observed_at >= ((now() at time zone 'Asia/Bangkok')::date
                             - (greatest(p_days, 1) - 1)) at time zone 'Asia/Bangkok'
  ),
  per_day as (
    select r.day,
           coalesce(sum(r.window_h) filter (where r.released_mcm_h is not null
                                              or r.spilled_mcm_h is not null), 0)::integer as hours,
           sum(r.released_mcm_h) as released_mcm,
           sum(r.spilled_mcm_h) as spilled_mcm,
           sum(coalesce(r.released_mcm_h, 0) + coalesce(r.spilled_mcm_h, 0)) as outflow_mcm,
           (array_agg(r.storage_mcm order by r.observed_at desc)
              filter (where r.storage_mcm is not null))[1] as storage_end_mcm,
           (array_agg(r.level_m order by r.observed_at desc)
              filter (where r.level_m is not null))[1] as level_end_m
      from readings r group by r.day
  )
  select d.day,
         coalesce(p.hours, 0),
         case when coalesce(p.hours, 0) > 0
              then p.released_mcm * 1000000.0 / (p.hours * 3600.0) end,
         case when coalesce(p.hours, 0) > 0
              then p.spilled_mcm * 1000000.0 / (p.hours * 3600.0) end,
         case when coalesce(p.hours, 0) > 0
              then p.outflow_mcm * 1000000.0 / (p.hours * 3600.0) end,
         p.outflow_mcm, p.spilled_mcm, p.storage_end_mcm, p.level_end_m
    from days d left join per_day p on p.day = d.day
   order by d.day;
$$;
grant execute on function public.dam_days(text, integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- 4. The daily feed
--
-- ThaiWater's /analyst/dam answer carries the newest figure for every medium reservoir in the
-- country in its `dam_medium` list. There is no history endpoint for them (checked 14 Oct 2026:
-- dam_medium_graph answers with an empty series), so this is the only way in, and the archive
-- behind these dams begins the day Jaga starts asking.
-------------------------------------------------------------------------------
create or replace function public.dam_fetch_daily() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_url text := v_feed ->> 'url';
  v_answer extensions.http_response;
  v_list jsonb;
  v_dam record;
  v_row jsonb;
  v_rows integer := 0;
  v_at timestamptz;
begin
  if v_url is null then
    return 0;
  end if;
  if not exists (select 1 from public.dams where feed = 'daily') then
    return 0;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT',
                                      coalesce(v_feed ->> 'timeout_s', '25'));
  begin
    select * into v_answer from extensions.http_get(v_url);
  exception when others then
    insert into public.dam_feed_log (ok, error)
      values (false, 'daily: ' || left(sqlerrm, 160));
    return 0;
  end;
  if v_answer.status <> 200 then
    insert into public.dam_feed_log (ok, http_status, error)
      values (false, v_answer.status, 'daily: http ' || v_answer.status);
    return 0;
  end if;
  begin
    v_list := coalesce(v_answer.content::jsonb #> '{data,dam_medium}', '[]'::jsonb);
  exception when others then
    insert into public.dam_feed_log (ok, error) values (false, 'daily: not JSON');
    return 0;
  end;

  for v_dam in select code, thaiwater_daily_id from public.dams
                where feed = 'daily' and thaiwater_daily_id is not null loop
    select e into v_row from jsonb_array_elements(v_list) as e
      where (e #>> '{dam,id}')::bigint = v_dam.thaiwater_daily_id
      limit 1;
    if v_row is null or (v_row ->> 'dam_date') is null then
      continue;
    end if;
    -- The date it is published for, at the start of that Bangkok day. The reading covers the
    -- whole day (window_h = 24), which is what every mean and volume below it is divided by.
    v_at := ((v_row ->> 'dam_date')::date)::timestamp at time zone 'Asia/Bangkok';
    insert into public.dam_readings (dam_code, observed_at, window_h, storage_mcm, level_m,
                                     inflow_mcm_h, released_mcm_h, spilled_mcm_h)
      values (v_dam.code, v_at, 24,
              (v_row ->> 'dam_storage')::double precision,
              (v_row ->> 'dam_level')::double precision,
              (v_row ->> 'dam_inflow')::double precision,
              (v_row ->> 'dam_released')::double precision,
              (v_row ->> 'dam_spilled')::double precision)
      on conflict (dam_code, observed_at) do update
        set fetched_at = now(), window_h = 24,
            storage_mcm = coalesce(excluded.storage_mcm, public.dam_readings.storage_mcm),
            level_m = coalesce(excluded.level_m, public.dam_readings.level_m),
            inflow_mcm_h = coalesce(excluded.inflow_mcm_h, public.dam_readings.inflow_mcm_h),
            released_mcm_h = coalesce(excluded.released_mcm_h, public.dam_readings.released_mcm_h),
            spilled_mcm_h = coalesce(excluded.spilled_mcm_h, public.dam_readings.spilled_mcm_h);
    v_rows := v_rows + 1;
    v_row := null;
  end loop;

  insert into public.dam_feed_log (ok, http_status, rows_stored)
    values (true, v_answer.status, v_rows);
  return v_rows;
end $$;
revoke execute on function public.dam_fetch_daily() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 5. The hourly job now also takes the daily figures, and judges **every** dam, not only the
--    ones with an hourly feed. Same cron, same log, one notice per episode as before.
-------------------------------------------------------------------------------
create or replace function public.dam_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_days integer := coalesce((v_feed ->> 'days')::integer, 3);
  v_from date := ((now() at time zone 'Asia/Bangkok')::date - (v_days - 1));
  v_to date := ((now() at time zone 'Asia/Bangkok')::date + 1);
  v_rows integer;
  v_dam record;
  v_signal record;
begin
  v_rows := public.dam_fetch_range(v_from, v_to);
  v_rows := v_rows + public.dam_fetch_daily();

  for v_dam in select code from public.dams loop
    select * into v_signal from public.dam_signal(v_dam.code);
    if v_signal is null then
      continue;
    end if;
    if v_signal.grade = 'releasing' then
      if not exists (select 1 from public.dam_notices n
                      where n.dam_code = v_dam.code and n.status in ('open', 'sent')) then
        insert into public.dam_notices (dam_code, observed_at, grade, reasons, figures)
          values (v_dam.code, v_signal.observed_at, v_signal.grade, v_signal.reasons,
                  to_jsonb(v_signal));
      end if;
    elsif v_signal.grade = 'quiet' then
      update public.dam_notices
         set status = 'ended', ended_at = now()
       where dam_code = v_dam.code and status = 'open';
    end if;
  end loop;
  return v_rows;
end $$;
revoke execute on function public.dam_fetch() from public, anon, authenticated;
