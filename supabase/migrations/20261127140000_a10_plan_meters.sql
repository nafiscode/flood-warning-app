-- The free-plan meters of Vercel and Supabase, written down so the admins can watch them (the owner,
-- 27 Nov 2026, after both providers emailed: Vercel at 75% of its Active CPU, Supabase "depleting
-- its Disk IO Budget". "I will upgrade, but I want to monitor these two until we are really close
-- to the max.").
--
-- Neither provider lets a project read its own plan usage from inside the database, and Jaga holds
-- no token for their dashboards (and takes none: a new secret on a public repo's live site for a
-- number an admin can read in ten seconds is a poor trade). So the meters are typed in by an admin
-- from the provider's own page, and the page (lib/plan-limits.ts) turns the series into a pace and
-- a date. What the database CAN measure about itself it measures, once a night: its size, and how
-- much it has read and written since Postgres last reset its counters.
--
-- Nothing here touches an alert, a request for help or any user data. The table holds numbers and a
-- short note, no personal data, so it is admin-only and carries no audit trail beyond who typed it.
--
--   plan_readings         one number per row: service, meter, value, when read, the cycle's reset date
--   admin_plan_readings() the last N days of them, for an admin
--   admin_plan_add()      an admin writes one down
--   admin_plan_delete()   an admin removes one they typed (the super admin: any, the nightly ones too)
--   admin_plan_health()   what the database can say about itself: size, heaviest tables, the crons
--   push_plan_readings()  the readings, for the push tick (server's gate token, no login)
--   push_plan_due()       the super admin's phones that have not yet heard about an episode
--   plan_snapshot()       once a night: size and I/O totals into plan_readings, and the old cron log out
--
-- **On the cron log.** pg_cron writes a row into cron.job_run_details when every job starts and
-- updates it when it ends, and nothing ever deletes them. Jaga runs the push tick every minute and
-- six more jobs between five minutes and an hour: about 1,900 runs a day, 3,800 writes of a table
-- that only grows. Supabase's own guide to a depleted Disk IO budget names exactly this table.
-- plan_snapshot() keeps seven days of it, which is far more than anyone reads.

create table public.plan_readings (
  id bigint generated always as identity primary key,
  service text not null check (service in ('vercel', 'supabase')),
  meter text not null check (meter ~ '^[a-z_]{2,32}$'),
  value double precision not null check (value >= 0 and value < 1e12),
  read_at timestamptz not null default now(),
  -- A cycle meter: the date the provider says it starts again (Supabase shows "Resets on ...").
  resets_on date,
  note text check (char_length(note) <= 200),
  created_by uuid references public.profiles (user_id) on delete set null,
  -- True for the nightly snapshot the database took of itself.
  auto boolean not null default false
);
create index plan_readings_series on public.plan_readings (service, meter, read_at desc);

alter table public.plan_readings enable row level security;
-- No policy and no grant to a client: every read and write goes through the functions below, which
-- check for an admin themselves. (The project's default privileges hand new tables back to anon and
-- authenticated, so they are taken away explicitly: see 20261009234000_a12_dam_grants.)
revoke all on public.plan_readings from anon, authenticated;

create function public.admin_plan_readings(p_days integer default 120)
returns table (id bigint, service text, meter text, value double precision, read_at timestamptz,
               resets_on date, note text, auto boolean, by_me boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.service, r.meter, r.value, r.read_at, r.resets_on, r.note, r.auto,
         r.created_by is not distinct from (select auth.uid())
    from public.plan_readings r
   where public.is_admin()
     and r.read_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 120), 800)))
   order by r.read_at asc, r.id asc
$$;
revoke all on function public.admin_plan_readings(integer) from public, anon;
grant execute on function public.admin_plan_readings(integer) to authenticated;

