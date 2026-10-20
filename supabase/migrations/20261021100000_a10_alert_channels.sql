-- A10: the admin chooses which roads an alert travels (owner, 21 Oct: "add option for admin to
-- select send to Line or not. So for drill i don't need to lose Line quota").
--
-- LINE is the metered road - a monthly quota Jaga tracks and warns about at 70% and 90% - and a
-- drill sent to everyone would spend it on a message nobody needed. Push costs nothing. So the
-- two are now ticked separately, and the choice is kept on the alert rather than only acted on
-- by the server: the target functions refuse the road that was not chosen, so a later caller,
-- a retry or a second console cannot quietly spend the quota the admin declined.
--
-- Default is both, for a real alert and a drill alike: a drill that leaves LINE out is not a
-- test of LINE, and that is the admin's call to make each time rather than a default.
--
-- An alert with no road at all is allowed and is not a mistake: it stands in the app, on the
-- map and in the bell either way, exactly as it does today when no push key is configured.

alter table public.alerts
  add column channels text[] not null default array['push', 'line']::text[];

alter table public.alerts
  add constraint alerts_channels_values
    check (channels <@ array['push', 'line']::text[]);

comment on column public.alerts.channels is
  'Which roads this alert may be sent down. LINE is metered, so an admin may leave it out.';

-------------------------------------------------------------------------------
-- The target functions hand back nothing for a road that was not chosen.
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
  if not ('push' = any (a.channels)) then return; end if;

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

create or replace function public.line_targets_for_alert(p_alert uuid)
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
  -- The quota the admin chose not to spend stays unspent, whoever asks afterwards.
  if not ('line' = any (a.channels)) then return; end if;

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
-- Publishing, with the roads. One argument more, so dropped and written again.
-------------------------------------------------------------------------------
drop function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean, text[]);

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
  p_drill_audience text[] default '{}',
  -- which roads it may travel; LINE is metered, so an admin may leave it out
  p_channels text[] default array['push', 'line']::text[]
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
