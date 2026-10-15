-- An alert the automated alarm published by itself (safety rule 2's one exception) must not be
-- shown as issued by an admin. The public status answer now says so, with one word and nothing
-- else from the admins' snapshot (no gauge, no event id). Same output columns as before, so the
-- function is replaced in place; drills stay hidden by the read policy on alerts.
create or replace function public.public_alert_status()
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
         case a.signals_snapshot ->> 'kind'
           when 'dam_release' then jsonb_build_object(
                'kind', 'dam_release',
                'damCode', a.signals_snapshot ->> 'dam_code',
                'gatesOpenAt', a.signals_snapshot ->> 'gates_open_at',
                'releaseCms', a.signals_snapshot -> 'release_cms',
                'expectedEndAt', a.signals_snapshot ->> 'expected_end_at',
                'arrivalSource', a.signals_snapshot ->> 'arrival_source')
           when 'auto_alarm' then jsonb_build_object('kind', 'auto_alarm')
           else null end
  from public.alerts a
  where a.superseded_by is null and a.cancelled_at is null
  order by a.issued_at desc
$$;
grant execute on function public.public_alert_status() to anon, authenticated;
