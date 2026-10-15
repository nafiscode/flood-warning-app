-- A7: an admin's decision reaches the person waiting for it in LINE as well as in the bell
-- (owner, 15 Oct 2026). Three things wait on an admin:
--
--   a team's registration     verified or suspended          -> the account that registered it
--   a team's field rescue      approved or refused            -> the account behind that team
--   a flood report             checked (approved) or hidden   -> the account that reported it
--
-- Each decision is already written to audit_log by the function that makes it
-- (verify_authority_unit, suspend_authority_unit, admin_review_field_rescue,
-- admin_moderate_report), so the log is the one place to read them from. `line_decisions_due`
-- hands each decision out once, the same way `line_due` hands out a request's news, and only
-- Jaga's server may ask (push gate token). A message names the team or the tambon, never a
-- person or a place.
--
-- The bell already had the first two; `my_report_decisions` gives it the third.

create table public.line_decision_log (
  audit_id bigint primary key references public.audit_log (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.line_decision_log enable row level security;
revoke all on public.line_decision_log from public, anon, authenticated;

-- What each decision is and whom it is for, read from the audit row the deciding function wrote.
create function public.admin_decisions_since(p_since timestamptz)
returns table (
  audit_id bigint, kind text, user_id uuid, ref text, data jsonb, decided_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id,
         case a.action when 'verify_authority' then 'unit_verified' else 'unit_suspended' end,
         u.user_id, u.id::text, jsonb_build_object('unit', u.unit_name), a.ts
    from public.audit_log a
    join public.authority_units u on u.id::text = a.entity_id
   where a.entity = 'authority_units'
     and a.action in ('verify_authority', 'suspend_authority')
     and a.ts > p_since
  union all
  select a.id,
         case when coalesce((a.details ->> 'approved')::boolean, false)
              then 'field_approved' else 'field_rejected' end,
         u.user_id, f.id::text,
         jsonb_build_object('unit', u.unit_name, 'tambon_th', t.name_th, 'tambon_en', t.name_en),
         a.ts
    from public.audit_log a
    join public.field_rescues f on f.id::text = a.entity_id
    join public.authority_units u on u.id = f.unit_id
    left join public.tambons t on t.code = f.tambon
   where a.entity = 'field_rescues'
     and a.action = 'field_rescue_reviewed'
     and a.ts > p_since
  union all
  select a.id,
         case a.details ->> 'to' when 'approved' then 'report_approved' else 'report_hidden' end,
         r.reporter_id, r.id::text,
         jsonb_build_object('tambon_th', t.name_th, 'tambon_en', t.name_en),
         a.ts
    from public.audit_log a
    join public.reports r on r.id::text = a.entity_id
    left join public.tambons t on t.code = r.tambon
   where a.entity = 'reports'
     and a.action = 'report_moderated'
     and a.details ->> 'to' in ('approved', 'hidden')
     and r.reporter_id is not null
     and a.ts > p_since
$$;
revoke execute on function public.admin_decisions_since(timestamptz) from public, anon, authenticated;

-- Decisions made before today were already seen in the app: none of them is sent now.
insert into public.line_decision_log (audit_id)
select d.audit_id from public.admin_decisions_since('-infinity') d
on conflict do nothing;

-------------------------------------------------------------------------------
-- What is owed to LINE: each decision of the last three days not yet handed out. Every one is
-- marked as handed out, also when the person has no LINE linked, so it is never looked at again.
-------------------------------------------------------------------------------
create function public.line_decisions_due(p_token text)
returns table (kind text, line_user_id text, locale text, ref text, data jsonb)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  d record;
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  for d in
    select * from public.admin_decisions_since(now() - interval '3 days') x
     where not exists (select 1 from public.line_decision_log l where l.audit_id = x.audit_id)
     order by x.decided_at
  loop
    insert into public.line_decision_log (audit_id) values (d.audit_id) on conflict do nothing;
    get diagnostics fresh = row_count;
    if fresh > 0 then
      return query
        select d.kind, p.line_user_id, p.preferred_locale, d.ref, d.data
          from public.profiles p
         where p.user_id = d.user_id
           and p.line_user_id is not null
           and not exists (select 1 from public.line_follows f
                            where f.line_user_id = p.line_user_id and not f.following);
    end if;
  end loop;
end $$;
revoke execute on function public.line_decisions_due(text) from public;
grant execute on function public.line_decisions_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The minute's knock on Jaga's server also comes when a decision is waiting to be told, not only
-- while a request for help is open (the rest is unchanged from 20261013210000).
-------------------------------------------------------------------------------
create or replace function public.push_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.push_gate;
begin
  select * into g from public.push_gate limit 1;
  if g.site_url is null then
    return;
  end if;
  if not exists (
    select 1 from public.sos_requests s
    where s.created_at > now() - interval '3 days'
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null)))
     and not exists (
    select 1 from public.admin_decisions_since(now() - interval '3 days') x
    where not exists (select 1 from public.line_decision_log l where l.audit_id = x.audit_id)) then
    return;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  perform extensions.http((
    'POST', g.site_url || '/api/push/tick',
    array[extensions.http_header('x-jaga-push', g.token)],
    'application/json', '{}'
  )::extensions.http_request);
exception when others then
  -- A site that is down must not fill the cron log with errors, or stop the next minute's try.
  null;
end $$;
revoke execute on function public.push_tick() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- For the bell: what an admin decided about the caller's own flood reports, in the last
-- fourteen days. The latest decision per report.
-------------------------------------------------------------------------------
create function public.my_report_decisions()
returns table (report_id uuid, status text, decided_at timestamptz, tambon_th text, tambon_en text)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.id) r.id, a.details ->> 'to', a.ts, t.name_th, t.name_en
    from public.audit_log a
    join public.reports r on r.id::text = a.entity_id
    left join public.tambons t on t.code = r.tambon
   where a.entity = 'reports'
     and a.action = 'report_moderated'
     and a.details ->> 'to' in ('approved', 'hidden')
     and r.reporter_id = (select auth.uid())
     and a.ts > now() - interval '14 days'
   order by r.id, a.ts desc
$$;
revoke execute on function public.my_report_decisions() from public, anon;
grant execute on function public.my_report_decisions() to authenticated;
