-- The soft notice: "this river has been rising for a week, and the rain behind it is in the top
-- third" (science plan Module 11; the owner asked for it on 9 November 2026, wanting "an automatic
-- soft alert when we see the river is consequently rising continuously for 1 week which supporting
-- data of rainfall in the area suggest that the trend of the river level will be risen and can
-- flood soon").
--
-- **It is not an alert and it cannot become one by itself.** Safety rule 2 is untouched: nothing in
-- this file writes to `alerts`, sets a level, colours a tambon or calls a publish function. The
-- owner chose the road on 9 November 2026: admins now, residents by one tap. Code raises a row and
-- tells the admins; an admin reads the figures and, if they agree, sends a Watch from the reviewed
-- template as they would any other.
--
-- How it works, following the one table in this schema that already exists to raise a row for
-- admins' attention, `dam_notices` (20261009225600):
--
--   season_signal(zone)   reads the figures and grades the zone in one word. No writes.
--   season_notices        one row per episode, with its figures frozen, admin-read only.
--   season_tick()         once a day on the cron: opens a notice when a zone turns `rising_wet`,
--                         closes it when the zone goes quiet. Reachable by no client, not even an
--                         admin.
--   push_season_due()     one quiet push per episode to every admin, by the server's gate token,
--                         in the shape push_dam_release_admins() established. The ordinary notice
--                         buzz; never a level, never the alarm's pattern, never a repeat knock.
--   admin_season_notice_review()  writes down what the admin decided. It does not publish.
--
-- The rule, measured on the archive (pipeline/season_state/METHODS.md). A zone is `rising_wet` when
-- **both** legs hold:
--
--   1. the key gauge's daily-minimum floor rose on at least 5 of the last 7 whole days, and
--   2. the fifteen-day basin rain is in the top third of that basin's own record for the month.
--
-- Either leg alone is `rising` or `wet`, which is shown on the dashboard and raises nothing. Over
-- the 2020-2025 seasons that is one to three episodes per zone per season - a handful between
-- October and January. A signal that spoke weekly would be ignored by November.
--
-- **Why "above normal for the date" is not a third condition.** It was the owner's first choice,
-- and the archive argued against it: at X.40A the floor sat in the *bottom* third of its November
-- record through 5-22 November 2025 and the river went over its bank on the 24th. The worst flood
-- in this record fell on a catchment that was running low. The figure is carried in `figures` and
-- shown beside the grade, where an admin can weigh it; it can never silence anything (owner's
-- decision, 10 November 2026).
--
-- **What it cannot do.** It is not early: at X.40A in November 2025 the rule's days are the 23rd to
-- the 27th and the bank was crossed on the 24th. It is context an admin reads beside the 72-hour
-- rain rule, not a longer-range replacement for it, and the dashboard copy says so. A gap in the
-- readings yields no grade rather than a guess, and a zone whose key gauge is dropped as tidal or
-- pulse-driven (X.77 below Bang Lang) or has no reference yet gets no grade at all.

create type public.season_notice_status as enum ('open', 'sent', 'dismissed', 'ended');

-- Where one figure sits in its own record. `unknown` whenever either side is missing, and
-- `unknown` must read as "we cannot say", never as "normal" (safety rule 10).
create function public.season_band(p_value double precision, p_low double precision,
                                   p_high double precision)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_value is null or p_low is null or p_high is null then 'unknown'
    when p_value <= p_low then 'low'
    when p_value >= p_high then 'high'
    else 'middle' end
