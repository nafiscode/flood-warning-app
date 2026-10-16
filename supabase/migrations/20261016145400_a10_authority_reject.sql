-- A10 (2/2): turning a registration down, with a reason the team is told (owner, 16 Oct 2026).
--
-- An admin who can see that a registration is a test, or somebody trying the app out, says no
-- and writes why. The reason is not an internal note: it is shown to the account that registered,
-- in the bell and in LINE, inside a polite message from Jaga. So:
--
--   * only a *pending* registration can be turned down (a verified team is suspended instead);
--   * a reason is required, and is written to audit_log like every other decision;
--   * the team reads it through `my_unit_reviews()`, never from audit_log itself (admins only)
--     and never from a column on authority_units, which every verified team can read;
--   * `admin_decisions_since` carries it to LINE, so the minute's push tick tells them.
--
-- Nothing about this is automatic and nothing is deleted: the registration stays, marked
-- 'rejected', and an admin can still verify it after all if the no was a mistake.

create function public.reject_authority_unit(p_unit_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.authority_status;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'Only an admin can turn a registration down' using errcode = 'insufficient_privilege';
  end if;
  -- The team is told this reason, so an empty one is not allowed.
  if char_length(v_reason) < 3 then
    raise exception 'Write the reason the registration is turned down' using errcode = 'check_violation';
  end if;
  select u.status into v_status from public.authority_units u where u.id = p_unit_id for update;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only a registration still waiting can be turned down' using errcode = 'check_violation';
  end if;
  update public.authority_units set status = 'rejected' where id = p_unit_id;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), 'reject_authority', 'authority_units', p_unit_id::text,
          jsonb_build_object('reason', left(v_reason, 500)));
end $$;
revoke execute on function public.reject_authority_unit(uuid, text) from public, anon;
grant execute on function public.reject_authority_unit(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- What an admin wrote when they turned down one of the caller's own registrations. Only while it
-- stands rejected: verified after all, and there is nothing to read. The audit log itself stays
-- admins-only; this is the one window onto it, and onto the caller's own rows alone.
-------------------------------------------------------------------------------
create function public.my_unit_reviews()
returns table (unit_id uuid, reason text, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct on (u.id) u.id, a.details ->> 'reason', a.ts
    from public.authority_units u
    join public.audit_log a on a.entity = 'authority_units'
                           and a.action = 'reject_authority'
                           and a.entity_id = u.id::text
   where u.user_id = (select auth.uid())
     and u.status = 'rejected'
   order by u.id, a.ts desc
$$;
revoke execute on function public.my_unit_reviews() from public, anon;
grant execute on function public.my_unit_reviews() to authenticated;

-------------------------------------------------------------------------------
-- The decision reaches LINE like the other three (20261015030700). A turned-down registration is
-- the only one that carries words an admin wrote: `jsonb_strip_nulls` keeps the other two rows
-- exactly as they were.
-------------------------------------------------------------------------------
create or replace function public.admin_decisions_since(p_since timestamptz)
returns table (
  audit_id bigint, kind text, user_id uuid, ref text, data jsonb, decided_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id,
         case a.action
           when 'verify_authority' then 'unit_verified'
           when 'reject_authority' then 'unit_rejected'
           else 'unit_suspended'
         end,
         u.user_id, u.id::text,
         jsonb_strip_nulls(jsonb_build_object(
           'unit', u.unit_name,
           'reason', case when a.action = 'reject_authority' then a.details ->> 'reason' end)),
         a.ts
    from public.audit_log a
    join public.authority_units u on u.id::text = a.entity_id
   where a.entity = 'authority_units'
     and a.action in ('verify_authority', 'suspend_authority', 'reject_authority')
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
