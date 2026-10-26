-- Two names that were not reaching the screen (found 27 Oct 2026 while adding the reservoirs).
--
-- 1. `admin_auto_alarms` returned the warning zone's `name`, which is jsonb with one string per
--    language, as the field `zone`; lib/notices.ts reads `zone` as a string, so an object became
--    the empty string and the alarm log on /admin/alerts showed a blank line where the river's
--    name belongs. It has shown blank for every row since A8, which nobody had seen because no
--    gauge was ticked until 20 October. The row now carries both: `names` for the screen to pick
--    the reader's language from, and `zone` as the Thai name, which is what the type already
--    expects and what the log is read in.
--
-- 2. `auto_alarm_push_due` is the same story the other way round. Its push body fills {zone} from
--    `data.zone[locale]`, so that field has to stay the jsonb object - and the version of it
--    added for the reservoirs coerced it to Thai text, which would have left {zone} empty in a
--    Malay or English notification. A reservoir now hands over its own `name` object.

create or replace function public.admin_auto_alarms(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."createdAt" desc)
      from (
        select e.id, e.status, e.level,
               case when e.level = 'return' then 'clear'
                    when e.dam_code is not null then 'reservoir' else 'gauge' end as kind,
               coalesce(z.name, dm.name, to_jsonb(dm.code)) as names,
               coalesce(z.name ->> 'th', dm.name ->> 'th', dm.code) as zone,
               s.code as gauge, e.dam_code as dam, e.supersedes,
               round(e.value::numeric, 2) as value, round(e.threshold::numeric, 2) as threshold,
               case when e.dam_code is not null and dm.storage_max_mcm > 0
                    then round((e.value / dm.storage_max_mcm * 100)::numeric, 1) end as percent,
               e.observed_at as "observedAt", e.created_at as "createdAt", e.deadline,
               e.decided_at as "decidedAt", p.display_name as "decidedBy", e.note,
               e.alert_id as "alertId", a.is_drill as drill
          from public.auto_alarm_events e
          left join public.warning_zones z on z.id = e.zone_id
          left join public.dams dm on dm.code = e.dam_code
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

create or replace function public.auto_alarm_push_due(p_token text)
returns table (kind text, endpoint text, keys jsonb, locale text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare e record; fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for e in select x.*,
                  -- jsonb, one string per language: the push body reads data.zone[locale].
                  coalesce(z.name, d.name, to_jsonb(d.code)) as subject_name,
                  s.code as gauge,
                  case when x.dam_code is not null and d.storage_max_mcm > 0
                       then round((x.value / d.storage_max_mcm * 100)::numeric, 1) end as percent
             from public.auto_alarm_events x
             left join public.warning_zones z on z.id = x.zone_id
             left join public.dams d on d.code = x.dam_code
             left join public.stations s on s.id = x.station_id
            where x.created_at > now() - interval '1 day' loop
    if e.status = 'pending' then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'admins')
        on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'auto_alarm'::text, ps.endpoint, ps.keys, ps.locale,
          jsonb_build_object('event', e.id, 'level', e.level, 'zone', e.subject_name,
                             'gauge', e.gauge, 'dam', e.dam_code, 'percent', e.percent,
                             'clear', e.level = 'return',
                             'value', round(e.value::numeric, 2), 'deadline', e.deadline)
          from public.profiles p join public.push_subscriptions ps on ps.user_id = p.user_id
         where p.role in ('admin', 'super_admin');
      end if;
    elsif e.status = 'auto_published' and e.alert_id is not null
          and exists (select 1 from public.alerts al where al.id = e.alert_id
                        and (not al.is_drill or 'everyone' = any (al.drill_audience))
                        and al.cancelled_at is null and al.superseded_by is null) then
      insert into public.auto_alarm_pushed (event_id, kind) values (e.id, 'public')
        on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query select 'alert'::text, ps.endpoint, ps.keys, ps.locale,
          (select jsonb_build_object('id', al.id, 'level', al.level, 'messages', al.messages,
                                     'drill', al.is_drill)
             from public.alerts al where al.id = e.alert_id)
          from public.push_subscriptions ps
         where ps.tambons && (select array_agg(at.tambon) from public.alert_tambons at
                               where at.alert_id = e.alert_id);
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.auto_alarm_push_due(text) from public;
grant execute on function public.auto_alarm_push_due(text) to anon, authenticated;
