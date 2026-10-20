-- A10: an alert reaches the people who signed in and never said where they are (owner, 21 Oct).
--
-- Jaga has been telling only the people with a home tambon or a watched place. On jaga-dev that
-- is 2 accounts out of 27: the other 25 signed in - most of them through LINE - and stopped
-- before choosing a place. On the day it matters they would have been told nothing at all.
--
-- So an alert now also goes to every signed-in account with no home and no watched place, for
-- real alerts and for sent drills alike (the owner chose this over drills only: they signed in
-- to an app for four provinces, so the odds are they are in one of them, and a warning missed is
-- worse than a warning read for a tambon you are not in).
--
-- The one thing that must change with them is the words. An alert's stored text names its real
-- area; the personal road replaces that with "your area", which is true for somebody whose own
-- tambon is in it and a lie to somebody who never named one. So these recipients are marked, and
-- the sender gives them the stored words - "ต.ตะลุโบะ" and not "พื้นที่ของคุณ".
--
-- Nothing here widens who may read an alert: it is about who is told. A drill sent to the admins
-- or the teams is unchanged, since those audiences are by role and by coverage, not by place.

-------------------------------------------------------------------------------
-- 1. Who they are
-------------------------------------------------------------------------------
create function public.users_without_a_place() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id
    from public.profiles p
   where p.home_tambon is null
     and not exists (select 1 from public.saved_places sp
                      where sp.user_id = p.user_id and sp.notify)
$$;
revoke execute on function public.users_without_a_place() from public, anon, authenticated;

comment on function public.users_without_a_place() is
  'Signed-in accounts that never chose a home or a watched place. Told about every alert, with the alert area named rather than "your area".';

-------------------------------------------------------------------------------
-- 2. Told by push
--
-- Their phone follows no tambon, so `tambons && codes` never matched it. A subscription of
-- theirs now matches any alert. A drill to a chosen audience is unaffected: that road is by
-- role and coverage and does not look at places at all.
-------------------------------------------------------------------------------
create or replace function public.push_targets_for_alert(p_alert uuid)
returns table (endpoint text, keys jsonb, locale text)
language plpgsql security definer set search_path = '' as $$
declare
  a public.alerts;
  codes text[];
begin
  perform public.admin_only();
  select x.* into a from public.alerts x
   where x.id = p_alert and x.cancelled_at is null and x.superseded_by is null;
  if not found then return; end if;
  if a.is_drill and cardinality(a.drill_audience) = 0 then return; end if;

  perform public.log_access('push_targets', 'alerts', p_alert::text,
                            jsonb_build_object('drill', a.is_drill,
                                               'audience', to_jsonb(a.drill_audience)));
  select array_agg(at.tambon) into codes
    from public.alert_tambons at where at.alert_id = p_alert;

  if a.is_drill and not ('everyone' = any (a.drill_audience)) then
    return query
      select s.endpoint, s.keys, s.locale
        from public.push_subscriptions s
       where s.user_id in (select u from public.drill_audience_users(a.drill_audience, codes) u);
  else
    return query
      select s.endpoint, s.keys, s.locale
        from public.push_subscriptions s
       where s.tambons && codes
          or s.user_id in (select u from public.users_without_a_place() u);
  end if;
end $$;
revoke execute on function public.push_targets_for_alert(uuid) from public, anon;
grant execute on function public.push_targets_for_alert(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 3. Told by LINE, and told the area's real name
--
-- Output columns change (`placeless`), so the function is dropped and written again.
-------------------------------------------------------------------------------
drop function public.line_targets_for_alert(uuid);

create function public.line_targets_for_alert(p_alert uuid)
returns table (line_user_id text, locale text, placeless boolean)
language plpgsql security definer set search_path = '' as $$
declare
  a public.alerts;
  codes text[];
begin
  perform public.admin_only();
  select x.* into a from public.alerts x
   where x.id = p_alert and x.cancelled_at is null and x.superseded_by is null;
  if not found then return; end if;
  if a.is_drill and cardinality(a.drill_audience) = 0 then return; end if;

  perform public.log_access('line_targets', 'alerts', p_alert::text,
                            jsonb_build_object('drill', a.is_drill,
                                               'audience', to_jsonb(a.drill_audience)));
  select array_agg(at.tambon) into codes
    from public.alert_tambons at where at.alert_id = p_alert;

  if a.is_drill and not ('everyone' = any (a.drill_audience)) then
    return query
      select p.line_user_id, p.preferred_locale, false
        from public.profiles p
       where p.user_id in (select u from public.drill_audience_users(a.drill_audience, codes) u)
         and p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
  else
    return query
      -- Their own places are in it: the personal wording is the truthful one for them.
      select p.line_user_id, p.preferred_locale, false
        from public.alert_recipients(p_alert) r
        join public.profiles p on p.user_id = r.user_id
       where p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following)
      union
      -- No place of their own, so the alert must name the area it is really for.
      select p.line_user_id, p.preferred_locale, true
        from public.profiles p
       where p.user_id in (select u from public.users_without_a_place() u)
         and p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
  end if;
