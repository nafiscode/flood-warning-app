-- LINE is no longer ticked by default (owner, 22 Oct 2026: "I don't want to pay now"). The free
-- LINE plan is 500 messages a month and one alert to 500 people spends it all. Push stays the
-- default road; an admin can still tick LINE for one alert on the review step, and the target
-- functions keep refusing it when it was not ticked (20261021100000_a10_alert_channels).
--
-- The column default covers an alert no admin ticked roads for (the automated alarm of safety
-- rule 2), and the publish function's default covers a caller that leaves the roads out.
-- Neither leaves anyone uninformed: the alert still stands in the app, on the map, in the bell
-- and goes out as push.

alter table public.alerts alter column channels set default array['push']::text[];

create or replace function public.admin_publish_alert(
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
  p_drill_audience text[] default '{}',
  -- which roads it may travel; LINE is metered, so an admin may leave it out
  p_channels text[] default array['push']::text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  codes text[];
  f record;
  old public.alerts;
  v_alert uuid;
  v_drill boolean := coalesce(p_drill, false);
  v_audience text[] := coalesce(p_drill_audience, '{}');
  v_channels text[] := coalesce(p_channels, '{}');
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
  if not (v_channels <@ array['push', 'line']::text[]) then
    raise exception 'That is not a road an alert can travel' using errcode = 'check_violation';
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
                             drill_audience, channels)
    values (f.hazard_type, f.level, v_reason, v_messages, (select auth.uid()), p_next_update_at,
            case when p_onset_from is not null then tstzrange(p_onset_from, p_onset_to) end,
            case when p_return_from is not null then tstzrange(p_return_from, p_return_to) end,
            v_drill, p_template, v_audience, v_channels)
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;

  if p_supersedes is not null then
    update public.alerts set superseded_by = v_alert where id = p_supersedes;
    perform public.log_access('alert_superseded', 'alerts', p_supersedes::text,
                              jsonb_build_object('by', v_alert));
  end if;
  perform public.log_access('alert_published', 'alerts', v_alert::text, jsonb_build_object(
    'level', f.level, 'tambons', array_length(codes, 1), 'drill', v_drill,
    'audience', to_jsonb(v_audience), 'channels', to_jsonb(v_channels),
    'supersedes', p_supersedes, 'next_update_at', p_next_update_at));
  return v_alert;
end $$;
revoke execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean, text[], text[]) from public, anon;
grant execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean, text[], text[]) to authenticated;
