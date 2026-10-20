-- A10: a drill that is sent (the owner, 20 Oct).
--
-- Until today a drill was two things at once: not a real alert, and invisible - the public could
-- not read it, push and LINE refused it, and it never became an area's status. That is the only
-- drill there was, and it proves nothing about the road the alert travels down.
--
-- So the two halves come apart. `is_drill` keeps its exact meaning and every rule written on it
-- stands: a drill never suppresses the automated alarm, never gates a field rescue, is never
-- counted in the usage figures, and never moves `tambon_level` (which is pinned below, because
-- the place-check windows and every other operational threshold read it). The new column
-- `drill_audience` opens one road only: who is told, and who can see it while it stands.
--
--   '{}'         the drill there has always been: nobody is told, nobody outside the console sees it
--   'admins'     the admins
--   'rescue'     verified units that can carry out a rescue
--   'units'      every verified authority unit
--   'everyone'   everyone whose home or watched place is in the chosen area
--
-- The list is a union and the admin may tick several. Anything but '{}' also replaces the words:
-- a sent drill never carries the template's instructions, because an instruction read out of
-- its first line is an instruction. It carries a message that says what it is (below).

-------------------------------------------------------------------------------
-- 1. The column
-------------------------------------------------------------------------------
alter table public.alerts add column drill_audience text[] not null default '{}';

alter table public.alerts
  add constraint alerts_drill_audience_values
    check (drill_audience <@ array['admins', 'rescue', 'units', 'everyone']::text[]),
  -- A real alert reaches everyone it names; it can never carry a drill's audience.
  add constraint alerts_drill_audience_needs_drill
    check (cardinality(drill_audience) = 0 or is_drill);

comment on column public.alerts.drill_audience is
  'Who a drill is sent to and visible to. Empty: the silent drill. Never set on a real alert.';

-- Asked of every drill the public reads, so it is worth an index on the few rows that have one.
create index alerts_drill_audience_idx on public.alerts using gin (drill_audience)
  where is_drill;

-------------------------------------------------------------------------------
-- 2. The words of a sent drill
--
-- Reviewed here, in the migration, exactly like the alert templates: no text is composed at
-- send time and none is machine-translated (CLAUDE.md, UI text). The level and the area are the
-- only things filled in, and they are named as what the message *would have been*, never as
-- what is happening.
-------------------------------------------------------------------------------
create function public.alert_level_name(p_level public.alert_level, p_locale text)
returns text language sql immutable set search_path = '' as $$
  select case p_locale
    when 'th' then case p_level
      when 'watch' then 'เฝ้าระวัง' when 'warning' then 'เตือนภัย' when 'evacuate' then 'อพยพ'
      when 'return' then 'กลับบ้านได้' else 'ปกติ' end
    when 'ms' then case p_level
      when 'watch' then 'Berjaga-jaga' when 'warning' then 'Amaran' when 'evacuate' then 'Pindah'
      when 'return' then 'Boleh balik rumah' else 'Biasa' end
    else case p_level
      when 'watch' then 'Watch' when 'warning' then 'Warning' when 'evacuate' then 'Evacuate'
      when 'return' then 'Safe to return' else 'Normal' end
  end
$$;

create function public.alert_drill_text(
  p_level public.alert_level, p_tambons text[], p_locale text
) returns text
language sql stable set search_path = '' as $$
  select case p_locale
    when 'th' then
      'ซ้อมระบบแจ้งเตือน นี่คือการซ้อมเท่านั้น ไม่ใช่การแจ้งเตือนจริง ' ||
      'ขณะนี้ไม่มีภัยในพื้นที่ของท่าน ผู้ดูแลระบบ Jaga กำลังทดสอบว่าการแจ้งเตือนส่งถึงทุกคนได้จริงหรือไม่ ' ||
      'ท่านไม่ต้องทำอะไร หากเป็นเหตุจริง ข้อความนี้จะเป็นระดับ' ||
      public.alert_level_name(p_level, 'th') || ' สำหรับ ' ||
      public.alert_area_text(p_tambons, 'th') || ' และจะบอกสิ่งที่ต้องทำ จบการซ้อม'
    when 'ms' then
      'LATIHAN SISTEM AMARAN. Ini latihan sahaja, bukan amaran sebenar. ' ||
      'Tiada bahaya di kawasan anda sekarang. Pentadbir Jaga sedang menguji sama ada amaran ' ||
      'sampai kepada semua orang. Anda tidak perlu buat apa-apa. Jika ini kejadian sebenar, ' ||
      'mesej ini ialah amaran ' || public.alert_level_name(p_level, 'ms') || ' untuk ' ||
      public.alert_area_text(p_tambons, 'ms') || ', dan akan memberitahu apa yang perlu dibuat. ' ||
      'Tamat latihan.'
    else
      'ALERT SYSTEM DRILL. This is only a drill, not a real alert. There is no hazard in your ' ||
      'area right now. The Jaga admins are testing whether alerts reach everyone. You do not ' ||
      'need to do anything. In a real event this would be a ' ||
      public.alert_level_name(p_level, 'en') || ' alert for ' ||
      public.alert_area_text(p_tambons, 'en') || ', and it would tell you what to do. End of drill.'
  end
