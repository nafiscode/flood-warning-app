-- A12 part 1 (2/2): the dam's live figures, the two tiers, and the hourly job that reads them.
--
-- The owner's decision of 10 Oct 2026, in two tiers:
--
--   watchful   the app shows a quiet notice itself, with its disclaimer. No sound, no push.
--   releasing  a notice is raised for the admins, who review it and send the real alarm.
--
-- Code never publishes an alert (safety rule 2). The upper tier writes a row into
-- public.dam_notices and nothing else: no alert, no notification, no sound. What a person sends
-- after reviewing it is the dam release notice of spec 15, which is the rest of A12.
--
-- There is no probability in here, deliberately. Three releases in fifteen years, no hydraulic
-- model and hourly readings cannot give a calibrated percentage, and one would be invented
-- precision (safety rule 8). The grade names the rule that fired and shows the figures with the
-- time they were read; pipeline/dam_release/METHODS.md measures every rule against the archive.
--
-- The spike guard matters as much as the rules. The archive holds impossible single hours (an
-- outflow of 1,944 m3/s with no spill, against a record spill peak of 648). A rule therefore has
-- to hold for two readings in a row before it grades. Nothing is discarded and no reading is
-- called too big to be true: a lone one is returned in `awaiting`, shown as waiting for the next.

create extension if not exists pg_cron with schema pg_catalog;
-- Synchronous HTTP, on purpose. pg_net is asynchronous and would need a second job to collect
-- the answer out of its side table, which is two more ways for a safety feed to fail quietly.
-- This runs once an hour and asks for one document.
create extension if not exists http with schema extensions;

create type public.dam_grade as enum ('quiet', 'watchful', 'releasing');
create type public.dam_notice_status as enum ('open', 'sent', 'dismissed', 'ended');

-- ThaiWater's hourly release and spill are volumes per hour in million cubic metres.
create function public.mcm_per_h_to_cms(p_value double precision) returns double precision
language sql immutable set search_path = '' as $$ select p_value * 1000000.0 / 3600.0 $$;
grant execute on function public.mcm_per_h_to_cms(double precision) to anon, authenticated;

-------------------------------------------------------------------------------
-- Where the figures come from, and the rules. Both are settings, so an admin can change a
-- threshold or point the feed elsewhere without a deployment.
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('dam_feed',
   '{"url": "https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam", "timeout_s": 25}'::jsonb,
   'ThaiWater''s dam endpoint: free, no key, hourly. Read once an hour by dam_fetch().')
  on conflict (key) do nothing;
-- The grade criteria themselves are inserted by supabase/seed/40_dams.sql, so that the numbers
-- and the evidence behind them live together with the geometry they were measured against.

-------------------------------------------------------------------------------
-- The readings, as published. One row per dam per hour.
-------------------------------------------------------------------------------
create table public.dam_readings (
  dam_code text not null references public.dams (code) on delete cascade,
  -- The hour the operator published, converted from its Bangkok clock time.
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  storage_mcm double precision,
  level_m double precision,
  -- As published: million cubic metres in that hour.
  inflow_mcm_h double precision,
  released_mcm_h double precision,
  spilled_mcm_h double precision,
  primary key (dam_code, observed_at)
);
create index dam_readings_recent_idx on public.dam_readings (dam_code, observed_at desc);

-- How each hourly fetch went, so an admin can see the feed is alive. Figures only.
create table public.dam_feed_log (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  http_status integer,
  rows_stored integer not null default 0,
  error text
);

alter table public.dam_readings enable row level security;
alter table public.dam_feed_log enable row level security;

-- The readings are the operator's own published figures: public, like the gauges (spec 4.2).
create policy "dam_readings: everyone reads" on public.dam_readings for select
  to anon, authenticated using (true);
-- The feed's health is an operations detail, not something to put in front of the public.
create policy "dam_feed_log: admins read" on public.dam_feed_log for select to authenticated
  using (public.is_admin());