$$;
revoke all on function public.season_band(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.season_band(double precision, double precision, double precision)
  to authenticated;

-------------------------------------------------------------------------------
-- 1. The figures, and the zone's state in one word. Reads only.
-------------------------------------------------------------------------------
create function public.season_signal(p_zone uuid)
returns table (zone_id uuid, basin text, station_id uuid, gauge text, month smallint,
               floor_m double precision, floor_at timestamptz, rose_days integer,
               change_7d_m double precision, floor_band text, floor_vs_normal_m double precision,
               rain_15d_mm double precision, rain_15d_band text, rain_30d_mm double precision,
               rain_season_mm double precision, rain_season_band text, rain_at timestamptz,
               stale boolean, grade text, reasons text[], figures jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_month smallint;
  v_season_start date;
  v_basin text;
  v_key integer;
  v_station uuid;
  v_code text;
  v_floors double precision[];
  v_days date[];
  v_floor_at timestamptz;
  v_floor double precision;
  v_change double precision;
  v_rose integer;
  v_r15 double precision;
  v_r30 double precision;
  v_rs double precision;
  v_n15 integer;
  v_rain_at timestamptz;
  v_base record;
  v_rain record;
  v_floor_band text := 'unknown';
  v_rain_band text := 'unknown';
  v_season_band text := 'unknown';
  v_vs_normal double precision;
  v_grade text := 'quiet';
  v_reasons text[] := '{}'::text[];
  v_stale boolean := true;
  v_blind text[] := '{}'::text[];
begin
  v_month := extract(month from v_today)::smallint;
  v_season_start := make_date(
    (case when v_month >= 10 then extract(year from v_today) else extract(year from v_today) - 1 end)::integer,
    10, 1);

  select z.basin into v_basin from public.warning_zones z where z.id = p_zone;
  if v_basin is null then
    return;
  end if;

  -- The zone's key gauge, from the same place the dashboard and the alarm read it.
  select (s.value -> 'zones' -> v_basin -> 'gauges' ->> 'key')::integer into v_key
    from public.system_settings s where s.key = 'signal_feed';
  if v_key is not null then
    select st.id, st.code into v_station, v_code
      from public.stations st where st.thaiwater_id = v_key;
  end if;

  -- The floor, day by day: the lowest reading of each whole Bangkok day. Today is still running,
  -- so it is left out.
  if v_station is not null then
    select array_agg(d.floor_m order by d.day), array_agg(d.day order by d.day), max(d.last_at)
      into v_floors, v_days, v_floor_at
      from (select (o.ts at time zone 'Asia/Bangkok')::date as day,
                   min(o.value) as floor_m, max(o.ts) as last_at
              from public.observations o
             where o.station_id = v_station
               and o.variable = 'water_level_msl'
               and o.value is not null
               and o.ts >= now() - interval '10 days'
             group by 1) d
     where d.day between v_today - 8 and v_today - 1;
  end if;

  -- Eight whole days in a row, ending yesterday, or no judgement at all: a gap must never be able
  -- to look like a day the river did not rise.
  if v_days is not null and array_length(v_days, 1) = 8
     and v_days[1] = v_today - 8 and v_days[8] = v_today - 1 then
    v_rose := 0;
    for i in 2..8 loop
      if v_floors[i] > v_floors[i - 1] then
        v_rose := v_rose + 1;
      end if;
    end loop;
    v_floor := v_floors[8];
    v_change := v_floors[8] - v_floors[1];
    v_stale := v_floor_at is null or v_floor_at < now() - interval '36 hours';
  else
    v_blind := v_blind || 'gaugeDays'::text;
  end if;
  if v_station is null then
    v_blind := v_blind || 'noKeyGauge'::text;
  end if;

  -- The rain already fallen: whole days only, every one of them present.
  select sum(f.value) filter (where f.valid_at::date between v_today - 15 and v_today - 1),
         sum(f.value) filter (where f.valid_at::date between v_today - 30 and v_today - 1),
         sum(f.value) filter (where f.valid_at::date between v_season_start and v_today - 1),
         count(*) filter (where f.valid_at::date between v_today - 15 and v_today - 1),
         max(f.issued_at)
    into v_r15, v_r30, v_rs, v_n15, v_rain_at
    from public.forecasts f
   where f.zone_id = p_zone and f.source = 'open_meteo' and f.variable = 'rain_1d_mm';
  if coalesce(v_n15, 0) < 15 then
    v_r15 := null;
    v_blind := v_blind || 'rainDays'::text;
  end if;

  -- The reference: this gauge's and this basin's own record for this month.
  select * into v_base from public.season_baseflow b
   where b.station_id = v_station and b.month = v_month;
  select * into v_rain from public.season_rain r
   where r.zone_id = p_zone and r.month = v_month;
  if v_base is null then
    v_blind := v_blind || 'noFloorReference'::text;
  end if;
  if v_rain is null then
    v_blind := v_blind || 'noRainReference'::text;
  end if;

  v_floor_band := public.season_band(v_floor, v_base.floor_p33, v_base.floor_p67);
  v_rain_band := public.season_band(v_r15, v_rain.d15_p33, v_rain.d15_p67);
  v_season_band := public.season_band(v_rs, v_rain.std_p33, v_rain.std_p67);
  if v_floor is not null and v_base.floor_p50 is not null then
    v_vs_normal := round((v_floor - v_base.floor_p50)::numeric, 3)::double precision;
  end if;

  -- Both legs, or nothing. A stale gauge cannot satisfy the rising leg.
  if v_rose is not null and not v_stale
     and v_rose >= coalesce((select (s.value -> 'season' ->> 'rose_days_min')::integer
                               from public.system_settings s where s.key = 'season_state'), 5) then
    v_reasons := v_reasons || 'rising_week'::text;
  end if;
  if v_rain_band = 'high' then
    v_reasons := v_reasons || 'wet_fortnight'::text;
  end if;
  v_grade := case
    when v_reasons @> array['rising_week'] and v_reasons @> array['wet_fortnight'] then 'rising_wet'
    when v_reasons @> array['wet_fortnight'] then 'wet'
    when v_reasons @> array['rising_week'] then 'rising'
    else 'quiet' end;

  return query select
    p_zone, v_basin, v_station, v_code, v_month,
    v_floor, v_floor_at, v_rose, v_change, v_floor_band, v_vs_normal,
    v_r15, v_rain_band, v_r30, v_rs, v_season_band, v_rain_at,
    v_stale, v_grade, v_reasons,
    jsonb_build_object(
      'basin', v_basin, 'gauge', v_code, 'month', v_month, 'at', now(),
      'floor', jsonb_build_object('m', v_floor, 'at', v_floor_at, 'roseDays', v_rose,
                                  'change7dM', v_change, 'band', v_floor_band,
                                  'vsNormalM', v_vs_normal,
                                  'reference', case when v_base is null then null else
                                    jsonb_build_object('p33', v_base.floor_p33, 'p50', v_base.floor_p50,
                                                       'p67', v_base.floor_p67, 'seasons', v_base.seasons) end),
      'rain', jsonb_build_object('d15Mm', v_r15, 'd15Band', v_rain_band, 'd30Mm', v_r30,
                                 'seasonMm', v_rs, 'seasonBand', v_season_band, 'at', v_rain_at,
                                 'reference', case when v_rain is null then null else
                                   jsonb_build_object('d15', jsonb_build_object('p33', v_rain.d15_p33,
                                                        'p50', v_rain.d15_p50, 'p67', v_rain.d15_p67),
                                                      'seasons', v_rain.seasons) end),
      'stale', v_stale, 'blind', to_jsonb(v_blind), 'grade', v_grade, 'reasons', to_jsonb(v_reasons));
end $$;
revoke all on function public.season_signal(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 2. One row per episode, for admins' eyes only.
-------------------------------------------------------------------------------
create table public.season_notices (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.warning_zones (id) on delete cascade,
  raised_at timestamptz not null default now(),
  -- The time of the newest reading behind it.
  observed_at timestamptz,
  grade text not null,
  reasons text[] not null default '{}'::text[],
  -- The figures exactly as they were when the notice was raised: the record must not shift under
  -- an admin while they are reading it.
  figures jsonb not null default '{}'::jsonb,
  status public.season_notice_status not null default 'open',
  reviewed_by uuid references public.profiles (user_id),
  reviewed_at timestamptz,
  review_note text,
  ended_at timestamptz
);
create index season_notices_open on public.season_notices (zone_id, status, raised_at desc);
alter table public.season_notices enable row level security;
-- Not public. A notice is an internal signal awaiting a person's judgement, and showing it before
-- anyone has looked would be code publishing an alert by the back door (safety rule 2). The same
-- reasoning, word for word, as dam_notices.
create policy season_notices_admin_read on public.season_notices for select
  to authenticated using (public.is_admin());
revoke all on public.season_notices from anon, authenticated;
grant select on public.season_notices to authenticated;

-------------------------------------------------------------------------------
-- 3. The daily tick. Reachable by no client, not even an admin.
--
-- One notice per episode: it opens when a zone turns `rising_wet` and closes when the zone goes
-- quiet, not the first day a leg lets go. Without that hysteresis a one-day dip in the floor would
-- close a notice and the next day open a second one about the same weather.
-------------------------------------------------------------------------------
create function public.season_tick() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_zone record;
  v_signal record;
  v_new integer := 0;
  v_raised integer := 0;
begin
  for v_zone in select z.id from public.warning_zones z order by z.basin loop
    select * into v_signal from public.season_signal(v_zone.id);
    if not found then
      continue;
    end if;

    if v_signal.grade = 'rising_wet' then
      insert into public.season_notices (zone_id, observed_at, grade, reasons, figures)
      select v_zone.id, v_signal.floor_at, v_signal.grade, v_signal.reasons, v_signal.figures
       where not exists (select 1 from public.season_notices n
                          where n.zone_id = v_zone.id and n.status in ('open', 'sent'));
      get diagnostics v_new = row_count;
      v_raised := v_raised + v_new;
    elsif v_signal.grade = 'quiet' then
      update public.season_notices n
         set status = 'ended', ended_at = now()
       where n.zone_id = v_zone.id and n.status in ('open', 'sent');
    end if;
  end loop;
  return v_raised;
end $$;
revoke all on function public.season_tick() from public, anon, authenticated;

-- Once a day, at 01:20 Bangkok. Off the hour so it never starts in the same second as the
-- one-minute push tick, and after midnight so "the last eight whole days" is a full eight.
select cron.schedule('jaga-season-state', '20 18 * * *', 'select public.season_tick()');

-------------------------------------------------------------------------------
-- 4. What an admin sees, and what they decide.
-------------------------------------------------------------------------------
create function public.admin_season_notices(p_days integer default 60)
returns table (id uuid, zone_id uuid, basin text, raised_at timestamptz, observed_at timestamptz,
               grade text, reasons text[], figures jsonb, status text, reviewed_at timestamptz,
               review_note text, ended_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.zone_id, z.basin, n.raised_at, n.observed_at, n.grade, n.reasons, n.figures,
         n.status::text, n.reviewed_at, n.review_note, n.ended_at
    from public.season_notices n
    join public.warning_zones z on z.id = n.zone_id
   where public.is_admin()
     and n.raised_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365)))
   order by n.raised_at desc
$$;
revoke all on function public.admin_season_notices(integer) from public, anon;
grant execute on function public.admin_season_notices(integer) to authenticated;

-- The admin's judgement, written down. It publishes nothing: sending a Watch is the alert console's
-- job and goes through the reviewed templates like any other alert (safety rule 2).
create function public.admin_season_notice_review(p_notice uuid, p_status text,
                                                  p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := now();
  v_zone uuid;
begin
  perform public.admin_only();
  if p_status not in ('sent', 'dismissed') then
    raise exception 'a notice is marked sent or dismissed' using errcode = 'check_violation';
  end if;
  update public.season_notices n
     set status = p_status::public.season_notice_status, reviewed_by = auth.uid(),
         reviewed_at = v_at, review_note = p_note
   where n.id = p_notice and n.status in ('open', 'sent')
  returning n.zone_id into v_zone;
  if v_zone is null then
    raise exception 'no such notice, or it is already closed' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'season_notice_review', 'season_notices', p_notice,
            jsonb_build_object('status', p_status, 'note', p_note, 'zone', v_zone));
  return v_at;
end $$;
revoke all on function public.admin_season_notice_review(uuid, text, text) from public, anon;
grant execute on function public.admin_season_notice_review(uuid, text, text) to authenticated;

-------------------------------------------------------------------------------
-- 5. One quiet push per episode, to every admin.
--
-- The shape push_dam_release_admins() established: the server proves itself with the push gate's
-- token, the row is claimed once so no phone is told twice, and what comes back is only what the
-- notification needs. It carries no level, so the service worker gives it the ordinary notice buzz
-- and no repeat knock - it cannot be mistaken for the automated alarm.
-------------------------------------------------------------------------------
create table public.season_pushed (
  notice_id uuid not null references public.season_notices (id) on delete cascade,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (notice_id, endpoint)
);
alter table public.season_pushed enable row level security;
create policy season_pushed_admin_read on public.season_pushed for select
  to authenticated using (public.is_admin());
revoke all on public.season_pushed from anon, authenticated;
grant select on public.season_pushed to authenticated;

create function public.push_season_due(p_token text)
returns table (notice_id uuid, endpoint text, keys jsonb, locale text, basin text,
               rose_days integer, rain_15d_mm double precision, floor_band text)
language plpgsql security definer set search_path = '' as $$
-- The out parameters share their names with the columns below, as in push_dam_release_admins().
#variable_conflict use_column
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  return query
  with owed as (
    select n.id, n.figures, z.basin, ps.endpoint, ps.keys, ps.locale
      from public.season_notices n
      join public.warning_zones z on z.id = n.zone_id
      join public.profiles p on p.role in ('admin', 'super_admin')
      join public.push_subscriptions ps on ps.user_id = p.user_id
     where n.status = 'open'
       and n.raised_at > now() - interval '2 days'
  ), claimed as (
    insert into public.season_pushed (notice_id, endpoint)
    select o.id, o.endpoint from owed o
    on conflict do nothing
    returning notice_id, endpoint
  )
  select o.id, o.endpoint, o.keys, o.locale, o.basin,
         (o.figures -> 'floor' ->> 'roseDays')::integer,
         (o.figures -> 'rain' ->> 'd15Mm')::double precision,
         o.figures -> 'floor' ->> 'band'
    from owed o
    join claimed c on c.notice_id = o.id and c.endpoint = o.endpoint;
end $$;
revoke all on function public.push_season_due(text) from public;
grant execute on function public.push_season_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 6. The settings an admin may change later without a migration.
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values (
  'season_state',
  '{"rose_days_min": 5, "rose_window": 7, "rain_window_days": 15}'::jsonb,
  'The soft notice''s rule (science plan Module 11): how many of the last seven days the key gauge''s floor must have risen, and which rain window is read against season_rain''s terciles. Both legs must hold. Advisory only: it raises a row for an admin and never publishes (safety rule 2).')
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- 7. The live state of every zone, for the dashboard.
--
-- The same figures the tick grades on, read on demand: an admin should see `wet` or `rising` on the
-- way up, not only the episode that crossed both legs. It carries the `blind` list, so a zone the
-- rule cannot judge says why instead of looking calm (safety rule 10).
-------------------------------------------------------------------------------
create function public.admin_season_signals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone record;
  v_signal record;
  v_out jsonb := '[]'::jsonb;
begin
  perform public.admin_only();
  for v_zone in select z.id, z.basin from public.warning_zones z order by z.basin loop
    select * into v_signal from public.season_signal(v_zone.id);
    if not found then
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'zoneId', v_zone.id, 'basin', v_zone.basin, 'grade', v_signal.grade,
      'reasons', to_jsonb(v_signal.reasons), 'stale', v_signal.stale,
      'figures', v_signal.figures));
  end loop;
  return jsonb_build_object('now', now(), 'zones', v_out);
