-- A10 fix: `add_admin_member` chose the new row's status with a `case` expression, which
-- Postgres types as text, so inserting it raised "column status is of type
-- public.admin_member_status but expression is of type text" and nobody could be added. The
-- cast was missing; the body is otherwise the one from ..a10_admin_team, which is left as it
-- was applied.

create or replace function public.add_admin_member(
  p_email text, p_full_name text, p_phone text, p_duty text, p_deputy boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  v_duty text := btrim(coalesce(p_duty, ''));
  v_name text := left(btrim(coalesce(p_full_name, '')), 80);
  v_target uuid;
  v_role public.user_role;
  v_id uuid;
begin
  if not public.can_manage_admins() then
    raise exception 'Only the super admin or a deputy can add an admin' using errcode = 'insufficient_privilege';
  end if;
  if p_deputy and not public.is_super_admin() then
    raise exception 'Only the super admin can appoint a deputy' using errcode = 'insufficient_privilege';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then
    raise exception 'Write a valid email address' using errcode = 'check_violation';
  end if;
  -- Mandatory (owner, 16 Oct): an admin nobody can telephone is no use in a flood.
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'Write a phone number the team can reach them on' using errcode = 'check_violation';
  end if;
  if v_duty = '' then
    raise exception 'Say what this admin is there to do' using errcode = 'check_violation';
  end if;

  select p.user_id, p.role into v_target, v_role
    from auth.users u join public.profiles p on p.user_id = u.id
   where lower(u.email) = v_email;
  if v_role = 'super_admin' then
    raise exception 'That account is a super admin already' using errcode = 'check_violation';
  end if;

  insert into public.admin_members (user_id, email, full_name, duty, deputy, status, added_by,
                                    approved_at)
  values (v_target, v_email, v_name, v_duty, coalesce(p_deputy, false),
          (case when v_target is null then 'invited' else 'active' end)::public.admin_member_status,
          v_uid,
          case when v_target is null then null else now() end)
  returning id into v_id;
  insert into public.admin_member_contacts (member_id, phone) values (v_id, v_phone);

  if v_target is not null then
    update public.profiles set role = 'admin' where user_id = v_target and role not in ('admin', 'super_admin');
  end if;
  update public.admin_invitations set status = 'revoked'
   where email_or_phone = v_email and status = 'pending';
  insert into public.admin_invitations (email_or_phone, role, invited_by)
  values (v_email, 'admin', v_uid);

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'add_admin_member', 'admin_members', v_id::text,
          jsonb_build_object('email', v_email, 'duty', v_duty, 'deputy', coalesce(p_deputy, false)));
  return v_id;
end $$;
