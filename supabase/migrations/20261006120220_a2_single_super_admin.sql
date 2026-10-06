-- A2: one super admin (the project account); everyone else the super admin invites is an admin
-- (owner decision 2026-10-06). The super admin role can only be set with database access
-- (scripts/admin.mjs); nothing in the app can grant it.

alter table public.admin_invitations drop constraint admin_invitations_role_check;
alter table public.admin_invitations
  add constraint admin_invitations_role_check check (role = 'admin');

-- The super admin makes someone an admin or takes the admin role away. Never their own role,
-- never another super admin's, and never up to super admin.
create or replace function public.set_admin_role(p_user_id uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.user_role := p_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can change admin roles' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot change your own role' using errcode = 'check_violation';
  end if;
  if p_role not in ('user', 'admin') then
    raise exception 'Choose user or admin' using errcode = 'check_violation';
  end if;
  if p_role = 'user' and exists (select 1 from public.authority_units
                                 where user_id = p_user_id and status = 'verified') then
    v_role := 'authority';
  end if;
  update public.profiles set role = v_role where user_id = p_user_id and role <> 'super_admin';
  if not found then
    raise exception 'No such user, or the user is a super admin' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'set_admin_role', 'profiles', p_user_id::text, jsonb_build_object('role', v_role));
end $$;
