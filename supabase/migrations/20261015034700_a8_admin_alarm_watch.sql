-- A8: admins see what the automatic alarm did, and choose how much of Jaga's alerting reaches
-- their own bell (owner, 15 Oct 2026).
--
--   * `admin_auto_alarms(days)`: every automatic alarm of the period - the draft it raised, and
--     whether an admin sent it, dismissed it, it published itself, or the river fell back first.
--     Admins only.
--   * `admin_notice_prefs`: one tick per admin. Off (the default): their bell rings like anyone's,
--     for their own home and watched places only. On: every alert Jaga sends, anywhere, reaches
--     their bell as a real alert, with its sound.
--   * `admin_notice_feed()`: what the admin's bell adds to the public feed - the automatic alarms
--     of the last fourteen days, and, with the tick on, every real alert of that window.

create table public.admin_notice_prefs (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  all_alerts boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.admin_notice_prefs enable row level security;
revoke all on public.admin_notice_prefs from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The automatic alarms of the last `p_days` days, newest first.
-------------------------------------------------------------------------------
create function public.admin_auto_alarms(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."createdAt" desc)
      from (
        select e.id, e.status, e.level, z.name as zone, s.code as gauge,
               round(e.value::numeric, 2) as value, round(e.threshold::numeric, 2) as threshold,
               e.observed_at as "observedAt", e.created_at as "createdAt", e.deadline,
               e.decided_at as "decidedAt", p.display_name as "decidedBy", e.note,
               e.alert_id as "alertId", a.is_drill as drill
          from public.auto_alarm_events e
          join public.warning_zones z on z.id = e.zone_id
          left join public.stations s on s.id = e.station_id
          left join public.profiles p on p.user_id = e.decided_by
          left join public.alerts a on a.id = e.alert_id
         where e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
         order by e.created_at desc
         limit 200
      ) x), '[]'::jsonb);
end $$;
revoke execute on function public.admin_auto_alarms(integer) from public, anon;
grant execute on function public.admin_auto_alarms(integer) to authenticated;

-------------------------------------------------------------------------------
-- The admin's own tick.
-------------------------------------------------------------------------------
create function public.admin_set_all_alerts(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  insert into public.admin_notice_prefs (user_id, all_alerts, updated_at)
    values (auth.uid(), coalesce(p_on, false), now())
  on conflict (user_id) do update set all_alerts = excluded.all_alerts, updated_at = now();
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'admin_all_alerts', 'admin_notice_prefs', auth.uid()::text,
            jsonb_build_object('on', coalesce(p_on, false)));
end $$;
revoke execute on function public.admin_set_all_alerts(boolean) from public, anon;
grant execute on function public.admin_set_all_alerts(boolean) to authenticated;

-------------------------------------------------------------------------------
-- What the admin's bell adds. Same row shape as public_notices for the alerts.
-------------------------------------------------------------------------------
create function public.admin_notice_feed() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean;
begin
  perform public.admin_only();
  select coalesce((select p.all_alerts from public.admin_notice_prefs p where p.user_id = auth.uid()), false)
    into v_all;
  return jsonb_build_object(
    'allAlerts', v_all,
    'autoAlarms', public.admin_auto_alarms(14),
    'alerts', case when not v_all then '[]'::jsonb else coalesce((
      select jsonb_agg(row_to_json(n) order by n.issued_at desc)
        from (
          select 'alert' as kind, a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at,
                 a.next_update_at,
                 coalesce(a.cancelled_at,
                          (select s.issued_at from public.alerts s where s.id = a.superseded_by)) as ended_at,
                 a.signals_snapshot ->> 'source' as source,
                 coalesce((select array_agg(at.tambon order by at.tambon)
                             from public.alert_tambons at where at.alert_id = a.id), '{}') as tambons
            from public.alerts a
           where not a.is_drill
             and ((a.superseded_by is null and a.cancelled_at is null)
                  or greatest(a.issued_at,
                              coalesce(a.cancelled_at,
                                       (select s.issued_at from public.alerts s where s.id = a.superseded_by),
                                       a.issued_at)) >= now() - interval '14 days')
           order by a.issued_at desc
           limit 60
        ) n), '[]'::jsonb) end);
end $$;
revoke execute on function public.admin_notice_feed() from public, anon;
grant execute on function public.admin_notice_feed() to authenticated;