$$;

-- The reason line, which the card shows above the words and the log keeps.
create function public.alert_drill_reason(p_locale text)
returns text language sql immutable set search_path = '' as $$
  select case p_locale
    when 'th' then 'ซ้อมระบบแจ้งเตือนโดยผู้ดูแลระบบ ไม่ใช่เหตุจริง'
    when 'ms' then 'Latihan sistem amaran oleh pentadbir. Bukan kejadian sebenar.'
    else 'An alert system drill run by the admins. Not a real event.'
  end
$$;

/**
 * The whole message object of a sent drill, in the shape alert_fill returns: the three
 * languages, and the reason in the two that are not Thai.
 */
create function public.alert_drill_messages(p_level public.alert_level, p_tambons text[])
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'th', public.alert_drill_text(p_level, p_tambons, 'th'),
    'ms', public.alert_drill_text(p_level, p_tambons, 'ms'),
    'en', public.alert_drill_text(p_level, p_tambons, 'en'),
    'reason_ms', public.alert_drill_reason('ms'),
    'reason_en', public.alert_drill_reason('en'))
$$;

revoke execute on function public.alert_level_name(public.alert_level, text) from public;
revoke execute on function public.alert_drill_text(public.alert_level, text[], text) from public;
revoke execute on function public.alert_drill_reason(text) from public;
revoke execute on function public.alert_drill_messages(public.alert_level, text[]) from public;

