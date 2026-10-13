-- The bell shows every alert still in force for a person's places, whenever it was issued
-- (the owner, 13 Oct): someone who opens Jaga for the first time today must see - and hear - an
-- alert that has stood for three weeks. Before this, an alert issued more than fourteen days ago
-- fell out of the feed even while it was in force. Alerts that have ended keep the fourteen-day
-- window. Same signature; only the filter changes.

create or replace function public.public_notices(p_tambons text[] default '{}')
returns table (
  kind text,
  id uuid,
  hazard_type public.hazard_type,
  level public.alert_level,
  reason text,
  messages jsonb,
  issued_at timestamptz,
  next_update_at timestamptz,
  ended_at timestamptz,
  source text,
  tambons text[]
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
                   from public.alert_tambons at where at.alert_id = a.id), '{}')
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
         coalesce(n.tambons, '{}')
    from public.announcements n, asked, window_start
   where n.cancelled_at is null
     and n.starts_at <= now()
     and n.starts_at >= window_start.from_time
     and (n.tambons is null or n.tambons && asked.codes)
   order by 7 desc
   limit 100
$$;
