-- A team that registers is told to the admins' phones once (owner, 24 Oct 2026).
--
-- The bell already lists "1 team has registered and is waiting to be verified", but only for an
-- admin who opens the app: one whose phone is in a pocket heard nothing, so a registration could
-- wait a day. The 22 Oct choice that the bell's queues make no sound stands - this is one quiet
-- ordinary notification per registration, like a held field rescue, not a ring: a registration is
-- rare and the person who made it is waiting for a call.
--
-- Handed out once per unit (admins_notified_at), only while the unit is still pending, and only
-- to Jaga's own server, which holds the gate token; a team's session is never given the admins'
-- push addresses. It names the team, never a person or a number.

alter table public.authority_units add column admins_notified_at timestamptz;

create function public.push_unit_waiting(p_token text, p_unit uuid)
returns table (endpoint text, keys jsonb, locale text, unit_name text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.authority_units u set admins_notified_at = now()
   where u.id = p_unit and u.status = 'pending' and u.admins_notified_at is null;
  get diagnostics fresh = row_count;
  if fresh = 0 then
    return;
  end if;
  return query
  select ps.endpoint, ps.keys, ps.locale, u.unit_name
    from public.authority_units u
    join public.profiles p on p.role in ('admin', 'super_admin')
    join public.push_subscriptions ps on ps.user_id = p.user_id
   where u.id = p_unit;
end $$;
revoke execute on function public.push_unit_waiting(text, uuid) from public;
grant execute on function public.push_unit_waiting(text, uuid) to anon, authenticated;
