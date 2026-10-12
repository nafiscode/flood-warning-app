-- A12 part 1, the rest of it: an admin sends the dam release notice (docs/spec.md section 15).
--
-- Everything code could do was already done: the hourly feed grades the dam, and a confirmed
-- release puts a row on the war room. This is the step a person takes afterwards, and it stays a
-- person's act (safety rule 2): nothing here runs on a timer and nothing here decides to send.
--
-- What the function does and does not do:
--   * it builds no words. The three languages arrive from the reviewed template in messages/*.json
--     and are checked for being there; the function refuses a notice that is missing one.
--   * it cannot be aimed. The zone is the dam's own tambons from S7 - the river below the dam and
--     the lower reaches of the streams joining it - and no argument widens or narrows it.
--   * the arrival window comes from `dam_arrivals`, measured at the gauges, and is stored as the
--     alert's expected-onset range: earliest with the safety margin already taken off, latest from
--     the furthest tambon (safety rule 8: a range, never a time).
--   * the issuer is the signed-in admin, and every send is in `audit_log`.
--
-- Until an operator at the dam has a screen of their own (A12 part 2), admins send it. The
-- function is therefore admin-only; the operator role will be let in beside them, not instead.

-------------------------------------------------------------------------------
-- 1. The public status answer carries what a dam release needs, and nothing else from the
--    snapshot. Output columns change, so the function is dropped and written again.
-------------------------------------------------------------------------------
drop function if exists public.public_alert_status();
create function public.public_alert_status()
returns table (
  alert_id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz,
  onset_from timestamptz, onset_to timestamptz, return_from timestamptz, return_to timestamptz,
  source text, tambons text[], details jsonb
)
language sql stable set search_path = '' as $$
  select a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at, a.next_update_at,
         lower(a.expected_onset_window), upper(a.expected_onset_window),
         lower(a.expected_return_window), upper(a.expected_return_window),
         a.signals_snapshot ->> 'source',
         coalesce((select array_agg(at.tambon order by at.tambon)
                   from public.alert_tambons at where at.alert_id = a.id), '{}'),
         -- A named list, never the whole snapshot: what a screen needs to say when the water is
         -- expected at *this* place, and nothing that was only meant for the admins.
         case when a.signals_snapshot ->> 'kind' = 'dam_release' then jsonb_build_object(
                'kind', 'dam_release',
                'damCode', a.signals_snapshot ->> 'dam_code',
                'gatesOpenAt', a.signals_snapshot ->> 'gates_open_at',
                'releaseCms', a.signals_snapshot -> 'release_cms',
                'expectedEndAt', a.signals_snapshot ->> 'expected_end_at',
                'arrivalSource', a.signals_snapshot ->> 'arrival_source')
              else null end
  from public.alerts a
  where a.superseded_by is null and a.cancelled_at is null
  order by a.issued_at desc
$$;
grant execute on function public.public_alert_status() to anon, authenticated;

-------------------------------------------------------------------------------
-- 2. Sending it.
-------------------------------------------------------------------------------
create function public.admin_send_dam_release(
  p_dam text,
  p_gates_open_at timestamptz,
  p_release_cms numeric,
  p_level public.alert_level,
  -- {"th": "...", "ms": "...", "en": "..."} from the reviewed template; Thai is the source of truth.
  p_messages jsonb,
  p_reason text,
  p_next_update_at timestamptz,
  p_expected_end_at timestamptz default null,
  -- The war-room row this answers, if it came from one. Marked sent in the same transaction.
  p_notice uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_alert uuid;
  v_source text;
  v_zone text[];
  v_onset tstzrange;
  v_arrivals text;
  v_signal jsonb;
begin
  perform public.admin_only();

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

  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             expected_onset_window, signals_snapshot)
    values ('flood', p_level, p_reason, p_messages, auth.uid(), p_next_update_at, v_onset,
            jsonb_build_object(
              'kind', 'dam_release',
              'source', 'dam_release:' || p_dam,
              'dam_code', p_dam,
              'gates_open_at', p_gates_open_at,
              'release_cms', p_release_cms,
              'expected_end_at', p_expected_end_at,
              'arrival_source', v_arrivals,
              'zone_source', v_source,
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
                               'notice', p_notice));
  return v_alert;
end $$;
revoke execute on function public.admin_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.admin_send_dam_release(text, timestamptz, numeric,
  public.alert_level, jsonb, text, timestamptz, timestamptz, uuid) to authenticated;

-------------------------------------------------------------------------------
-- 3. Withdrawing one. A notice sent in error has to be stoppable by the same person, in one tap,
--    and the withdrawal is logged like the sending.
-------------------------------------------------------------------------------
create function public.admin_cancel_alert(p_alert uuid, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  perform public.admin_only();
  update public.alerts set cancelled_at = now()
   where id = p_alert and cancelled_at is null
   returning cancelled_at into v_at;
  if v_at is null then
    raise exception 'that alert is not in force' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'alert_cancelled', 'alerts', p_alert,
            jsonb_build_object('note', p_note));
  return v_at;
end $$;
revoke execute on function public.admin_cancel_alert(uuid, text) from public, anon;
grant execute on function public.admin_cancel_alert(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 4. What an admin needs to see on the sending screen: the dam releases in force, so nobody
--    sends a second notice for the same gates.
-------------------------------------------------------------------------------
create function public.admin_dam_alerts(p_dam text default null)
returns table (
  alert_id uuid, dam_code text, level public.alert_level, issued_at timestamptz,
  next_update_at timestamptz, issued_by text, gates_open_at timestamptz, release_cms numeric,
  onset_from timestamptz, onset_to timestamptz, tambons integer, cancelled_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
  select a.id, a.signals_snapshot ->> 'dam_code', a.level, a.issued_at, a.next_update_at,
         p.display_name,
         (a.signals_snapshot ->> 'gates_open_at')::timestamptz,
         (a.signals_snapshot ->> 'release_cms')::numeric,
         lower(a.expected_onset_window), upper(a.expected_onset_window),
         (select count(*)::integer from public.alert_tambons t where t.alert_id = a.id),
         a.cancelled_at
    from public.alerts a
    left join public.profiles p on p.user_id = a.issued_by
   where a.signals_snapshot ->> 'kind' = 'dam_release'
     and (p_dam is null or a.signals_snapshot ->> 'dam_code' = p_dam)
     and a.issued_at > now() - interval '30 days'
   order by a.issued_at desc;
end $$;
revoke execute on function public.admin_dam_alerts(text) from public, anon;
grant execute on function public.admin_dam_alerts(text) to authenticated;