-------------------------------------------------------------------------------
-- 3. Who an audience is
--
-- Two different questions, so two functions: who may *see* a drill that stands (the policies
-- below), and who is *told* about it (the push and LINE target functions further down).
--
-- The second is not simply the first inside the chosen tambons. A rescue team covering Tak Bai
-- has that tambon in its coverage, not necessarily in its own watched places - so a drill to the
-- teams goes by coverage, and a drill to the admins goes to the admins. Only 'everyone' follows
-- the ordinary road of home and watched places.
-------------------------------------------------------------------------------
create function public.drill_visible(p_audience text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select 'everyone' = any (p_audience)
      or ('admins' = any (p_audience) and public.is_admin())
      or ('units' = any (p_audience) and public.is_verified_authority())
      or ('rescue' = any (p_audience) and exists (
            select 1 from public.authority_units u
             where u.user_id = (select auth.uid()) and u.status = 'verified'
               and u.capabilities && array['rescue']::public.authority_capability[]))
$$;
grant execute on function public.drill_visible(text[]) to anon, authenticated;

create function public.drill_audience_users(p_audience text[], p_tambons text[])
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id from public.profiles p
   where 'admins' = any (p_audience) and p.role in ('admin', 'super_admin')
  union
  select u.user_id
    from public.authority_units u
    join public.authority_coverage c on c.unit_id = u.id
   where u.status = 'verified'
     and c.tambon = any (coalesce(p_tambons, '{}'))
     and ('units' = any (p_audience)
          or ('rescue' = any (p_audience)
              and u.capabilities && array['rescue']::public.authority_capability[]))
$$;
revoke execute on function public.drill_audience_users(text[], text[]) from public, anon;

-------------------------------------------------------------------------------
-- 4. Who may read it
--
-- Still two policies rather than one, for the reason the A6 migration gave: a visitor must
-- never depend on being allowed to call is_admin() to read the alerts in force. The visitor's
-- policy therefore asks only about the row, and the one that asks about the reader is for
-- signed-in people.
-------------------------------------------------------------------------------
drop policy "alerts: everyone reads real ones" on public.alerts;
create policy "alerts: everyone reads real ones and open drills" on public.alerts
  for select to anon, authenticated
  using (not is_drill or 'everyone' = any (drill_audience));

create policy "alerts: a drill sent to you" on public.alerts
  for select to authenticated
  using (is_drill and cardinality(drill_audience) > 0 and public.drill_visible(drill_audience));

-------------------------------------------------------------------------------
-- 5. What a drill must still never touch
--
-- tambon_level is the level the rest of Jaga works from: the place-check windows (A10), and
-- anything else that tightens as the water rises. A drill is now readable, so it would have
-- been picked up here. It must not be: a drill is a test of the road, never a change in what
-- the people on the ground are asked to do.
--
-- The others need no change and are listed so the next reader can see they were considered:
-- the automated alarm (a8), field rescues (a5) and the usage figures (a13) all read
-- `not is_drill` already, and keep doing so.
-------------------------------------------------------------------------------
create or replace function public.tambon_level(p_tambon text, p_hazard public.hazard_type default 'flood')
returns public.alert_level
language sql stable set search_path = '' as $$
  select coalesce(
    (select a.level
       from public.alerts a
       join public.alert_tambons at on at.alert_id = a.id
      where at.tambon = p_tambon
        and a.hazard_type = p_hazard
        and not a.is_drill
        and a.superseded_by is null
        and a.cancelled_at is null
      order by a.issued_at desc
      limit 1),
    'normal'::public.alert_level)
$$;

-------------------------------------------------------------------------------
-- 6. What the public reads says which it is
--
-- A sent drill is shown, and shown as a drill: the app needs to know, so the card can say so
-- in the reader's own language above the words. Safety rule 3 is untouched - the drill keeps
-- its level badge, and the drill mark is added beside it, never in place of it.
--
-- Output columns change, so both functions are dropped and written again.
-------------------------------------------------------------------------------
drop function public.public_alert_status();
create function public.public_alert_status()
returns table (
  alert_id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz,
  onset_from timestamptz, onset_to timestamptz, return_from timestamptz, return_to timestamptz,
  source text, tambons text[], details jsonb, drill boolean
)
language sql stable set search_path = '' as $$
  select a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at, a.next_update_at,
         lower(a.expected_onset_window), upper(a.expected_onset_window),
         lower(a.expected_return_window), upper(a.expected_return_window),
         a.signals_snapshot ->> 'source',
         coalesce((select array_agg(at.tambon order by at.tambon)
                   from public.alert_tambons at where at.alert_id = a.id), '{}'),
         case a.signals_snapshot ->> 'kind'
           when 'dam_release' then jsonb_build_object(
                'kind', 'dam_release',
                'damCode', a.signals_snapshot ->> 'dam_code',
                'gatesOpenAt', a.signals_snapshot ->> 'gates_open_at',
                'releaseCms', a.signals_snapshot -> 'release_cms',
                'expectedEndAt', a.signals_snapshot ->> 'expected_end_at',
                'arrivalSource', a.signals_snapshot ->> 'arrival_source')
           when 'auto_alarm' then jsonb_build_object('kind', 'auto_alarm')
           else null end,
         a.is_drill
  from public.alerts a
  where a.superseded_by is null and a.cancelled_at is null
  order by a.issued_at desc
$$;
grant execute on function public.public_alert_status() to anon, authenticated;

drop function public.public_notices(text[]);
create function public.public_notices(p_tambons text[] default '{}')
returns table (
  kind text, id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz, ended_at timestamptz,
  source text, tambons text[], drill boolean
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
                   from public.alert_tambons at where at.alert_id = a.id), '{}'),
         a.is_drill
    from public.alerts a, asked, window_start
   where exists (select 1 from public.alert_tambons at
                  where at.alert_id = a.id and at.tambon = any (asked.codes))
     and (
           -- Still in force: always there, however long ago it was issued.
           (a.superseded_by is null and a.cancelled_at is null)
           or greatest(
                a.issued_at,
                coalesce(a.cancelled_at,
                         (select s.issued_at from public.alerts s where s.id = a.superseded_by),
                         a.issued_at)
              ) >= window_start.from_time
         )
  union all
  select 'announcement',
         n.id, null, null, '', n.messages, n.starts_at, null, n.ends_at, null,
         coalesce(n.tambons, '{}'), false
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
-- 7. "Everywhere people use Jaga", as an area to choose
--
-- A drill is worth nothing in a tambon where nobody is listening, and it should not have to be
-- assembled by hand out of the places people happen to have saved. The admin ticks one box and
-- the server works out the codes: the browser is never handed a map of where Jaga's users live.
-- Admin only, like everything else in the console.
-------------------------------------------------------------------------------
create function public.tambons_with_people() returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
    select distinct z.t from (
      select p.home_tambon as t from public.profiles p where p.home_tambon is not null
      union
      select sp.tambon from public.saved_places sp where sp.notify and sp.tambon is not null
    ) z
    order by z.t;
