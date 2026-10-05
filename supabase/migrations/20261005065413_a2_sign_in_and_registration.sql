-- A2: sign-in and registration (spec section 3).
-- Everything that grants a role, verifies an authority or links a LINE account happens in a
-- security-definer function here. No client path can set role or status.

-------------------------------------------------------------------------------
-- Role guard: applies to the API roles only, so the definer functions below can change a role.
-- (Clients have no UPDATE grant on profiles.role; this trigger is the second lock.)
-------------------------------------------------------------------------------
create or replace function public.guard_profile_role() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.role is distinct from old.role and current_user in ('authenticated', 'anon') then
    if new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin') then
      if not public.is_super_admin() then
        raise exception 'Only the super admin can change admin roles' using errcode = 'insufficient_privilege';
      end if;
    elsif not public.is_admin() then
      raise exception 'Only an admin can change a role' using errcode = 'insufficient_privilege';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-------------------------------------------------------------------------------
-- LINE: the user ID comes from the sign-in identity, never from the client.
-- Alerts are pushed to this ID, so a user must not be able to type someone else's.
-------------------------------------------------------------------------------
revoke update (line_user_id) on public.profiles from authenticated;

-- Called after a LINE sign-in. Copies the LINE user ID (and the LINE name, if the profile has
-- none yet) from the caller's own identity. Returns false when the caller has no LINE identity.
create function public.sync_line_identity() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub text;
  v_name text;
begin
  if v_uid is null then return false; end if;
  select i.provider_id, coalesce(i.identity_data ->> 'name', i.identity_data ->> 'full_name')
    into v_sub, v_name
  from auth.identities i
  where i.user_id = v_uid and i.provider = 'custom:line'
  limit 1;
  if v_sub is null then return false; end if;
  update public.profiles
  set line_user_id = v_sub,
      display_name = case when display_name = '' then left(coalesce(v_name, ''), 80) else display_name end
  where user_id = v_uid and (line_user_id is distinct from v_sub or display_name = '');
  return true;
end $$;
revoke execute on function public.sync_line_identity() from public, anon;
grant execute on function public.sync_line_identity() to authenticated;

-------------------------------------------------------------------------------
-- Admin invitations: only an invited, confirmed email or phone can become an admin.
-------------------------------------------------------------------------------
alter table public.admin_invitations
  add constraint admin_invitations_contact_normalized
  check (email_or_phone = lower(btrim(email_or_phone)) and char_length(email_or_phone) between 5 and 254);
create unique index admin_invitations_pending_idx
  on public.admin_invitations (email_or_phone) where status = 'pending';

-- The signed-in caller takes up a pending invitation that matches their confirmed email or
-- phone. Returns the granted role, or null when there is no invitation. Invitations lapse
-- after 14 days. A super admin is never downgraded by an older invitation.
create function public.accept_admin_invitation() returns public.user_role
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_phone text;
  v_inv public.admin_invitations;
begin
  if v_uid is null then return null; end if;
  select case when u.email_confirmed_at is not null then lower(u.email) end,
         case when u.phone_confirmed_at is not null then ltrim(u.phone, '+') end
    into v_email, v_phone
  from auth.users u where u.id = v_uid;

  select * into v_inv
  from public.admin_invitations i
  where i.status = 'pending'
    and i.created_at > now() - interval '14 days'
    and (i.email_or_phone = v_email or ltrim(i.email_or_phone, '+') = v_phone)
  order by (i.role = 'super_admin') desc, i.created_at
  limit 1
  for update;
  if not found then return null; end if;

  update public.profiles set role = v_inv.role
  where user_id = v_uid and role <> 'super_admin';
  update public.admin_invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'accept_admin_invitation', 'profiles', v_uid::text,
          jsonb_build_object('role', v_inv.role, 'invitation', v_inv.id));
  return v_inv.role;
end $$;
revoke execute on function public.accept_admin_invitation() from public, anon;
grant execute on function public.accept_admin_invitation() to authenticated;

