-- Announcements (the "general alert" screen): two additions the owner asked for on 25 Oct 2026.
--
-- 1. An announcement may carry one call to action. For now the only one is 'share_app': the bell
--    shows a "Share Jaga" button under the message, so a reader can pass the app on at once. It is
--    still never an alert and never a level (safety rules 2 and 10); the button only opens the
--    phone's own share sheet for the Jaga home page, exactly as the home screen's Share card does.
--
-- 2. A recipient the composer can pick: every tambon in the service area that still has no team.
--    "No team" means no verified authority unit covers it (the owner's choice, 25 Oct 2026: any
--    verified unit counts, whatever its capability). Worked out in the database, admin only, so the
--    browser is never handed a map of where Jaga's users live - the same rule as tambons_with_people().

alter table public.announcements
  add column cta text check (cta is null or cta in ('share_app'));

-------------------------------------------------------------------------------
-- The feed gains the cta, in a new trailing column. An alert never carries one.
-------------------------------------------------------------------------------
drop function public.public_notices(text[]);
create function public.public_notices(p_tambons text[] default '{}')
returns table (
  kind text, id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz, ended_at timestamptz,
  source text, tambons text[], drill boolean, cta text
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
         a.is_drill, null::text
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
         coalesce(n.tambons, '{}'), false, n.cta
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
-- Posting an announcement now takes an optional cta. Same shape and logging as before; the two
-- positional calls the tests make (two and three arguments) still resolve, the rest defaulting.
-------------------------------------------------------------------------------
drop function public.admin_announce(jsonb, text[], timestamptz);
create function public.admin_announce(
  p_messages jsonb,
  p_tambons text[] default null,
  p_ends_at timestamptz default null,
  p_cta text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.admin_only();
  if p_messages is null or btrim(coalesce(p_messages ->> 'th', '')) = '' then
    raise exception 'An announcement needs Thai text' using errcode = 'check_violation';
  end if;
  if p_cta is not null and p_cta not in ('share_app') then
    raise exception 'Unknown announcement cta' using errcode = 'check_violation';
  end if;
  insert into public.announcements (messages, tambons, ends_at, cta, created_by)
  values (p_messages, p_tambons, p_ends_at, p_cta, (select auth.uid()))
  returning id into v_id;
  perform public.log_access('announcement_posted', 'announcements', v_id::text, jsonb_build_object(
    'tambons', coalesce(array_length(p_tambons, 1), 0), 'ends_at', p_ends_at, 'cta', p_cta));
  return v_id;
end $$;
revoke execute on function public.admin_announce(jsonb, text[], timestamptz, text) from public, anon;
grant execute on function public.admin_announce(jsonb, text[], timestamptz, text) to authenticated;

-------------------------------------------------------------------------------
-- The tambons in the service area that still have no team covering them. A verified unit is a
-- team, whatever its capability (owner, 25 Oct 2026). Admin only, like tambons_with_people().
-------------------------------------------------------------------------------
create function public.admin_tambons_without_team() returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
    select t.code
      from public.tambons t
     where left(t.code, 2) in (select p.code from public.provinces p where p.status = 'active')
       and not exists (
             select 1
               from public.authority_coverage ac
               join public.authority_units au on au.id = ac.unit_id
              where ac.tambon = t.code and au.status = 'verified')
     order by t.code;
end $$;
revoke execute on function public.admin_tambons_without_team() from public, anon;
grant execute on function public.admin_tambons_without_team() to authenticated;