end $$;
revoke all on function public.admin_season_signals() from public, anon;
grant execute on function public.admin_season_signals() to authenticated;

-------------------------------------------------------------------------------
-- 8. The bell's new queue.
--
-- Rebuilt whole rather than patched, because the function returns a set of queues and there is no
-- way to add one to it from outside. Everything above 'seasonNotice' is 20261109120100 word for
-- word; only the last block is new. Like every other queue it is silent and is never pushed - the
-- one push this feature sends is the one in section 5, once per episode.
-------------------------------------------------------------------------------
create or replace function public.admin_attention()
returns table (queue text, waiting integer, newest_id text, newest_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();

  -- Teams that have registered and are waiting to be verified.
  return query
  select 'units', count(*)::integer,
         (select u.id::text from public.authority_units u where u.status = 'pending'
           order by u.created_at desc limit 1),
         max(u.created_at)
    from public.authority_units u where u.status = 'pending';

  -- Residents' flood reports waiting to be moderated before they are shown to anyone.
  return query
  select 'reports', count(*)::integer,
         (select r.id::text from public.reports r where r.moderation_status = 'pending'
           order by r.created_at desc limit 1),
         max(r.created_at)
    from public.reports r where r.moderation_status = 'pending';

  -- A dam has graded "releasing" and raised a notice. Nothing has gone to anybody: a person
  -- reviews it and sends the release notice themselves (spec 15, safety rule 2).
  return query
  select 'damNotice', count(*)::integer,
         (select n.id::text from public.dam_notices n where n.status = 'open'
           order by n.raised_at desc limit 1),
         max(n.raised_at)
    from public.dam_notices n where n.status = 'open';

  -- Cases flagged as possible spam. They were delivered like any other (safety rule 1): this is
  -- the admin's chance to dismiss the flag, not to decide whether somebody gets help.
  return query
  select 'spam', count(*)::integer,
         (select v.sos_id::text from public.sos_review v
            join public.sos_requests s on s.id = v.sos_id
           where v.suspected_spam and v.spam_dismissed_at is null
           order by s.created_at desc limit 1),
         max(s.created_at)
    from public.sos_review v
    join public.sos_requests s on s.id = v.sos_id
   where v.suspected_spam and v.spam_dismissed_at is null;

  -- Cases that look like the same emergency reported twice, not yet merged or told apart.
  return query
  select 'duplicates', count(*)::integer,
         (select s.id::text from public.sos_requests s
           where s.possible_duplicate_of is not null and s.duplicate_of is null
           order by s.created_at desc limit 1),
         max(s.created_at)
    from public.sos_requests s
   where s.possible_duplicate_of is not null and s.duplicate_of is null;

  -- A team says it finished a rescue and nobody has confirmed it. The existing function owns the
  -- rule for how long is too long, so it is asked rather than second-guessed here.
  return query
  select 'unconfirmed', count(*)::integer, null::text, max(x.completed_at)
    from public.admin_unconfirmed_rescues() x where x.due;

  /*
   * An alert still in force whose next-update time has passed. The public already sees the grey
   * "not updated since" marker on it (safety rule 3) - this is the only line here that is not an
   * approval queue, and it is in the bell because the one thing worse than a stale alert is a
   * stale alert nobody has been told about. The admin extends, replaces or cancels it.
   */
  return query
  select 'staleAlerts', count(*)::integer,
         (select a.id::text from public.alerts a
           where a.cancelled_at is null and a.superseded_by is null
             and a.next_update_at < now()
           order by a.next_update_at desc limit 1),
         max(a.next_update_at)
    from public.alerts a
   where a.cancelled_at is null and a.superseded_by is null
     and a.next_update_at < now();

  /*
   * A12 part 2 (9 Nov 2026): a dam release notice the dam's own operator sent. This is not an
   * approval queue either - it has already gone out, by the owner's design - it is the admins
   * finding out, which spec 15 requires them to do at the same moment. Six hours, which is the
   * window in which an admin would extend, supersede or cancel it.
   */
  return query
  select 'operatorRelease', count(*)::integer,
         (select a.id::text from public.alerts a
           where a.signals_snapshot ->> 'sent_by' = 'operator'
             and a.issued_at > now() - interval '6 hours'
           order by a.issued_at desc limit 1),
         max(a.issued_at)
    from public.alerts a
   where a.signals_snapshot ->> 'sent_by' = 'operator'
     and a.issued_at > now() - interval '6 hours';

  -- A zone whose river has been rising for a week with the rain behind it (science plan Module 11).
  -- Nothing has gone to anybody but the admins: a person reads the figures and decides whether to
  -- send a Watch from the reviewed template (safety rule 2).
  return query
  select 'seasonNotice', count(*)::integer,
         (select n.id::text from public.season_notices n where n.status = 'open'
           order by n.raised_at desc limit 1),
         max(n.raised_at)
    from public.season_notices n where n.status = 'open';
end $$;

revoke execute on function public.admin_attention() from public, anon;
grant execute on function public.admin_attention() to authenticated;