end $$;
revoke execute on function public.line_targets_for_alert(uuid) from public, anon;
grant execute on function public.line_targets_for_alert(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 4. The review step counts them
--
-- They are not in the area's head count and never were, so they are added to the totals and
-- also given a number of their own: an admin should see that most of what they are about to
-- send is going to people who never chose a place, which is a fact about Jaga worth knowing
-- before it is a fact about one alert.
-------------------------------------------------------------------------------
create or replace function public.admin_alert_preview(
  p_template uuid, p_tambons text[], p_note text default null,
  p_drill_audience text[] default '{}'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  codes text[];
  f record;
  reach jsonb;
  quota jsonb;
  v_overlaps jsonb;
  v_audience text[] := coalesce(p_drill_audience, '{}');
  v_drill_reach jsonb := null;
  v_messages jsonb;
  v_reason text;
begin
  perform public.admin_only();
  select coalesce(array_agg(t.code order by t.code), '{}') into codes
    from public.tambons t where t.code = any (coalesce(p_tambons, '{}'));
  if array_length(codes, 1) is null then
    raise exception 'Choose at least one tambon' using errcode = 'check_violation';
  end if;
  select * into f from public.alert_fill(p_template, codes, p_note);

  with placeless as (
    select p.user_id, p.line_user_id
      from public.profiles p
     where p.user_id in (select u from public.users_without_a_place() u)
  ),
  people as (
    select p.user_id, p.line_user_id from public.profiles p where p.home_tambon = any (codes)
    union
    select p.user_id, p.line_user_id
      from public.saved_places sp join public.profiles p on p.user_id = sp.user_id
     where sp.notify and sp.tambon = any (codes)
    union
    select user_id, line_user_id from placeless
  )
  select jsonb_build_object(
    'homes', (select count(*) from public.profiles p where p.home_tambon = any (codes)),
    'watched', (select count(*) from public.saved_places sp
                 where sp.notify and sp.tambon = any (codes)),
    'noPlace', (select count(*) from placeless),
    'people', (select count(*) from people),
    'push', (select count(distinct s.user_id) from public.push_subscriptions s
              where s.user_id in (select user_id from people)),
    'line', (select count(*) from people where line_user_id is not null))
    into reach;

  -- A drill for everyone reaches exactly what the alert would; any other audience is its own
  -- count, and the admins and teams are told wherever they are, not only where they live.
  if cardinality(v_audience) > 0 then
    if 'everyone' = any (v_audience) then
      v_drill_reach := reach;
    else
      with aud as (select u as user_id from public.drill_audience_users(v_audience, codes) u)
      select jsonb_build_object(
        'people', (select count(*) from aud),
        'push', (select count(distinct s.user_id) from public.push_subscriptions s
                  where s.user_id in (select user_id from aud)),
        'line', (select count(*) from public.profiles p
                  where p.user_id in (select user_id from aud) and p.line_user_id is not null))
        into v_drill_reach;
    end if;
    v_messages := public.alert_drill_messages(f.level, codes);
    v_reason := public.alert_drill_reason('th');
  else
    v_messages := f.messages;
    v_reason := f.reason;
  end if;

  select jsonb_build_object('used', q.messages_used, 'limit', q.monthly_limit) into quota
    from public.line_quota_usage q
   where q.month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'level', a.level, 'drill', a.is_drill, 'shared', o.shared)
           order by a.issued_at desc), '[]'::jsonb)
    into v_overlaps
    from public.alerts a
    join lateral (select count(*)::integer as shared from public.alert_tambons at
                   where at.alert_id = a.id and at.tambon = any (codes)) o on o.shared > 0
   where a.superseded_by is null and a.cancelled_at is null;

  return jsonb_build_object(
    'level', f.level, 'reason', v_reason, 'messages', v_messages,
    'tambons', array_length(codes, 1), 'reach', reach, 'lineQuota', quota,
    'overlaps', v_overlaps, 'drillReach', v_drill_reach);
end $$;
revoke execute on function public.admin_alert_preview(uuid, text[], text, text[]) from public, anon;
grant execute on function public.admin_alert_preview(uuid, text[], text, text[]) to authenticated;
