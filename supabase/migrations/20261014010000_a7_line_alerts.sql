-- A7, LINE: an alert also goes out through the LINE Official Account, to the people it concerns
-- and to nobody else (spec 4.8: LINE bills per recipient, so it is never a broadcast).
--
-- Who gets it: someone who signed in with LINE (so Jaga knows their LINE id), whose home or a
-- watched place with notifications on is in the alert's area, and who has not blocked the
-- account. Jaga learns of a block from LINE's webhook; until LINE says otherwise a person who
-- signed in with LINE is taken to be a friend, because LINE Login adds the account as a friend
-- at sign-in and tells Jaga nothing about people who were friends before the webhook existed.
--
-- The addresses are read by the admin who has just published, with their own session, and it is
-- logged - the same rule as web push. A drill is never sent. What LINE says it has counted
-- against the month's quota is written down after every send, so the admins see the real figure,
-- not Jaga's guess.

-- What LINE's webhook has told Jaga about a LINE user: following, or gone.
create table public.line_follows (
  line_user_id text primary key check (line_user_id ~ '^U[0-9a-f]{32}$'),
  following boolean not null,
  changed_at timestamptz not null default now()
);
alter table public.line_follows enable row level security;
revoke all on public.line_follows from public, anon, authenticated;

alter table public.line_quota_usage
  add column checked_at timestamptz,
  -- 70 or 90 once the admins have been warned at that mark this month (CLAUDE.md, budget).
  add column warned_at integer;

-- Follow, unfollow: written by Jaga's server only, which has checked LINE's signature first and
-- proves itself with the same token it uses for web push.
create function public.line_follow_event(p_token text, p_line_user text, p_following boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_line_user !~ '^U[0-9a-f]{32}$' then
    return;
  end if;
  insert into public.line_follows (line_user_id, following) values (p_line_user, p_following)
  on conflict (line_user_id) do update set following = excluded.following, changed_at = now();
end $$;
revoke execute on function public.line_follow_event(text, text, boolean) from public;
grant execute on function public.line_follow_event(text, text, boolean) to anon, authenticated;

-- "My area status" asked in the LINE chat: the alerts in force for that person's own places.
-- For Jaga's server, on behalf of the LINE user LINE's signed webhook named. Levels and areas
-- only - what the public status already shows everyone.
create function public.line_status_for(p_token text, p_line_user text)
returns table (locale text, known boolean, has_places boolean, alerts jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
  mine text[];
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into p from public.profiles x where x.line_user_id = p_line_user;
  if p.user_id is null then
    return query select 'th'::text, false, false, '[]'::jsonb;
    return;
  end if;
  select array_agg(distinct t) into mine from (
    select p.home_tambon as t where p.home_tambon is not null
    union
    select sp.tambon from public.saved_places sp
     where sp.user_id = p.user_id and sp.tambon is not null
  ) z;
  return query
    select p.preferred_locale, true, coalesce(array_length(mine, 1), 0) > 0,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'level', a.level, 'messages', a.messages, 'next_update_at', a.next_update_at)
                    order by a.issued_at desc)
             from public.alerts a
             where not a.is_drill and a.cancelled_at is null and a.superseded_by is null
               and exists (select 1 from public.alert_tambons at
                            where at.alert_id = a.id and at.tambon = any (mine))
           ), '[]'::jsonb);
end $$;
revoke execute on function public.line_status_for(text, text) from public;
grant execute on function public.line_status_for(text, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- For the admin who has just published: the LINE ids the alert is for.
-------------------------------------------------------------------------------
create function public.line_targets_for_alert(p_alert uuid)
returns table (line_user_id text, locale text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if not exists (select 1 from public.alerts a
                  where a.id = p_alert and not a.is_drill
                    and a.cancelled_at is null and a.superseded_by is null) then
    return;
  end if;
  perform public.log_access('line_targets', 'alerts', p_alert::text, '{}'::jsonb);
  return query
    select p.line_user_id, p.preferred_locale
    from public.alert_recipients(p_alert) r
    join public.profiles p on p.user_id = r.user_id
    where p.line_user_id is not null
      and not exists (select 1 from public.line_follows f
                       where f.line_user_id = p.line_user_id and not f.following);
end $$;
revoke execute on function public.line_targets_for_alert(uuid) from public, anon;
grant execute on function public.line_targets_for_alert(uuid) to authenticated;

-- How many people that would be, and what is left of the month: for the review step, before
-- anything is sent. Counts only.
create function public.line_reach(p_tambons text[])
returns table (recipients integer, used integer, monthly_limit integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
    select (select count(distinct p.user_id)::integer
              from public.profiles p
             where p.line_user_id is not null
               and not exists (select 1 from public.line_follows f
                                where f.line_user_id = p.line_user_id and not f.following)
               and (p.home_tambon = any (coalesce(p_tambons, '{}'))
                    or exists (select 1 from public.saved_places sp
                                where sp.user_id = p.user_id and sp.notify
                                  and sp.tambon = any (coalesce(p_tambons, '{}'))))),
           coalesce(q.messages_used, 0), coalesce(q.monthly_limit, 0)
      from (select 1) one
      left join public.line_quota_usage q on q.month = date_trunc('month', now())::date;
end $$;
revoke execute on function public.line_reach(text[]) from public, anon;
grant execute on function public.line_reach(text[]) to authenticated;

-- What came of the send, and what LINE itself says the month stands at. Returns the mark the
-- admins should now be warned at (70 or 90), once per mark per month, else null.
create function public.line_record_alert(
  p_alert uuid,
  p_recipients integer,
  p_failed integer,
  p_used integer,
  p_limit integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', now())::date;
  q public.line_quota_usage;
  share numeric;
  mark integer;
begin
  perform public.admin_only();
  insert into public.alert_deliveries (alert_id, channel, recipients, line_messages_used, status, sent_at)
  values (p_alert, 'line', greatest(coalesce(p_recipients, 0), 0),
          greatest(coalesce(p_recipients, 0), 0),
          case when coalesce(p_failed, 0) > 0 then 'partial' else 'sent' end, now());
  if p_used is null or coalesce(p_limit, 0) <= 0 then
    return null;
  end if;
  insert into public.line_quota_usage (month, messages_used, monthly_limit, checked_at)
  values (m, p_used, p_limit, now())
  on conflict (month) do update
    set messages_used = excluded.messages_used, monthly_limit = excluded.monthly_limit,
        checked_at = now()
  returning * into q;
  share := q.messages_used::numeric / q.monthly_limit;
  mark := case when share >= 0.9 then 90 when share >= 0.7 then 70 end;
  if mark is null or coalesce(q.warned_at, 0) >= mark then
    return null;
  end if;
  update public.line_quota_usage set warned_at = mark where month = m;
  perform public.log_access('line_quota_warning', 'line_quota_usage', m::text,
                            jsonb_build_object('percent', mark, 'used', q.messages_used,
                                               'limit', q.monthly_limit));
  return mark;
end $$;
revoke execute on function public.line_record_alert(uuid, integer, integer, integer, integer)
  from public, anon;
grant execute on function public.line_record_alert(uuid, integer, integer, integer, integer)
  to authenticated;