-------------------------------------------------------------------------------
-- The signal: the latest reading, what it means, and how sure we are of it.
-------------------------------------------------------------------------------
create function public.dam_signal(p_dam text)
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
  g jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_grades'),
                      '{}'::jsonb);
  v_turbine double precision := coalesce((g ->> 'turbine_max_cms')::double precision, 160);
  v_inflow double precision := coalesce((g ->> 'inflow_high_cms')::double precision, 500);
  v_rise double precision := coalesce((g ->> 'rise_mcm_per_h')::double precision, 4.0);
  v_window integer := coalesce((g ->> 'rise_window_h')::integer, 6);
  v_stale integer := coalesce((g ->> 'stale_after_h')::integer, 6);
  v_consecutive integer := greatest(coalesce((g ->> 'min_consecutive_h')::integer, 2), 1);
  v_normal double precision;
  v_max double precision;
begin
  select d.storage_normal_mcm, d.storage_max_mcm into v_normal, v_max
    from public.dams d where d.code = p_dam;
  if not found then
    return;
  end if;

  return query
  with recent as (
    -- Enough rows to judge the rules on each of the last v_consecutive readings, each of which
    -- needs v_window readings behind it to have a rate of rise at all.
    select r.*,
           public.mcm_per_h_to_cms(coalesce(r.released_mcm_h, 0))
             + public.mcm_per_h_to_cms(coalesce(r.spilled_mcm_h, 0)) as outflow,
           row_number() over (order by r.observed_at desc) as back
      from public.dam_readings r
     where r.dam_code = p_dam
     order by r.observed_at desc
     limit (v_consecutive + v_window + 2)
  ),
  -- The rate of rise for *every* reading, not just the newest, so that it can be held to the
  -- same confirmation rule as the others. Null where there is not enough history behind it:
  -- a missing rate is never treated as zero rise, only as unknown.
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
            or public.mcm_per_h_to_cms(coalesce(inflow_mcm_h, 0)) > v_inflow
            or coalesce(rise, 0) > v_rise) as is_watchful
      from risen
  ),
  latest as (select * from tested where back = 1),
  -- A rule counts once it has held for v_consecutive readings in a row. Every rule goes through
  -- here, the rate of rise included: the archive's 141 Mm3/h hour is exactly what this stops.
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
         public.mcm_per_h_to_cms(l.inflow_mcm_h),
         public.mcm_per_h_to_cms(l.released_mcm_h),
         public.mcm_per_h_to_cms(l.spilled_mcm_h),
         l.outflow,
         round(l.rise::numeric, 2)::double precision, v_window,
         case
           when h.have >= v_consecutive and h.releasing_held then 'releasing'::public.dam_grade
           when h.have >= v_consecutive and h.watchful_held then 'watchful'::public.dam_grade
           else 'quiet'::public.dam_grade
         end,
         -- Which rule fired, in the words the app looks up. Never a number on its own.
         (select array_remove(array[
            case when coalesce(l.spilled_mcm_h, 0) > 0 and h.releasing_held then 'spilling' end,
            case when l.outflow > v_turbine and h.releasing_held then 'above_turbines' end,
            case when l.storage_mcm > v_normal and h.watchful_held then 'above_normal_high' end,
            case when public.mcm_per_h_to_cms(coalesce(l.inflow_mcm_h, 0)) > v_inflow
                      and h.watchful_held then 'inflow_high' end,
            case when coalesce(l.rise, 0) > v_rise and h.watchful_held then 'rising_fast' end
          ], null)),
         -- Fired on the newest reading alone. Shown, but not graded on: the next reading decides.
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
-- What the app asks for: every dam with its live figures beside it.
-------------------------------------------------------------------------------
create function public.dam_state(p_source text default 'osm')
returns table (
  code text, name jsonb, river jsonb, operator text,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_note jsonb, signal json
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator, d.storage_max_mcm, d.storage_normal_mcm,
         d.geometry_note,
         (select row_to_json(s) from public.dam_signal(d.code) s)
    from public.dams d
   where d.geometry_source = p_source
$$;
grant execute on function public.dam_state(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The upper tier: a row for the admins to review. This is the whole of what code does.
-------------------------------------------------------------------------------
create table public.dam_notices (
  id uuid primary key default gen_random_uuid(),
  dam_code text not null references public.dams (code) on delete cascade,
  raised_at timestamptz not null default now(),
  -- The reading that raised it, and the figures exactly as they were then: the record must not
  -- shift under an admin while they are reading it.
  observed_at timestamptz not null,
  grade public.dam_grade not null,
  reasons text[] not null default '{}',
  figures jsonb not null default '{}'::jsonb,
  status public.dam_notice_status not null default 'open',
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  ended_at timestamptz
);
create index dam_notices_open_idx on public.dam_notices (dam_code, status, raised_at desc);

alter table public.dam_notices enable row level security;
-- Not public: a notice is an internal signal awaiting a person's judgement, and showing it
-- before anyone has looked would be code publishing an alert by the back door (safety rule 2).
create policy "dam_notices: admins read" on public.dam_notices for select to authenticated
  using (public.is_admin());

-------------------------------------------------------------------------------
-- The hourly job: read the feed, store what is new, and raise a notice if a release is
-- confirmed. Runs as the table owner; no client can call it.
-------------------------------------------------------------------------------
create function public.dam_fetch() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_feed jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_feed'),
                           '{}'::jsonb);
  v_url text := v_feed ->> 'url';
  v_timeout text := coalesce(v_feed ->> 'timeout_s', '25');
  v_answer extensions.http_response;
  v_body jsonb;
  v_rows integer := 0;
  v_dam record;
  v_row jsonb;
  v_observed timestamptz;
  v_signal record;
begin
  if v_url is null then
    insert into public.dam_feed_log (ok, error) values (false, 'no url in the dam_feed setting');
    return 0;
  end if;
  -- A feed that hangs must not hold the job open until the next one is due.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', v_timeout);
  begin
    select * into v_answer from extensions.http_get(v_url);
  exception when others then
    insert into public.dam_feed_log (ok, error) values (false, left(sqlerrm, 500));
    return 0;
  end;
  if v_answer.status <> 200 then
    insert into public.dam_feed_log (ok, http_status, error)
      values (false, v_answer.status, 'the feed did not answer with 200');
    return 0;
  end if;
  begin
    v_body := v_answer.content::jsonb;
  exception when others then
    insert into public.dam_feed_log (ok, http_status, error)
      values (false, v_answer.status, 'the answer was not JSON');
    return 0;
  end;

  for v_dam in select code, thaiwater_hourly_id from public.dams
                where thaiwater_hourly_id is not null loop
    -- The newest hourly row the feed carries for this dam.
    select item into v_row
      from jsonb_array_elements(coalesce(v_body #> '{data,dam_hourly}', '[]'::jsonb)) as item
     where (item #>> '{dam,id}')::integer = v_dam.thaiwater_hourly_id
     order by item ->> 'dam_date' desc limit 1;
    continue when v_row is null;
    -- ThaiWater's timestamps are Bangkok clock times whatever suffix they carry.
    v_observed := ((v_row ->> 'dam_date')::timestamp) at time zone 'Asia/Bangkok';
    insert into public.dam_readings (dam_code, observed_at, storage_mcm, level_m,
                                     inflow_mcm_h, released_mcm_h, spilled_mcm_h)
      values (v_dam.code, v_observed,
              (v_row ->> 'dam_storage')::double precision,
              (v_row ->> 'dam_level')::double precision,
              (v_row ->> 'dam_inflow')::double precision,
              (v_row ->> 'dam_released')::double precision,
              (v_row ->> 'dam_spilled')::double precision)
      on conflict (dam_code, observed_at) do update set
        storage_mcm = excluded.storage_mcm, level_m = excluded.level_m,
        inflow_mcm_h = excluded.inflow_mcm_h, released_mcm_h = excluded.released_mcm_h,
        spilled_mcm_h = excluded.spilled_mcm_h, fetched_at = now();
    v_rows := v_rows + 1;

    select * into v_signal from public.dam_signal(v_dam.code);
    if v_signal.grade = 'releasing' then
      -- One notice per episode. A second reading of the same release adds nothing for an admin
      -- to do; it is the same event still waiting on the same judgement.
      if not exists (select 1 from public.dam_notices n
                      where n.dam_code = v_dam.code and n.status in ('open', 'sent')) then
        insert into public.dam_notices (dam_code, observed_at, grade, reasons, figures)
          values (v_dam.code, v_signal.observed_at, v_signal.grade, v_signal.reasons,
                  to_jsonb(v_signal));
      end if;
    elsif v_signal.grade = 'quiet' then
      -- The release is over. The notice is kept, marked ended: the record of what happened and
      -- whether anybody acted on it is the point (spec 16).
      update public.dam_notices set status = 'ended', ended_at = now()
       where dam_code = v_dam.code and status = 'open';
    end if;
  end loop;

  insert into public.dam_feed_log (ok, http_status, rows_stored)
    values (true, v_answer.status, v_rows);
  -- The log is for seeing the feed is alive, not a second archive.
  delete from public.dam_feed_log where id < (select max(id) - 500 from public.dam_feed_log);
  return v_rows;
end $$;
revoke execute on function public.dam_fetch() from public, anon, authenticated;

-- Seven minutes past the hour: ThaiWater publishes on the hour, and this leaves it a little
-- time. One request an hour, for one document.
select cron.schedule('jaga-dam-readings', '7 * * * *', 'select public.dam_fetch()');

-------------------------------------------------------------------------------
-- The admin side: the review queue, and acting on one notice.
-------------------------------------------------------------------------------
create function public.admin_dam_board()
returns table (
  dam_code text, dam_name jsonb, river jsonb, operator text, signal json,
  notice_id uuid, notice_status public.dam_notice_status, notice_raised_at timestamptz,
  notice_reasons text[], notice_figures jsonb, notice_reviewed_at timestamptz,
  notice_reviewed_by_name text, notice_note text,
  tambons_main integer, tambons_tributary integer,
  feed_ok boolean, feed_ran_at timestamptz, feed_error text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select d.code, d.name, d.river, d.operator,
         (select row_to_json(s) from public.dam_signal(d.code) s),
         n.id, n.status, n.raised_at, n.reasons, n.figures, n.reviewed_at,
         p.display_name, n.review_note,
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = d.geometry_source and t.via = 'main'),
         (select count(*)::integer from public.dam_tambons t
           where t.dam_code = d.code and t.source = d.geometry_source and t.via = 'tributary'),
         f.ok, f.ran_at, f.error
    from public.dams d
    left join lateral (
      select * from public.dam_notices x
       where x.dam_code = d.code order by x.raised_at desc limit 1
    ) n on true
    left join public.profiles p on p.user_id = n.reviewed_by
    left join lateral (
      select * from public.dam_feed_log l order by l.id desc limit 1
    ) f on true;
end $$;
revoke execute on function public.admin_dam_board() from public, anon;
grant execute on function public.admin_dam_board() to authenticated;

-- An admin records what they did about a notice. Sending the dam release notice itself is the
-- rest of A12 (spec 15) and is not this function: this only writes down the judgement.
create function public.admin_dam_notice_review(p_notice uuid, p_status public.dam_notice_status,
                                               p_note text default null)
returns public.dam_notice_status
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.dam_notice_status;
begin
  perform public.admin_only();
  if p_status not in ('sent', 'dismissed') then
    raise exception 'a review is either sent or dismissed' using errcode = 'check_violation';
  end if;
  update public.dam_notices
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = p_note
   where id = p_notice and status in ('open', 'sent')
   returning status into v_status;
  if v_status is null then
    raise exception 'that notice is not open' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_notice_review', 'dam_notices', p_notice,
            jsonb_build_object('status', p_status));
  return v_status;
end $$;
revoke execute on function public.admin_dam_notice_review(uuid, public.dam_notice_status, text)
  from public, anon;
grant execute on function public.admin_dam_notice_review(uuid, public.dam_notice_status, text)
  to authenticated;