-- The super admin changes or removes another person's admin role. Never their own, so the
-- project cannot be left without a super admin by a slip.
create function public.set_admin_role(p_user_id uuid, p_role public.user_role) returns void
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
  if p_role not in ('user', 'admin', 'super_admin') then
    raise exception 'Choose user, admin or super_admin' using errcode = 'check_violation';
  end if;
  if p_role = 'user' and exists (select 1 from public.authority_units
                                 where user_id = p_user_id and status = 'verified') then
    v_role := 'authority';
  end if;
  update public.profiles set role = v_role where user_id = p_user_id;
  if not found then
    raise exception 'No such user' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'set_admin_role', 'profiles', p_user_id::text, jsonb_build_object('role', v_role));
end $$;
revoke execute on function public.set_admin_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_admin_role(uuid, public.user_role) to authenticated;

-------------------------------------------------------------------------------
-- Authority registration: one call creates the organization (or joins an existing one of the
-- same name and type), the unit as pending, its contact and its coverage expanded to tambons.
-------------------------------------------------------------------------------
create function public.org_has_verified_unit(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.authority_units
                 where org_id = p_org_id and status = 'verified')
$$;

-- An organization's phone becomes public only once it opted in AND an admin has verified one of
-- its units; otherwise anyone could publish a number by registering. A registrant can read the
-- organization they registered under.
drop policy "organizations: public if opted in" on public.organizations;
create policy "organizations: public if opted in and verified" on public.organizations
  for select to anon, authenticated
  using ((public_contact_opt_in and public.org_has_verified_unit(organizations.id))
         or created_by = (select auth.uid())
         or exists (select 1 from public.authority_units u
                    where u.org_id = organizations.id and u.user_id = (select auth.uid()))
         or public.is_verified_authority()
         or public.is_admin());

-- p_coverage: [{"level": "province" | "district" | "tambon", "code": "<DOPA code>"}, ...]
create function public.register_authority_unit(
  p_org_name text,
  p_org_type public.org_type,
  p_unit_name text,
  p_official_phone text,
  p_public_contact_opt_in boolean,
  p_poc_name text,
  p_poc_phone text,
  p_capabilities public.authority_capability[],
  p_coverage jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_unit uuid;
  v_item jsonb;
  v_level public.admin_level;
  v_phone_verified boolean;
begin
  if v_uid is null then
    raise exception 'Sign in before registering' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_capabilities, 1), 0) = 0 then
    raise exception 'Choose at least one capability' using errcode = 'check_violation';
  end if;
  if p_coverage is null or jsonb_typeof(p_coverage) <> 'array' or jsonb_array_length(p_coverage) = 0 then
    raise exception 'Choose at least one area' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.authority_units where user_id = v_uid) >= 5 then
    raise exception 'One account can register at most 5 units' using errcode = 'check_violation';
  end if;

  select o.id into v_org
  from public.organizations o
  where lower(o.name) = lower(btrim(p_org_name)) and o.type = p_org_type
  order by o.created_at
  limit 1;
  if v_org is null then
    insert into public.organizations (name, type, official_phone, public_contact_opt_in, created_by)
    values (btrim(p_org_name), p_org_type, nullif(btrim(p_official_phone), ''),
            coalesce(p_public_contact_opt_in, false), v_uid)
    returning id into v_org;
  end if;

  insert into public.authority_units (org_id, user_id, unit_name, capabilities)
  values (v_org, v_uid, btrim(p_unit_name),
          (select array_agg(distinct c order by c) from unnest(p_capabilities) c))
  returning id into v_unit;

  -- Verified already when it is the phone the caller signed in with by OTP.
  select exists (select 1 from auth.users u
                 where u.id = v_uid and u.phone_confirmed_at is not null
                   and ltrim(u.phone, '+') = ltrim(btrim(p_poc_phone), '+'))
    into v_phone_verified;
  insert into public.authority_unit_contacts (unit_id, poc_name, poc_phone, poc_phone_verified)
  values (v_unit, btrim(p_poc_name), btrim(p_poc_phone), v_phone_verified);

  -- Widest selections first, so a tambon inside a selected province is recorded under the province.
  for v_item in
    select value from jsonb_array_elements(p_coverage)
    order by array_position(array['province', 'district', 'tambon'], value ->> 'level')
  loop
    v_level := (v_item ->> 'level')::public.admin_level;
    insert into public.authority_coverage (unit_id, tambon, selected_level, selected_code)
    select v_unit, t, v_level, v_item ->> 'code'
    from public.expand_coverage(v_level, v_item ->> 'code') t
    on conflict (unit_id, tambon) do nothing;
  end loop;
  if not exists (select 1 from public.authority_coverage where unit_id = v_unit) then
    raise exception 'The selected area is outside the provinces Jaga covers' using errcode = 'check_violation';
  end if;
  return v_unit;
