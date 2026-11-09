-- A12 part 2: the dam operator's role and the screen behind it (docs/spec.md section 15).
--
-- Part 1 (13 Oct) gave the admins a screen that sends the dam release notice. Spec 15 always
-- planned a second half: the people at the dam send it themselves, because they are the only ones
-- who know the gates are opening *before* the hourly feed trails in behind them. The owner asked
-- for it on 9 Nov 2026, ahead of a contact at the dam, so that it can be demonstrated to them.
--
-- The whole of this migration is about one thing: an outside organisation gets a button that
-- reaches tens of thousands of phones, and it must be impossible for that button to do anything
-- other than what spec 15 describes.
--
--   * Ticking "we operate a dam" at registration grants nothing. The power exists only once an
--     admin ties the verified unit to a named dam (`dam_operator_units`), and an admin can untie
--     it in one call. A unit cannot tie itself.
--   * The operator can send for its own dam and no other. The dam is not an argument it chooses
--     from a list - it is checked back against the link.
--   * The zone is S7's, exactly as for an admin: not an argument at all.
--   * Not a word of the notice is written by the sender, here or on the admins' screen. The three
--     languages arrive from the reviewed template in messages/*.json and all three are checked.
--   * A field member of the unit can send nothing. Owner and active dispatchers only.
--   * Every send, every withdrawal and every link is in `audit_log`, under the person's own
--     account (safety rule 5).
--   * Admins are told the moment it goes out (spec 15, "Admins. Told at the same moment"): the
--     bell queue below, and a push sent with the server's own token.
--
-- Three choices the owner made on 9 Nov 2026:
--   1. The operator may withdraw a notice it sent itself, while it is in force. Otherwise a wrong
--      figure could only be fixed by telephoning an admin. An admin can still withdraw anything.
--   2. The operator may send "the release has ended". The dam is the only one who knows the gates
--      are shut. It does NOT lower the level and it is not an all-clear: water already released is
--      still travelling downstream, so the end message supersedes the notice *at the same level*
--      and only an admin can stand the level down (safety rule 3: never downgrade, never hide).
--   3. The operator chooses watch, warning or evacuate, starting at warning - the same three an
--      admin has, so there is one rule to teach and one code path to get right.
--
-- And one thing built for the demonstration itself: a drill switch. `is_drill` with the audience
-- 'admins' (20261020220000) lets the people at the dam press the real button in front of the
-- owner, down the real road, with the real template, while nobody outside Jaga's admins sees or
-- hears a thing. The words of a sent drill are replaced by the reviewed drill wording, so a drill
-- can never be read as an instruction. The admins' screen gains the same switch, which it has
-- never had: every other way of publishing an alert in Jaga can be rehearsed, and this is the one
-- most worth rehearsing.

-------------------------------------------------------------------------------
-- 1. Which units operate which dam.
--
-- Set by an admin, never by the unit. One unit may hold more than one reservoir (the irrigation
-- office holds four of the six) and one dam may have more than one unit (a control room and the
-- provincial office), so it is a table and not a column.
-------------------------------------------------------------------------------
create table public.dam_operator_units (
  dam_code text not null references public.dams (code) on delete cascade,
  unit_id uuid not null references public.authority_units (id) on delete cascade,
  linked_by uuid references public.profiles (user_id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (dam_code, unit_id)
);
create index dam_operator_units_unit_idx on public.dam_operator_units (unit_id);

comment on table public.dam_operator_units is
  'Which verified unit may send the release notice for which dam. Written only by an admin.';

alter table public.dam_operator_units enable row level security;

-- The link is not personal data and not secret: the notice it produces names the dam publicly.
-- An operator must be able to see its own link, and an admin all of them. Nobody writes through a
-- policy: the two functions below are the only way in.
create policy "dam_operator_units: admins read" on public.dam_operator_units for select
  to authenticated using (public.is_admin());
create policy "dam_operator_units: the unit reads its own" on public.dam_operator_units
  for select to authenticated
  using (exists (select 1 from public.authority_units u
                  where u.id = unit_id and u.user_id = (select auth.uid()))
         or public.is_my_unit(unit_id,
              array['owner', 'dispatcher', 'field']::public.unit_member_role[]));
revoke insert, update, delete, truncate on public.dam_operator_units from anon, authenticated;
grant select on public.dam_operator_units to authenticated;

-------------------------------------------------------------------------------
-- 2. An admin ties a verified unit to a dam, and unties it.
--
-- Three conditions, each of which has to hold: the unit is verified, it said it operates a dam,
-- and the dam exists. A unit suspended later keeps the row but loses the power, because every
-- check below asks for 'verified' at the moment of sending.
-------------------------------------------------------------------------------
create function public.admin_link_dam_operator(p_unit uuid, p_dam text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.authority_status;
  v_caps public.authority_capability[];
begin
  perform public.admin_only();

  select u.status, u.capabilities into v_status, v_caps
    from public.authority_units u where u.id = p_unit;
  if v_status is null then
    raise exception 'no such unit' using errcode = 'no_data_found';
  end if;
  if v_status <> 'verified' then
    raise exception 'verify the unit before giving it a dam' using errcode = 'check_violation';
  end if;
  if not (v_caps && array['dam']::public.authority_capability[]) then
    raise exception 'that unit did not register as a dam operator' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.dams d where d.code = p_dam) then
    raise exception 'no such dam' using errcode = 'no_data_found';
  end if;

  insert into public.dam_operator_units (dam_code, unit_id, linked_by)
       values (p_dam, p_unit, auth.uid())
  on conflict (dam_code, unit_id) do nothing;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_operator_linked', 'authority_units', p_unit::text,
            jsonb_build_object('dam', p_dam));
end $$;
revoke all on function public.admin_link_dam_operator(uuid, text) from public, anon;
grant execute on function public.admin_link_dam_operator(uuid, text) to authenticated;

create function public.admin_unlink_dam_operator(p_unit uuid, p_dam text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  delete from public.dam_operator_units where unit_id = p_unit and dam_code = p_dam;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_operator_unlinked', 'authority_units', p_unit::text,
            jsonb_build_object('dam', p_dam));
end $$;
revoke all on function public.admin_unlink_dam_operator(uuid, text) from public, anon;
grant execute on function public.admin_unlink_dam_operator(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 3. Who the caller is.
--
-- `dam_operator_unit()` answers with the unit that lets the caller send for this dam, or null.
-- Owner and active dispatchers only: a field member of a dam's unit is somebody out on the
-- structure, and spec 5 already holds them to the narrowest reading of everything.
-------------------------------------------------------------------------------
create function public.dam_operator_unit(p_dam text) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.unit_id
    from public.dam_operator_units l
    join public.authority_units u on u.id = l.unit_id
   where l.dam_code = p_dam
     and u.status = 'verified'
     and u.capabilities && array['dam']::public.authority_capability[]
     and public.unit_access(l.unit_id, (select auth.uid()),
                            array['owner', 'dispatcher']::public.unit_member_role[])
   order by l.linked_at
   limit 1
$$;
revoke all on function public.dam_operator_unit(text) from public, anon;
grant execute on function public.dam_operator_unit(text) to authenticated;

-- The dams this caller may send for: what their screen offers, and nothing wider.
create function public.my_operator_dams()
returns table (dam_code text, unit_id uuid, unit_name text)
language sql stable security definer set search_path = '' as $$
  select l.dam_code, l.unit_id, u.unit_name
    from public.dam_operator_units l
    join public.authority_units u on u.id = l.unit_id
   where u.status = 'verified'
     and u.capabilities && array['dam']::public.authority_capability[]
     and public.unit_access(l.unit_id, (select auth.uid()),
                            array['owner', 'dispatcher']::public.unit_member_role[])
   order by l.dam_code
$$;
revoke all on function public.my_operator_dams() from public, anon;
grant execute on function public.my_operator_dams() to authenticated;

-------------------------------------------------------------------------------
-- 4. Sending it: one body, two doors.
--
-- Part 1's `admin_send_dam_release` held the whole of this. It is lifted out, unchanged in
-- substance, into `publish_dam_release`, so that the admins' door and the operator's door cannot
-- drift apart: a check added for one is a check added for both. The two differences are who is
-- let in, and what is recorded as having sent it.
--
-- `publish_dam_release` is callable by nobody. It trusts its caller completely and makes no
-- permission check of its own - the wrappers below do that, and they are the only things in the
-- database that may call it.
-------------------------------------------------------------------------------
create function public.publish_dam_release(
  p_dam text,
  p_gates_open_at timestamptz,
  p_release_cms numeric,
  p_level public.alert_level,
  -- {"th": "...", "ms": "...", "en": "..."} from the reviewed template; Thai is the source of truth.
  p_messages jsonb,
  p_reason text,
  p_next_update_at timestamptz,
  p_expected_end_at timestamptz,
  -- The war-room row this answers, if it came from one. Marked sent in the same transaction.
  p_notice uuid,
  -- Who pressed it: 'admin' or 'operator', and the operator's unit when it was one of theirs.
  p_sent_by text,
  p_unit uuid,
  -- A rehearsal: not a real alert, and seen only by the audience chosen (20261020220000).
  p_drill boolean,
  p_drill_audience text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_alert uuid;
  v_source text;
  v_zone text[];
  v_onset tstzrange;
  v_arrivals text;
  v_signal jsonb;
  v_messages jsonb;
  v_reason text;
  v_drill boolean := coalesce(p_drill, false);
  v_audience text[] := coalesce(p_drill_audience, '{}');
begin
  -- A dam release is one of three levels. 'normal' and 'return' would be a contradiction, and a
  -- level is never implied by the figures: the person sending it chooses.
  if p_level not in ('watch', 'warning', 'evacuate') then
    raise exception 'a dam release notice is watch, warning or evacuate'
      using errcode = 'check_violation';
  end if;
  if p_release_cms is null or p_release_cms <= 0 then
    raise exception 'the release must be a positive figure in m3/s' using errcode = 'check_violation';
  end if;
  if p_gates_open_at is null
     or p_gates_open_at < now() - interval '7 days'
     or p_gates_open_at > now() + interval '24 hours' then
    raise exception 'the time the gates opened must be within the last week or the next day'
      using errcode = 'check_violation';
  end if;
  if p_expected_end_at is not null and p_expected_end_at <= p_gates_open_at then
    raise exception 'the release cannot end before it starts' using errcode = 'check_violation';
  end if;
  if p_next_update_at is null or p_next_update_at <= now() then
    raise exception 'the next update must be in the future' using errcode = 'check_violation';
  end if;
  -- Three languages, each with something in it. The template writes all three; a missing one
  -- would leave somebody reading a language they did not choose in an emergency.
  if p_messages is null
     or coalesce(length(trim(p_messages ->> 'th')), 0) < 20
     or coalesce(length(trim(p_messages ->> 'ms')), 0) < 20
     or coalesce(length(trim(p_messages ->> 'en')), 0) < 20 then
    raise exception 'the notice needs its Thai, Malay and English text from the template'
      using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'the notice needs its reason line' using errcode = 'check_violation';
  end if;
  -- An audience belongs to a drill and to nothing else. The table's constraint says so too, but a
  -- clear error here beats a constraint violation surfacing on somebody's screen.
  if cardinality(v_audience) > 0 and not v_drill then
    raise exception 'only a drill has an audience' using errcode = 'check_violation';
  end if;

  select d.geometry_source into v_source from public.dams d where d.code = p_dam;
  if v_source is null then
    raise exception 'no such dam' using errcode = 'no_data_found';
  end if;

  -- The zone, exactly as S7 drew it.
  select array_agg(t.tambon_code order by t.km_from_dam nulls last, t.tambon_code)
    into v_zone
    from public.dam_tambons t
   where t.dam_code = p_dam and t.source = v_source;
  if v_zone is null or array_length(v_zone, 1) = 0 then
    raise exception 'that dam has no release zone' using errcode = 'no_data_found';
  end if;

  -- When the water is expected, over the whole zone: from the nearest place with its safety
  -- margin taken off, to the furthest place's latest first rise.
  select tstzrange(p_gates_open_at + make_interval(mins => (min(a.warn_from_h) * 60)::integer),
                   p_gates_open_at + make_interval(mins => (max(a.latest_h) * 60)::integer)),
         min(a.source)
    into v_onset, v_arrivals
    from public.dam_arrivals a
   where a.dam_code = p_dam;

  select to_jsonb(s) into v_signal from public.dam_signal(p_dam) s;

  -- A drill that is sent to anybody never carries the template's words: an instruction read out
  -- of its first line is an instruction (20261020220000).
  if v_drill and cardinality(v_audience) > 0 then
    v_messages := public.alert_drill_messages(p_level, v_zone);
    v_reason := public.alert_drill_reason('th');
  else
    v_messages := p_messages;
    v_reason := p_reason;
  end if;

  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             expected_onset_window, is_drill, drill_audience, signals_snapshot)
    values ('flood', p_level, v_reason, v_messages, auth.uid(), p_next_update_at, v_onset,
            v_drill, v_audience,
            jsonb_build_object(
              'kind', 'dam_release',
              'source', 'dam_release:' || p_dam,
              'dam_code', p_dam,
              'gates_open_at', p_gates_open_at,
              'release_cms', p_release_cms,
              'expected_end_at', p_expected_end_at,
              'arrival_source', v_arrivals,
              'zone_source', v_source,
              -- Who sent it, so the admins' screens and the bell can say the dam sent this.
              'sent_by', p_sent_by,
              'unit', p_unit,
              'figures', coalesce(v_signal, '{}'::jsonb)))
    returning id into v_alert;

  insert into public.alert_tambons (alert_id, tambon)
    select v_alert, code from unnest(v_zone) as code;

  if p_notice is not null then
    update public.dam_notices
       set status = 'sent', reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = coalesce(review_note, '') || case when review_note is null then ''
                                                          else ' · ' end || 'alert ' || v_alert
     where id = p_notice and status in ('open', 'sent');
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_release_sent', 'alerts', v_alert,
            jsonb_build_object('dam', p_dam, 'level', p_level, 'release_cms', p_release_cms,
                               'gates_open_at', p_gates_open_at, 'tambons', array_length(v_zone, 1),
                               'notice', p_notice, 'sent_by', p_sent_by, 'unit', p_unit,
                               'drill', v_drill, 'audience', v_audience));
  return v_alert;
end $$;
revoke all on function public.publish_dam_release(text, timestamptz, numeric, public.alert_level,
  jsonb, text, timestamptz, timestamptz, uuid, text, uuid, boolean, text[])
  from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4a. The admins' door. Part 1's function, with the drill switch it never had.
-------------------------------------------------------------------------------
drop function public.admin_send_dam_release(text, timestamptz, numeric, public.alert_level,
  jsonb, text, timestamptz, timestamptz, uuid);
create function public.admin_send_dam_release(
  p_dam text,
  p_gates_open_at timestamptz,
  p_release_cms numeric,
  p_level public.alert_level,
  p_messages jsonb,
  p_reason text,
  p_next_update_at timestamptz,
  p_expected_end_at timestamptz default null,
  p_notice uuid default null,
  p_drill boolean default false,
  p_drill_audience text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return public.publish_dam_release(p_dam, p_gates_open_at, p_release_cms, p_level, p_messages,
                                    p_reason, p_next_update_at, p_expected_end_at, p_notice,
                                    'admin', null, p_drill, p_drill_audience);
end $$;
revoke all on function public.admin_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, uuid, boolean, text[])
  from public, anon;
grant execute on function public.admin_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, uuid, boolean, text[]) to authenticated;

-------------------------------------------------------------------------------
-- 4b. The operator's door.
--
-- The dam is checked, not chosen: whatever is passed, the caller must hold that dam through a
-- verified link. There is no argument here that widens anything.
-------------------------------------------------------------------------------
create function public.operator_send_dam_release(
  p_dam text,
  p_gates_open_at timestamptz,
  p_release_cms numeric,
  p_level public.alert_level,
  p_messages jsonb,
  p_reason text,
  p_next_update_at timestamptz,
  p_expected_end_at timestamptz default null,
  p_drill boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_unit uuid;
  v_notice uuid;
begin
  v_unit := public.dam_operator_unit(p_dam);
  if v_unit is null then
    raise exception 'Only the dam''s own verified operator can send its release notice'
      using errcode = 'insufficient_privilege';
  end if;

  -- If the hourly feed has already raised a row for this dam, sending closes it, exactly as it
  -- does from the admins' screen. The operator never sees or chooses the row.
  select n.id into v_notice from public.dam_notices n
   where n.dam_code = p_dam and n.status = 'open'
   order by n.raised_at desc limit 1;

  -- A drill from the dam is seen by Jaga's admins and nobody else: that is what makes it safe to
  -- press in a control room. An operator cannot choose a wider audience.
  return public.publish_dam_release(p_dam, p_gates_open_at, p_release_cms, p_level, p_messages,
                                    p_reason, p_next_update_at, p_expected_end_at, v_notice,
                                    'operator', v_unit, coalesce(p_drill, false),
                                    case when coalesce(p_drill, false) then array['admins']
                                         else '{}'::text[] end);
end $$;
revoke all on function public.operator_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.operator_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, boolean) to authenticated;

-------------------------------------------------------------------------------
-- 5. "The release has ended" (the owner's choice, 9 Nov 2026).
--
-- Read the level rule here carefully, because it is the one place where this feature could do
-- harm. Closing the gates is not an all-clear. The water that left while they were open is still
-- coming down the river, and the furthest tambon in Bang Lang's zone is most of a day away. So:
--
--   * the end message supersedes the release notice at THE SAME LEVEL. Nothing is downgraded and
--     nothing disappears from anybody's screen (safety rule 3);
--   * it keeps the zone and the arrival window of the notice it replaces, because the water in
--     them has not changed;
--   * it is marked 'dam_release_end' so a screen can say "the gates are shut, the water is still
--     on its way" rather than anything that reads like relief;
--   * standing the level down afterwards stays an admin's act, through the alert console, as it
--     was before this migration existed.
--
-- A drill is ended by a drill, never by a real alert, and the other way round - the alert console
-- has that rule and it is repeated here.
-------------------------------------------------------------------------------
create function public.operator_end_dam_release(
  p_alert uuid,
  p_closed_at timestamptz,
  p_messages jsonb,
  p_reason text,
  p_next_update_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dam text;
  v_unit uuid;
  v_old public.alerts;
  v_new uuid;
  v_zone text[];
begin
  select * into v_old from public.alerts a where a.id = p_alert;
  if v_old.id is null then
    raise exception 'no such notice' using errcode = 'no_data_found';
  end if;
  if v_old.signals_snapshot ->> 'kind' <> 'dam_release' then
    raise exception 'that alert is not a dam release notice' using errcode = 'check_violation';
  end if;
  if v_old.cancelled_at is not null or v_old.superseded_by is not null then
    raise exception 'that notice is no longer in force' using errcode = 'check_violation';
  end if;

  v_dam := v_old.signals_snapshot ->> 'dam_code';
  v_unit := public.dam_operator_unit(v_dam);
  if v_unit is null then
    raise exception 'Only the dam''s own verified operator can end its release notice'
      using errcode = 'insufficient_privilege';
  end if;

  if p_closed_at is null
     or p_closed_at < (v_old.signals_snapshot ->> 'gates_open_at')::timestamptz
     or p_closed_at > now() + interval '1 hour' then
    raise exception 'the gates cannot have shut before they opened, or in the future'
      using errcode = 'check_violation';
  end if;
  if p_next_update_at is null or p_next_update_at <= now() then
    raise exception 'the next update must be in the future' using errcode = 'check_violation';
  end if;
  if p_messages is null
     or coalesce(length(trim(p_messages ->> 'th')), 0) < 20
     or coalesce(length(trim(p_messages ->> 'ms')), 0) < 20
     or coalesce(length(trim(p_messages ->> 'en')), 0) < 20 then
    raise exception 'the message needs its Thai, Malay and English text from the template'
      using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'the message needs its reason line' using errcode = 'check_violation';
  end if;

  select array_agg(at.tambon) into v_zone
    from public.alert_tambons at where at.alert_id = p_alert;

  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             expected_onset_window, is_drill, drill_audience, signals_snapshot)
    values (v_old.hazard_type,
            -- The same level. This is the line that keeps a closed gate from reading as safety.
            v_old.level,
            case when v_old.is_drill and cardinality(v_old.drill_audience) > 0
                 then public.alert_drill_reason('th') else p_reason end,
            case when v_old.is_drill and cardinality(v_old.drill_audience) > 0
                 then public.alert_drill_messages(v_old.level, v_zone) else p_messages end,
            auth.uid(), p_next_update_at,
            -- The same window: the water in it is the same water.
            v_old.expected_onset_window,
            v_old.is_drill, v_old.drill_audience,
            v_old.signals_snapshot
              || jsonb_build_object('kind', 'dam_release_end',
                                    'gates_closed_at', p_closed_at,
                                    'replaces', p_alert,
                                    'sent_by', 'operator',
                                    'unit', v_unit))
    returning id into v_new;

  insert into public.alert_tambons (alert_id, tambon)
    select v_new, code from unnest(coalesce(v_zone, '{}'::text[])) as code;

  update public.alerts set superseded_by = v_new where id = p_alert;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_release_ended', 'alerts', v_new,
            jsonb_build_object('dam', v_dam, 'replaces', p_alert, 'unit', v_unit,
                               'gates_closed_at', p_closed_at, 'level', v_old.level,
                               'drill', v_old.is_drill));
  return v_new;
end $$;
revoke all on function public.operator_end_dam_release(uuid, timestamptz, jsonb, text, timestamptz)
  from public, anon;
grant execute on function public.operator_end_dam_release(uuid, timestamptz, jsonb, text,
  timestamptz) to authenticated;

-------------------------------------------------------------------------------
-- 6. Withdrawing one it sent itself (the owner's choice, 9 Nov 2026).
--
-- Narrow on purpose: a notice for the caller's own dam, sent from the dam itself, and still in
-- force. An operator cannot withdraw an admin's alert - taking Jaga's own words off every phone
-- is not theirs to do - nor another dam's notice, nor anything that is not a dam release.
-- `admin_cancel_alert` is untouched and still reaches everything.
--
-- Ending one is wider than withdrawing it, and deliberately: the gates shutting is a fact only
-- the dam knows, and saying so changes no level, so the operator may end an admin's notice for
-- their dam as well as their own. Withdrawing removes a notice; ending one adds to it.
-------------------------------------------------------------------------------
create function public.operator_cancel_dam_release(p_alert uuid, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_dam text;
  v_unit uuid;
  v_at timestamptz;
begin
  select a.signals_snapshot ->> 'dam_code' into v_dam
    from public.alerts a
   where a.id = p_alert
     and a.signals_snapshot ->> 'kind' in ('dam_release', 'dam_release_end')
     and a.signals_snapshot ->> 'sent_by' = 'operator';
  if v_dam is null then
    raise exception 'no such dam release notice' using errcode = 'no_data_found';
  end if;

  v_unit := public.dam_operator_unit(v_dam);
  if v_unit is null then
    raise exception 'Only the dam''s own verified operator can withdraw its notice'
      using errcode = 'insufficient_privilege';
  end if;

  update public.alerts set cancelled_at = now()
   where id = p_alert and cancelled_at is null
   returning cancelled_at into v_at;
  if v_at is null then
    raise exception 'that notice is not in force' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'alert_cancelled', 'alerts', p_alert,
            jsonb_build_object('note', p_note, 'dam', v_dam, 'unit', v_unit, 'by', 'operator'));
  return v_at;
end $$;
revoke all on function public.operator_cancel_dam_release(uuid, text) from public, anon;
grant execute on function public.operator_cancel_dam_release(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 7. What the operator's screen reads: its own dam's notices, in force.
--
-- The same shape the admins' list has. It names no person: an operator is shown its own unit's
-- name, never the account that pressed the button, and never an admin's name.
-------------------------------------------------------------------------------
create function public.operator_dam_releases()
returns table (alert_id uuid, dam_code text, level public.alert_level, release_cms numeric,
               gates_open_at timestamptz, gates_closed_at timestamptz, expected_end_at timestamptz,
               kind text, is_drill boolean, mine boolean, tambons integer,
               issued_at timestamptz, next_update_at timestamptz, cancelled_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  select a.id, a.signals_snapshot ->> 'dam_code', a.level,
         (a.signals_snapshot ->> 'release_cms')::numeric,
         (a.signals_snapshot ->> 'gates_open_at')::timestamptz,
         (a.signals_snapshot ->> 'gates_closed_at')::timestamptz,
         (a.signals_snapshot ->> 'expected_end_at')::timestamptz,
         a.signals_snapshot ->> 'kind',
         a.is_drill,
         -- Sent from the dam rather than from Jaga's console: what the operator may end or withdraw.
         a.signals_snapshot ->> 'sent_by' = 'operator',
         (select count(*)::integer from public.alert_tambons at where at.alert_id = a.id),
         a.issued_at, a.next_update_at, a.cancelled_at
    from public.alerts a
   where a.signals_snapshot ->> 'kind' in ('dam_release', 'dam_release_end')
     and a.superseded_by is null
     and a.issued_at > now() - interval '14 days'
     and public.dam_operator_unit(a.signals_snapshot ->> 'dam_code') is not null
   order by a.issued_at desc;
end $$;
revoke all on function public.operator_dam_releases() from public, anon;
grant execute on function public.operator_dam_releases() to authenticated;

-------------------------------------------------------------------------------
-- 8. The admins hear about it.
--
-- Spec 15: "Admins. Told at the same moment." Two roads, as everywhere else in Jaga:
--
--   * the bell, through a new queue in admin_attention(). A notice the dam sent itself stays in
--     the list for six hours, which is how long an admin has any decision to make about it
--     (extend, supersede, cancel). Like every other queue it makes no sound of its own;
--   * one quiet push per notice, handed out by the server's own gate token in the shape
--     push_unit_waiting() established (20261024140000). It names the dam and the level. A drill
--     is pushed too - a drill nobody is told about proves nothing about this road.
-------------------------------------------------------------------------------
create table public.dam_release_admin_push (
  alert_id uuid primary key references public.alerts (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.dam_release_admin_push enable row level security;
create policy "dam_release_admin_push: admins read" on public.dam_release_admin_push
  for select to authenticated using (public.is_admin());
revoke insert, update, delete, truncate on public.dam_release_admin_push from anon, authenticated;
grant select on public.dam_release_admin_push to authenticated;

create function public.push_dam_release_admins(p_token text, p_alert uuid)
returns table (endpoint text, keys jsonb, locale text, dam_name jsonb, level text,
               release_cms numeric, unit_name text, drill boolean, ended boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  -- Once per notice, and only for one the dam sent itself: an admin's own send does not need to
  -- be announced back to the admins.
  insert into public.dam_release_admin_push (alert_id)
    select a.id from public.alerts a
     where a.id = p_alert
       and a.signals_snapshot ->> 'sent_by' = 'operator'
       and a.signals_snapshot ->> 'kind' in ('dam_release', 'dam_release_end')
  on conflict do nothing;
  get diagnostics fresh = row_count;
  if fresh = 0 then
    return;
  end if;

  return query
  select ps.endpoint, ps.keys, ps.locale, d.name, a.level::text,
         (a.signals_snapshot ->> 'release_cms')::numeric,
         u.unit_name, a.is_drill,
         a.signals_snapshot ->> 'kind' = 'dam_release_end'
    from public.alerts a
    left join public.dams d on d.code = a.signals_snapshot ->> 'dam_code'
    left join public.authority_units u
           on u.id = (a.signals_snapshot ->> 'unit')::uuid
    join public.profiles p on p.role in ('admin', 'super_admin')
    join public.push_subscriptions ps on ps.user_id = p.user_id
   where a.id = p_alert;
end $$;
revoke all on function public.push_dam_release_admins(text, uuid) from public;
grant execute on function public.push_dam_release_admins(text, uuid) to anon, authenticated;

-------------------------------------------------------------------------------
-- 8a. The bell's new queue.
--
-- Rebuilt whole rather than patched, because the function returns a set of queues and there is no
-- way to add one to it from outside. Everything above 'operatorRelease' is 20261022203659 word
-- for word; only the last block is new.
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
end $$;

revoke execute on function public.admin_attention() from public, anon;
grant execute on function public.admin_attention() to authenticated;

-------------------------------------------------------------------------------
-- 9. The public answer knows about the end message.
--
-- Same columns, one more kind: a screen reading the status must be able to tell "the gates are
-- open" from "the gates are shut and the water is still coming". The level is the same in both,
-- which is the point.
-------------------------------------------------------------------------------
create or replace function public.public_alert_status()
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
           when 'dam_release_end' then jsonb_build_object(
                'kind', 'dam_release_end',
                'damCode', a.signals_snapshot ->> 'dam_code',
                'gatesOpenAt', a.signals_snapshot ->> 'gates_open_at',
                'gatesClosedAt', a.signals_snapshot ->> 'gates_closed_at',
                'releaseCms', a.signals_snapshot -> 'release_cms',
                'arrivalSource', a.signals_snapshot ->> 'arrival_source')
           when 'auto_alarm' then jsonb_build_object('kind', 'auto_alarm')
           else null end,
         a.is_drill
  from public.alerts a
  where a.superseded_by is null and a.cancelled_at is null
  order by a.issued_at desc
$$;
grant execute on function public.public_alert_status() to anon, authenticated;

-------------------------------------------------------------------------------
-- 10. The operator may read its own dam's signal rows.
--
-- The figures themselves (dams, dam_readings, dam_arrivals, dam_tambons) are already public. The
-- notices the feed raises are not, and they are the one internal thing the dam's own people have
-- a plain reason to see: it is their structure the grading is about.
-------------------------------------------------------------------------------
create policy "dam_notices: the dam's operator reads its own" on public.dam_notices
  for select to authenticated
  using (public.dam_operator_unit(dam_code) is not null);

-------------------------------------------------------------------------------
-- 11. A dam operator is not a rescue team, and must not be read as one.
--
-- This block is not part of what spec 15 asks for. It is here because building the role without
-- it would have opened something nobody asked to open, and it is better said out loud.
--
-- Every verified unit selects a coverage area when it registers, and `covers_tambon()` - with no
-- capability named - is what gates the sensitive reads across the whole app: the exact location
-- and phone of a request for help, residents' reports and their media, the safe-place rounds.
-- That is right for a rescue team, which is who it was written for. It is wrong for a dam.
--
-- A control room at a reservoir has a plain reason to send a release notice and no reason at all
-- to read a resident's address and telephone number. Safety rule 5 is a floor, not a ceiling: the
-- fewest people who can do the work. So a unit whose ONLY capability is 'dam' is passed over by
-- `covers_tambon()` and by the dispatch, and the dam link above gives it the one power it needs.
--
-- A unit that is both - a provincial irrigation office that also runs boats - keeps everything a
-- rescue team has. The test is "dam and nothing else", not "dam at all".
-------------------------------------------------------------------------------
create function public.unit_is_dam_only(p_caps public.authority_capability[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_caps, '{}'::public.authority_capability[])
           <@ array['dam']::public.authority_capability[]
$$;
grant execute on function public.unit_is_dam_only(public.authority_capability[])
  to anon, authenticated;

comment on function public.unit_is_dam_only(public.authority_capability[]) is
  'True when a unit holds no capability except operating a dam, so coverage grants it no reads.';

create or replace function public.covers_tambon(
  p_tambon text, p_capabilities public.authority_capability[] default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where u.user_id = (select auth.uid())
      and u.status = 'verified'
      and c.tambon = p_tambon
      and (p_capabilities is null or u.capabilities && p_capabilities)
      -- A12 part 2: a dam operator's coverage is not a rescue team's coverage.
      and not public.unit_is_dam_only(u.capabilities)
  )
$$;

-- The same for the dispatch: a dam's unit is never offered a case and can never accept one.
create or replace function public.my_unit_for_sos(p_sos_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from public.authority_units u
    join public.authority_coverage ac on ac.unit_id = u.id
    join public.sos_requests s on s.id = p_sos_id and s.tambon = ac.tambon
   where u.user_id = (select auth.uid())
     and u.status = 'verified'
     and not public.unit_is_dam_only(u.capabilities)
   order by (u.id = (select d.dispatch_unit from public.sos_offer_now(p_sos_id) d)) desc nulls last,
            u.on_duty desc, u.created_at
   limit 1
$$;
revoke execute on function public.my_unit_for_sos(uuid) from public, anon, authenticated;

-- And another unit's point-of-contact phone. Shared coverage is the rule (safety rule 5), and a
-- dam-only unit shares coverage with every rescue team below it without needing any of their
-- numbers: it reaches them the way the public does. Admins and the units themselves are
-- unaffected, and every reveal is still logged.
create or replace function public.reveal_poc_phone(p_unit_id uuid)
returns table (poc_name text, poc_phone text)
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or exists (
      select 1
      from public.authority_coverage theirs
      join public.authority_coverage mine on mine.tambon = theirs.tambon
      join public.authority_units u on u.id = mine.unit_id
      where theirs.unit_id = p_unit_id
        and u.user_id = (select auth.uid())
        and u.status = 'verified'
        and not public.unit_is_dam_only(u.capabilities))) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone
    from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $$;

-- The one gate that closes the rest in a single line. `is_verified_authority()` is what stands in
-- front of the case board, residents' reports, the household figures, the village layer, the
-- safe-place rounds, the field rescues and the supply board - about twenty places - and all of
-- them mean "a team in the field", not "an organisation Jaga has checked". A dam-only unit is now
-- no longer one, so it is turned away from every one of them without any of them being touched.
--
-- Known limit, said plainly rather than left for somebody to find: an account that holds BOTH a
-- dam-only unit AND a rescue unit is a verified authority through the second, and the case board
-- takes the union of that account's units' coverage, so the dam unit's tambons widen their board.
-- The residual is the union of two areas the same person already answers for, and closing it
-- properly means recreating `authority_board` (superseded four times already); it is written here
-- rather than copied. Nothing about it gives a dam-only *account* any read it did not have.
create or replace function public.is_verified_authority() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.authority_units
                 where user_id = (select auth.uid()) and status = 'verified'
                   and not public.unit_is_dam_only(capabilities))
$$;