end $$;
revoke execute on function public.tambons_with_people() from public, anon;
grant execute on function public.tambons_with_people() to authenticated;

-------------------------------------------------------------------------------
-- 8. Publishing, with the audience
--
-- One argument more, so the function is dropped and written again. Everything the A6 version
-- checked it still checks, in the same order; what is added is at the end.
-------------------------------------------------------------------------------
drop function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean);

create function public.admin_publish_alert(
  p_template uuid,
  p_tambons text[],
  p_next_update_at timestamptz,
  p_note text default null,
  p_onset_from timestamptz default null,
  p_onset_to timestamptz default null,
  p_return_from timestamptz default null,
  p_return_to timestamptz default null,
  -- the alert this one replaces, if any
  p_supersedes uuid default null,
  p_drill boolean default false,
  -- Evacuate is refused without it (spec 6.2)
  p_confirm_evacuate boolean default false,
  -- who a drill is sent to; empty is the drill nobody is told about
  p_drill_audience text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  codes text[];
  f record;
  old public.alerts;
  v_alert uuid;
  v_drill boolean := coalesce(p_drill, false);
  v_audience text[] := coalesce(p_drill_audience, '{}');
  v_messages jsonb;
  v_reason text;
begin
  perform public.admin_only();

  select coalesce(array_agg(t.code order by t.code), '{}') into codes
    from public.tambons t where t.code = any (coalesce(p_tambons, '{}'));
  if array_length(codes, 1) is null then
    raise exception 'An alert needs at least one tambon' using errcode = 'check_violation';
  end if;
  -- A code that is not a tambon is a mistake to stop on, not to drop quietly: the admin would
  -- believe a place was warned that was not.
  if array_length(codes, 1) <> (select count(distinct c) from unnest(p_tambons) c) then
    raise exception 'One of the chosen areas is not a tambon Jaga covers'
      using errcode = 'check_violation';
  end if;

  if p_next_update_at is null
     or p_next_update_at <= now() + interval '5 minutes'
     or p_next_update_at > now() + interval '7 days' then
    raise exception 'The next update must be between five minutes and seven days from now'
      using errcode = 'check_violation';
  end if;
  if (p_onset_from is null) <> (p_onset_to is null)
     or (p_return_from is null) <> (p_return_to is null) then
    raise exception 'A time window needs both its ends' using errcode = 'check_violation';
  end if;
  if p_onset_from >= p_onset_to or p_return_from >= p_return_to then
    raise exception 'A time window must end after it starts' using errcode = 'check_violation';
  end if;

  -- An audience is a thing only a drill has, and it must be one of the four.
  if cardinality(v_audience) > 0 and not v_drill then
    raise exception 'Only a drill is sent to a chosen audience' using errcode = 'check_violation';
  end if;
  if not (v_audience <@ array['admins', 'rescue', 'units', 'everyone']::text[]) then
    raise exception 'That is not an audience a drill can be sent to'
      using errcode = 'check_violation';
  end if;

  select * into f from public.alert_fill(p_template, codes, p_note);
  if f.level = 'evacuate' and not coalesce(p_confirm_evacuate, false) then
    raise exception 'Evacuate needs its second confirmation' using errcode = 'check_violation';
  end if;

  /*
   * The words. A drill that is sent never carries the template's instructions: somebody reading
   * the second line of a notification, or hearing it read aloud, would be told to leave their
   * house. It carries the drill message instead, which says what it is, that there is no hazard,
   * that nothing need be done, and what the real one would have said.
   */
  if cardinality(v_audience) > 0 then
    v_messages := public.alert_drill_messages(f.level, codes);
    v_reason := public.alert_drill_reason('th');
  else
    v_messages := f.messages;
    v_reason := f.reason;
  end if;

  if p_supersedes is not null then
    select a.* into old from public.alerts a where a.id = p_supersedes for update;
    if not found or old.superseded_by is not null or old.cancelled_at is not null then
      raise exception 'The alert to replace is not in force' using errcode = 'no_data_found';
    end if;
    -- A drill must never take a real alert off the map, and a real one does not "replace" a drill.
    if old.is_drill <> v_drill then
      raise exception 'A drill and a real alert cannot replace each other'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             expected_onset_window, expected_return_window, is_drill, template_id,
                             drill_audience)
    values (f.hazard_type, f.level, v_reason, v_messages, (select auth.uid()), p_next_update_at,
            case when p_onset_from is not null then tstzrange(p_onset_from, p_onset_to) end,
            case when p_return_from is not null then tstzrange(p_return_from, p_return_to) end,
            v_drill, p_template, v_audience)
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;

  if p_supersedes is not null then
    update public.alerts set superseded_by = v_alert where id = p_supersedes;
    perform public.log_access('alert_superseded', 'alerts', p_supersedes::text,
                              jsonb_build_object('by', v_alert));
  end if;
  perform public.log_access('alert_published', 'alerts', v_alert::text, jsonb_build_object(
    'level', f.level, 'tambons', array_length(codes, 1), 'drill', v_drill,
    'audience', to_jsonb(v_audience),
    'supersedes', p_supersedes, 'next_update_at', p_next_update_at));
  return v_alert;
