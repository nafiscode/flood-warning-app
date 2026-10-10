-- A7 (1/n): the bell — what a person missed (owner's request, 10 Oct).
--
-- Push and LINE (the rest of A7) reach a phone at the moment an alert goes out. Someone asleep,
-- out of signal, or without notifications turned on sees nothing. The bell is the catch-up copy:
-- when they next open Jaga, the last fourteen days of everything that concerned them is there.
--
-- Three sources feed it. Two are here:
--   * alerts for the tambons they care about, including the ones already lifted or replaced,
--     because "the warning for your mother's village was lifted" is news too;
--   * announcements from the admins, which are never an alert and carry no level or alert colour
--     (safety rules 2 and 10): no code and no announcement can look like a warning.
-- The third is their own SOS case, which the browser already reads with its own token through
-- sos_timeline(); it never passes through here, so no case id is sent to a function that
-- anyone may call.
--
-- A dam release is not a separate kind: under spec section 15 it reaches the public only as an
-- alert an admin sends from a reviewed template, so it arrives in the bell as an alert.

-------------------------------------------------------------------------------
-- Announcements: a word from the admins (a service notice, a change of hotline, "the map is
-- down"). Never a hazard, never a level.
-------------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  -- Reviewed text per locale, Thai required, exactly as alerts carry it. No machine translation
  -- at run time (CLAUDE.md).
  messages jsonb not null check (messages ? 'th'),
  -- Null means everyone in the service area; otherwise only these tambons see it.
  tambons text[],
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at is null or ends_at > starts_at),
  check (tambons is null or array_length(tambons, 1) between 1 and 500)
);
create index announcements_live_idx on public.announcements (starts_at desc)
  where cancelled_at is null;

alter table public.announcements enable row level security;

-- Anyone may read one that has started and has not been cancelled; the fourteen-day window is
-- applied by public_notices() below, not here, so an admin page can still list the old ones.
create policy "announcements: anyone reads live ones" on public.announcements
  for select to anon, authenticated
  using (cancelled_at is null and starts_at <= now());

create policy "announcements: admins read all" on public.announcements
  for select to authenticated using (public.is_admin());

create policy "announcements: admins write" on public.announcements
  for insert to authenticated with check (public.is_admin() and created_by = (select auth.uid()));

create policy "announcements: admins change their own" on public.announcements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-------------------------------------------------------------------------------
-- The feed. One call, the tambons the person cares about (their area, their home and the places
-- they watch), fourteen days back.
-------------------------------------------------------------------------------
create function public.public_notices(p_tambons text[] default '{}')
returns table (
  kind text,
  id uuid,
  hazard_type public.hazard_type,
  level public.alert_level,
  reason text,
  messages jsonb,
  issued_at timestamptz,
  next_update_at timestamptz,
  ended_at timestamptz,
  source text,
  tambons text[]
)
language sql stable set search_path = '' as $$
  with asked as (
    -- A phone sends at most its area, its home and ten watched places; anything beyond that is
    -- someone poking at the endpoint, so the list is cut rather than refused.
    select array(select distinct t from unnest(coalesce(p_tambons, '{}')) t
                  where t ~ '^[0-9]{6}$' order by t limit 60) as codes
  ),
  window_start as (select now() - interval '14 days' as from_time)
  select 'alert',
         a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at, a.next_update_at,
         coalesce(a.cancelled_at, (select s.issued_at from public.alerts s where s.id = a.superseded_by)),
         a.signals_snapshot ->> 'source',
         coalesce((select array_agg(at.tambon order by at.tambon)
                   from public.alert_tambons at where at.alert_id = a.id), '{}')
    from public.alerts a, asked, window_start
   where exists (select 1 from public.alert_tambons at
                  where at.alert_id = a.id and at.tambon = any (asked.codes))
     and greatest(
           a.issued_at,
           coalesce(a.cancelled_at,
                    (select s.issued_at from public.alerts s where s.id = a.superseded_by),
                    a.issued_at)
         ) >= window_start.from_time
  union all
  select 'announcement',
         n.id, null, null, '', n.messages, n.starts_at, null, n.ends_at, null,
         coalesce(n.tambons, '{}')
    from public.announcements n, asked, window_start
   where n.cancelled_at is null
     and n.starts_at <= now()
     and n.starts_at >= window_start.from_time
     and (n.tambons is null or n.tambons && asked.codes)
   order by 7 desc
   limit 100
$$;
grant execute on function public.public_notices(text[]) to anon, authenticated;

-------------------------------------------------------------------------------
-- What this person has already read. The phone keeps its own list (so a visitor without an
-- account has a working bell, and it works offline); for someone signed in the two are merged
-- here, so a new phone or a second browser opens with the same things read.
--
-- Only ever their own rows, and nothing in them says what the notice was about: an id, and when
-- it was read.
-------------------------------------------------------------------------------
create table public.notice_reads (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  notice_id text not null check (char_length(notice_id) between 1 and 120),
  read_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);

alter table public.notice_reads enable row level security;
create policy "notice_reads: own rows" on public.notice_reads
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

/**
 * Merge: the phone hands over the ids it has marked read, and gets back everything this account
 * has read. Rows older than sixty days are dropped on the way through, so the list cannot grow
 * without end (the bell itself only looks back fourteen days).
 */
create function public.notices_sync(p_ids text[] default '{}')
returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return;
  end if;
  insert into public.notice_reads (user_id, notice_id)
  select v_user, t
    from unnest(coalesce(p_ids, '{}')) t
   where char_length(t) between 1 and 120
   limit 500
  on conflict do nothing;

  delete from public.notice_reads r
   where r.user_id = v_user and r.read_at < now() - interval '60 days';

  return query select r.notice_id from public.notice_reads r where r.user_id = v_user;
end $$;
grant execute on function public.notices_sync(text[]) to authenticated;

-------------------------------------------------------------------------------
-- Writing an announcement. There is no screen for it yet (it belongs with the alert console in
-- the rest of A6), so this is how an admin posts one from the laptop.
-------------------------------------------------------------------------------
create function public.admin_announce(
  p_messages jsonb,
  p_tambons text[] default null,
  p_ends_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.admin_only();
  if p_messages is null or not (p_messages ? 'th') then
    raise exception 'An announcement needs Thai text' using errcode = 'check_violation';
  end if;
  insert into public.announcements (messages, tambons, ends_at, created_by)
  values (p_messages, p_tambons, p_ends_at, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.admin_announce(jsonb, text[], timestamptz) from public, anon;
grant execute on function public.admin_announce(jsonb, text[], timestamptz) to authenticated;

create function public.admin_announce_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  update public.announcements set cancelled_at = now() where id = p_id and cancelled_at is null;
end $$;
revoke execute on function public.admin_announce_cancel(uuid) from public, anon;
grant execute on function public.admin_announce_cancel(uuid) to authenticated;