end $$;
revoke execute on function public.register_authority_unit(
  text, public.org_type, text, text, boolean, text, text, public.authority_capability[], jsonb
) from public, anon;
grant execute on function public.register_authority_unit(
  text, public.org_type, text, text, boolean, text, text, public.authority_capability[], jsonb
) to authenticated;

-------------------------------------------------------------------------------
-- Verification by an admin. Until phone sign-in is live (decision 30 Sep), the admin calls the
-- contact phone and confirms it here; a unit cannot be verified with an unconfirmed phone.
-------------------------------------------------------------------------------
create function public.verify_authority_unit(p_unit_id uuid, p_phone_confirmed_by_call boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_phone_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can verify an authority' using errcode = 'insufficient_privilege';
  end if;
  select u.user_id into v_user from public.authority_units u where u.id = p_unit_id for update;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  select c.poc_phone_verified or c.poc_phone_verified_by_call into v_phone_ok
  from public.authority_unit_contacts c where c.unit_id = p_unit_id;
  if not (coalesce(v_phone_ok, false) or coalesce(p_phone_confirmed_by_call, false)) then
    raise exception 'Confirm the contact phone by calling it before verifying' using errcode = 'check_violation';
  end if;
  if p_phone_confirmed_by_call then
    update public.authority_unit_contacts set poc_phone_verified_by_call = true where unit_id = p_unit_id;
  end if;
  update public.authority_units
  set status = 'verified', verified_by = (select auth.uid()), verified_at = now()
  where id = p_unit_id;
  update public.profiles set role = 'authority' where user_id = v_user and role = 'user';
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), 'verify_authority', 'authority_units', p_unit_id::text,
          jsonb_build_object('phone_confirmed_by_call', coalesce(p_phone_confirmed_by_call, false)));
end $$;
revoke execute on function public.verify_authority_unit(uuid, boolean) from public, anon;
grant execute on function public.verify_authority_unit(uuid, boolean) to authenticated;

create function public.suspend_authority_unit(p_unit_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can suspend an authority' using errcode = 'insufficient_privilege';
  end if;
  update public.authority_units set status = 'suspended' where id = p_unit_id
  returning user_id into v_user;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  update public.profiles set role = 'user'
  where user_id = v_user and role = 'authority'
    and not exists (select 1 from public.authority_units
                    where user_id = v_user and status = 'verified');
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), 'suspend_authority', 'authority_units', p_unit_id::text,
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
end $$;
revoke execute on function public.suspend_authority_unit(uuid, text) from public, anon;
grant execute on function public.suspend_authority_unit(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- Sign-in codes by SMS: a send limit per phone and per network address, checked by the Send SMS
-- hook before any provider is called. Only a hash of the phone is kept. Limits are generous per
-- address because Thai mobile networks put many phones behind one address.
-------------------------------------------------------------------------------
create table public.otp_send_log (
  id bigint generated always as identity primary key,
  phone_hash text not null,
  ip inet,
  sent_at timestamptz not null default now()
);
create index otp_send_log_phone_idx on public.otp_send_log (phone_hash, sent_at desc);
create index otp_send_log_ip_idx on public.otp_send_log (ip, sent_at desc);
alter table public.otp_send_log enable row level security;
revoke all on public.otp_send_log from anon, authenticated;

-- True (and recorded) when a code may be sent: at most 5 an hour per phone, 60 an hour per address.
create function public.otp_send_allowed(p_phone text, p_ip inet) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to(ltrim(btrim(p_phone), '+'), 'UTF8')), 'hex');
begin
  delete from public.otp_send_log where sent_at < now() - interval '1 day';
  if (select count(*) from public.otp_send_log
      where phone_hash = v_hash and sent_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;
  if p_ip is not null and (select count(*) from public.otp_send_log
                           where ip = p_ip and sent_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  insert into public.otp_send_log (phone_hash, ip) values (v_hash, p_ip);
  return true;
end $$;
revoke execute on function public.otp_send_allowed(text, inet) from public, anon, authenticated;
grant execute on function public.otp_send_allowed(text, inet) to service_role;