end $$;
revoke execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean, text[]) from public, anon;
grant execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean, text[]) to authenticated;

-------------------------------------------------------------------------------
-- 9. The review step
--
-- When an audience is chosen the preview returns the drill's own words in place of the
-- template's, so the rule the A6 migration set still holds exactly: nothing can be published
-- that was not on the screen first. It also says how many people that audience is, which is a
-- different number from the alert's reach whenever the drill is not for everyone.
--
-- One argument more, so dropped and written again.
-------------------------------------------------------------------------------
drop function public.admin_alert_preview(uuid, text[], text);

create function public.admin_alert_preview(
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

  with people as (
    select p.user_id, p.line_user_id from public.profiles p where p.home_tambon = any (codes)
    union
    select p.user_id, p.line_user_id
      from public.saved_places sp join public.profiles p on p.user_id = sp.user_id
     where sp.notify and sp.tambon = any (codes)
  )
  select jsonb_build_object(
    'homes', (select count(*) from public.profiles p where p.home_tambon = any (codes)),
    'watched', (select count(*) from public.saved_places sp
                 where sp.notify and sp.tambon = any (codes)),
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

-------------------------------------------------------------------------------
-- 10. Who is told
--
-- The two target functions let a sent drill through, and narrow it to its audience. The gate is
-- otherwise the one that was there: an admin asks, at the moment of publishing, and it is
-- logged. A drill with no audience is still refused, as it always was.
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
       where s.tambons && codes;
  end if;
end $$;
revoke execute on function public.push_targets_for_alert(uuid) from public, anon;
grant execute on function public.push_targets_for_alert(uuid) to authenticated;

create or replace function public.line_targets_for_alert(p_alert uuid)
returns table (line_user_id text, locale text)
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
      select p.line_user_id, p.preferred_locale
        from public.profiles p
       where p.user_id in (select u from public.drill_audience_users(a.drill_audience, codes) u)
         and p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
  else
    return query
      select p.line_user_id, p.preferred_locale
        from public.alert_recipients(p_alert) r
        join public.profiles p on p.user_id = r.user_id
       where p.line_user_id is not null
         and not exists (select 1 from public.line_follows f
                          where f.line_user_id = p.line_user_id and not f.following);
  end if;
end $$;
revoke execute on function public.line_targets_for_alert(uuid) from public, anon;
grant execute on function public.line_targets_for_alert(uuid) to authenticated;