create function public.admin_plan_add(p_service text, p_meter text, p_value double precision,
                                      p_resets_on date default null, p_note text default null,
                                      p_read_at timestamptz default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_at timestamptz := coalesce(p_read_at, now());
begin
  perform public.admin_only();
  if p_service not in ('vercel', 'supabase') then
    raise exception 'unknown service' using errcode = 'check_violation';
  end if;
  -- A reading is of the past or now, never of tomorrow: a typo in the date would otherwise sit
  -- at the end of the series and become "the latest".
  if v_at > now() + interval '1 hour' then
    raise exception 'a reading cannot be from the future' using errcode = 'check_violation';
  end if;
  insert into public.plan_readings (service, meter, value, read_at, resets_on, note, created_by)
    values (p_service, p_meter, p_value, v_at, p_resets_on,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning plan_readings.id into v_id;
  return v_id;
end $$;
revoke all on function public.admin_plan_add(text, text, double precision, date, text, timestamptz)
  from public, anon;
grant execute on function public.admin_plan_add(text, text, double precision, date, text,
  timestamptz) to authenticated;

create function public.admin_plan_delete(p_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_gone integer;
begin
  perform public.admin_only();
  delete from public.plan_readings r
   where r.id = p_id
     and (public.is_super_admin() or (r.created_by = auth.uid() and not r.auto));
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end $$;
revoke all on function public.admin_plan_delete(bigint) from public, anon;
grant execute on function public.admin_plan_delete(bigint) to authenticated;

-- What the database can say about itself. Counters are since `stats_reset`: Postgres zeroes them
-- when a project restarts from a pause or a restore, so "since" is part of the answer.
create function public.admin_plan_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_db bigint;
  v_storage bigint;
  v_reset timestamptz;
  v_hit double precision;
  v_conns integer;
  v_users bigint;
  v_writers jsonb;
  v_crons jsonb;
  v_log jsonb;
  v_io jsonb := null;
begin
  perform public.admin_only();
  select pg_database_size(current_database()) into v_db;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v_storage from storage.objects o;
  select d.stats_reset, case when d.blks_hit + d.blks_read = 0 then null
                             else d.blks_hit::double precision / (d.blks_hit + d.blks_read) end
    into v_reset, v_hit
    from pg_stat_database d where d.datname = current_database();
  select count(*) into v_conns from pg_stat_activity where datname = current_database();
  select count(*) into v_users from auth.users;

  select coalesce(jsonb_agg(w order by (w ->> 'writes')::bigint desc), '[]'::jsonb) into v_writers
    from (select jsonb_build_object(
                   'table', t.relname,
                   'writes', t.n_tup_ins + t.n_tup_upd + t.n_tup_del,
                   'dead', t.n_dead_tup,
                   'live', t.n_live_tup,
                   'bytes', pg_total_relation_size(t.relid)) w
            from pg_stat_user_tables t
           where t.schemaname = 'public'
           order by t.n_tup_ins + t.n_tup_upd + t.n_tup_del desc
           limit 8) top;

  select coalesce(jsonb_agg(c order by (c ->> 'runs')::bigint desc), '[]'::jsonb) into v_crons
    from (select jsonb_build_object(
                   'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
                   'runs', (select count(*) from cron.job_run_details d
                             where d.jobid = j.jobid and d.start_time > now() - interval '24 hours'),
                   'failed', (select count(*) from cron.job_run_details d
                               where d.jobid = j.jobid and d.status = 'failed'
                                 and d.start_time > now() - interval '24 hours')) c
            from cron.job j) jobs;

  select jsonb_build_object('rows', (select count(*) from cron.job_run_details),
                            'bytes', pg_total_relation_size('cron.job_run_details'::regclass))
    into v_log;

  -- Postgres 17 counts bytes; 16 counts operations of a fixed size. Try the newer, then the older,
  -- and say nothing rather than fail if neither is there.
  begin
    execute 'select jsonb_build_object(''read'', coalesce(sum(read_bytes), 0),
                                       ''write'', coalesce(sum(write_bytes), 0)) from pg_stat_io'
      into v_io;
  exception when others then
    begin
      execute 'select jsonb_build_object(''read'', coalesce(sum(reads * op_bytes), 0),
                                         ''write'', coalesce(sum(writes * op_bytes), 0))
                 from pg_stat_io'
        into v_io;
    exception when others then
      v_io := null;
    end;
  end;

  return jsonb_build_object(
    'at', now(), 'dbBytes', v_db, 'storageBytes', v_storage, 'statsReset', v_reset,
    'cacheHit', v_hit, 'connections', v_conns, 'authUsers', v_users,
    'writers', v_writers, 'crons', v_crons, 'cronLog', v_log, 'io', v_io);
end $$;
revoke all on function public.admin_plan_health() from public, anon;
grant execute on function public.admin_plan_health() to authenticated;

-- The push to the super admin when a service reaches "upgrade now" (the owner, 27 Nov 2026: "the
-- app should push for super admin to know when it's critical to upgrade each of these").
--
-- The verdict is worked out in one place, lib/plan-limits.ts, so the page and the push can never
-- disagree. The push tick (lib/push-server.ts) reads the readings here by the server's gate token,
-- works out the verdict, and for a service that is at "now" asks for the super admin's phones that
-- have not yet heard about that episode. `p_signature` names the episode: the meters at the line
-- and a two-day window, so one push per two days while it stays critical, and at once when a new
-- meter joins. The database claims each (service, signature, phone) once, as season_pushed does.
--
-- It is an ordinary push, not an alert: no level, no ring, and nothing in it touches `alerts`.
create table public.plan_pushed (
  service text not null check (service in ('vercel', 'supabase')),
  signature text not null check (char_length(signature) <= 200),
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (service, signature, endpoint)
);
alter table public.plan_pushed enable row level security;
revoke all on public.plan_pushed from anon, authenticated;

create function public.push_plan_readings(p_token text)
returns table (service text, meter text, value double precision, read_at timestamptz,
               resets_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.service, r.meter, r.value, r.read_at, r.resets_on
      from public.plan_readings r
     where r.read_at > now() - interval '120 days'
     order by r.read_at asc, r.id asc;
end $$;
revoke all on function public.push_plan_readings(text) from public;
grant execute on function public.push_plan_readings(text) to anon, authenticated;

create function public.push_plan_due(p_token text, p_service text, p_signature text)
returns table (endpoint text, keys jsonb, locale text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_service not in ('vercel', 'supabase') then
    raise exception 'unknown service' using errcode = 'check_violation';
  end if;
  return query
  with owed as (
    select ps.endpoint, ps.keys, ps.locale
      from public.profiles p
      join public.push_subscriptions ps on ps.user_id = p.user_id
     where p.role = 'super_admin'
  ), claimed as (
    insert into public.plan_pushed (service, signature, endpoint)
    select p_service, p_signature, o.endpoint from owed o
    on conflict do nothing
    returning plan_pushed.endpoint
  )
  select o.endpoint, o.keys, o.locale from owed o join claimed c on c.endpoint = o.endpoint;
end $$;
revoke all on function public.push_plan_due(text, text, text) from public;
grant execute on function public.push_plan_due(text, text, text) to anon, authenticated;

-- Once a night: the database writes down its own size and its I/O totals (the page turns two nights
-- into a rate), and drops cron log older than a week. Reachable by no client.
create function public.plan_snapshot()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_io jsonb;
begin
  insert into public.plan_readings (service, meter, value, note, auto)
    values ('supabase', 'db_size', pg_database_size(current_database()) / 1048576.0,
            'nightly snapshot', true);
  begin
    execute 'select jsonb_build_object(''read'', coalesce(sum(read_bytes), 0),
                                       ''write'', coalesce(sum(write_bytes), 0)) from pg_stat_io'
      into v_io;
  exception when others then
    begin
      execute 'select jsonb_build_object(''read'', coalesce(sum(reads * op_bytes), 0),
                                         ''write'', coalesce(sum(writes * op_bytes), 0))
                 from pg_stat_io'
        into v_io;
    exception when others then
      v_io := null;
    end;
  end;
  if v_io is not null then
    insert into public.plan_readings (service, meter, value, note, auto)
      values ('supabase', 'io_read_gb', (v_io ->> 'read')::double precision / 1073741824.0,
              'nightly snapshot, total since the counters last reset', true),
             ('supabase', 'io_write_gb', (v_io ->> 'write')::double precision / 1073741824.0,
              'nightly snapshot, total since the counters last reset', true);
  end if;
  delete from public.plan_readings where auto and read_at < now() - interval '400 days';
  delete from public.plan_pushed where sent_at < now() - interval '60 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end $$;
revoke all on function public.plan_snapshot() from public, anon, authenticated;

-- 02:10 Bangkok, off the hour so it never starts with the one-minute push tick, and after the
-- usage roll-up (00:37) and the season state (01:20) so the three never run in one second.
select cron.schedule('jaga-plan-snapshot', '10 19 * * *', 'select public.plan_snapshot()');
