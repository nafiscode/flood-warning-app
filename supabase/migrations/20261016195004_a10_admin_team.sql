-- A10: the admin team (owner, 16 Oct 2026).
--
-- One page where every admin is kept: their name, the address they sign in with, the phone
-- number the rest of the team can reach them on, and the duty the super admin gives them.
-- Four things the owner decided, and the reasons they are built the way they are:
--
--   * **The duty is a label, not a lock.** Every admin keeps every admin power; the duty says
--     what that person is there to do (alerts, war room, moderation...). Hiding pages without
--     the database refusing the write would be a false sense of safety in life-safety software,
--     so we do not pretend: if duties are ever to restrict anything, they get their own phase
--     with row-level security and policy tests per duty.
--   * **The phone number is mandatory, and personal data all the same** (safety rule 5). It is
--     therefore not a column on `admin_members`, which the whole team page reads: it lives in
--     `admin_member_contacts`, a table with no select policy at all, and comes out only through
--     `reveal_admin_phone()`, which writes the reveal to `audit_log` like every other phone in
--     Jaga. The list itself shows the last four digits.
--   * **"Deputy super admin" is a flag on the row, not a value in `user_role`.** A new role in
--     the enum would mean revisiting `is_admin()` and every policy that names a role, nine days
--     before go-live. The flag reads as a role on the page and is checked in exactly one place,
--     `can_manage_admins()`.
--   * **The way in is the person's role, never a secret in a link.** The LINE message Jaga sends
--     an approved admin is a plain link to the console: forwarded, screenshotted or left on a
--     borrowed phone it grants nobody anything, and it works until the super admin revokes the
--     role. Nothing here mints a token.
--
-- Two ways onto the list, both ending in the same row: the super admin adds somebody (status
-- 'invited', bound to their account the first time they sign in with that address), or somebody
-- signed in asks from their account page (status 'requested', waiting for an approval).

-------------------------------------------------------------------------------
-- The roster
-------------------------------------------------------------------------------
create type public.admin_member_status as enum ('invited', 'requested', 'active', 'revoked');

create table public.admin_members (
  id uuid primary key default gen_random_uuid(),
  -- Bound when that person first signs in; null while the row is only an invitation.
  user_id uuid unique references public.profiles (user_id) on delete set null,
  -- The address they sign in with. Null only for someone who asked from an account that has
  -- none (LINE sign-in carries no email); the super admin fills it in when approving.
  email text check (email = lower(btrim(email)) and char_length(email) between 5 and 254),
  full_name text not null default '' check (char_length(full_name) <= 80),
  -- What this admin is there to do. Written by the super admin; restricts nothing.
  duty text not null default '' check (char_length(duty) <= 60),
  -- Sees and edits this page, as the super admin does. Only a super admin may set it.
  deputy boolean not null default false,
  status public.admin_member_status not null default 'invited',
  added_by uuid references public.profiles (user_id) on delete set null,
  -- Why they are on the team, or why they asked. Internal; never shown outside this page.
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  -- When Jaga sent them their way in over LINE, so it is sent once.
  line_sent_at timestamptz
);
create unique index admin_members_email_idx on public.admin_members (email) where email is not null;
create index admin_members_status_idx on public.admin_members (status);

-- Personal data (safety rule 5). No select policy, ever: `admin_team()` gives the last four
-- digits and `reveal_admin_phone()` gives the number and logs that it did.
create table public.admin_member_contacts (
  member_id uuid primary key references public.admin_members (id) on delete cascade,
  phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  updated_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;
alter table public.admin_member_contacts enable row level security;

-------------------------------------------------------------------------------
-- Who may work this page: the super admin, and an active deputy.
-------------------------------------------------------------------------------
create function public.can_manage_admins() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.admin_members m
     where m.user_id = (select auth.uid()) and m.deputy and m.status = 'active'
  )
$$;
revoke execute on function public.can_manage_admins() from public, anon;
grant execute on function public.can_manage_admins() to authenticated;

-- Reading the roster is theirs alone; every write goes through the functions below, so there
-- is no insert, update or delete policy on either table and none on the phone numbers at all.
create policy admin_members_read on public.admin_members
  for select to authenticated using (public.can_manage_admins());

-------------------------------------------------------------------------------
-- The team as the page draws it: the roster, plus any admin who has no row here yet, so that
-- nobody with an admin role is invisible on the page that is meant to list them all.
-------------------------------------------------------------------------------
create function public.admin_team()
returns table (
  member_id uuid, user_id uuid, email text, full_name text, duty text, deputy boolean,
  status text, role public.user_role, phone_last4 text, has_phone boolean,
  line_ready boolean, line_sent_at timestamptz, created_at timestamptz, approved_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, coalesce(m.email, lower(u.email)),
         case when m.full_name <> '' then m.full_name else coalesce(p.display_name, '') end,
         m.duty, m.deputy, m.status::text, p.role,
         right(c.phone, 4), c.phone is not null,
         p.line_user_id is not null, m.line_sent_at, m.created_at, m.approved_at
    from public.admin_members m
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    left join public.admin_member_contacts c on c.member_id = m.id
   where public.can_manage_admins()
  union all
  -- An admin from before this page existed, or the super admins themselves.
  select null, p.user_id, lower(u.email), p.display_name, '', false,
         'active', p.role, null, false,
         p.line_user_id is not null, null, p.created_at, null
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where public.can_manage_admins()
     and p.role in ('admin', 'super_admin')
     and not exists (select 1 from public.admin_members m where m.user_id = p.user_id)
$$;
revoke execute on function public.admin_team() from public, anon;
grant execute on function public.admin_team() to authenticated;

-------------------------------------------------------------------------------
-- Adding somebody. The address is also written as an ordinary admin invitation, so the email
-- link in /sign-in keeps working exactly as it did; this row is what the team page reads.
-------------------------------------------------------------------------------
create function public.add_admin_member(
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
          case when v_target is null then 'invited' else 'active' end, v_uid,
          case when v_target is null then null else now() end)
  returning id into v_id;
  insert into public.admin_member_contacts (member_id, phone) values (v_id, v_phone);

  -- Already has an account: the role is theirs now. Otherwise the invitation below grants it
  -- the first time they sign in with that address.
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
revoke execute on function public.add_admin_member(text, text, text, text, boolean) from public, anon;
grant execute on function public.add_admin_member(text, text, text, text, boolean) to authenticated;

-------------------------------------------------------------------------------
-- Asking to join, from the account page. Nothing is granted here: the row waits.
-------------------------------------------------------------------------------
create function public.request_admin_access(p_phone text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  v_note text := left(btrim(coalesce(p_note, '')), 500);
  v_email text;
  v_name text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'Write a phone number the team can reach you on' using errcode = 'check_violation';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'Say what you would help with' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.admin_members m
              where m.user_id = v_uid and m.status in ('invited', 'requested', 'active')) then
    raise exception 'You have asked already' using errcode = 'unique_violation';
  end if;
  select case when u.email_confirmed_at is not null then lower(u.email) end, p.display_name
    into v_email, v_name
    from auth.users u join public.profiles p on p.user_id = u.id where u.id = v_uid;

  insert into public.admin_members (user_id, email, full_name, duty, status, note)
  values (v_uid, v_email, left(coalesce(v_name, ''), 80), '', 'requested', v_note)
  returning id into v_id;
  insert into public.admin_member_contacts (member_id, phone) values (v_id, v_phone);
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'request_admin_access', 'admin_members', v_id::text, '{}'::jsonb);
  return v_id;
end $$;
revoke execute on function public.request_admin_access(text, text) from public, anon;
grant execute on function public.request_admin_access(text, text) to authenticated;

-- What the caller's own request is doing, for their account page. Their own row only.
create function public.my_admin_request()
returns table (status text, duty text, created_at timestamptz, approved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.status::text, m.duty, m.created_at, m.approved_at
    from public.admin_members m
   where m.user_id = (select auth.uid())
   order by m.created_at desc limit 1
$$;
revoke execute on function public.my_admin_request() from public, anon;
grant execute on function public.my_admin_request() to authenticated;

-------------------------------------------------------------------------------
-- Approving somebody who asked: the duty is set here, because that is the super admin's call.
-------------------------------------------------------------------------------
create function public.approve_admin_member(p_member_id uuid, p_duty text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_duty text := btrim(coalesce(p_duty, ''));
  v_m public.admin_members;
begin
  if not public.can_manage_admins() then
    raise exception 'Only the super admin or a deputy can approve an admin' using errcode = 'insufficient_privilege';
  end if;
  if v_duty = '' then
    raise exception 'Say what this admin is there to do' using errcode = 'check_violation';
  end if;
  select * into v_m from public.admin_members where id = p_member_id for update;
  if not found then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  if v_m.status not in ('requested', 'invited') then
    raise exception 'Only somebody still waiting can be approved' using errcode = 'check_violation';
  end if;
  if v_m.user_id is null then
    raise exception 'They have not signed in yet' using errcode = 'check_violation';
  end if;
  update public.admin_members
     set status = 'active', duty = v_duty, approved_at = now()
   where id = p_member_id;
  update public.profiles set role = 'admin'
   where user_id = v_m.user_id and role not in ('admin', 'super_admin');
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'approve_admin_member', 'admin_members', p_member_id::text,
          jsonb_build_object('duty', v_duty));
end $$;
revoke execute on function public.approve_admin_member(uuid, text) from public, anon;
grant execute on function public.approve_admin_member(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- Changing a row: name, address, phone, duty. Null leaves a field as it was.
-------------------------------------------------------------------------------
create function public.update_admin_member(
  p_member_id uuid, p_full_name text default null, p_email text default null,
  p_phone text default null, p_duty text default null, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
  v_duty text := nullif(btrim(coalesce(p_duty, '')), '');
begin
  if not public.can_manage_admins() then
    raise exception 'Only the super admin or a deputy can change the team' using errcode = 'insufficient_privilege';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Write a valid email address' using errcode = 'check_violation';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'Write a phone number the team can reach them on' using errcode = 'check_violation';
  end if;
  update public.admin_members
     set full_name = coalesce(left(btrim(p_full_name), 80), full_name),
         email = coalesce(v_email, email),
         duty = coalesce(v_duty, duty),
         note = coalesce(left(btrim(p_note), 500), note)
   where id = p_member_id;
  if not found then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  if v_phone is not null then
    insert into public.admin_member_contacts (member_id, phone) values (p_member_id, v_phone)
    on conflict (member_id) do update set phone = excluded.phone, updated_at = now();
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'update_admin_member', 'admin_members', p_member_id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'duty', v_duty, 'email', v_email, 'phone', case when v_phone is null then null else true end)));
end $$;
revoke execute on function public.update_admin_member(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_admin_member(uuid, text, text, text, text, text) to authenticated;

-------------------------------------------------------------------------------
-- Making or unmaking a deputy. The super admin alone: a deputy who could appoint deputies
-- would be a super admin by another name.
-------------------------------------------------------------------------------
create function public.set_admin_member_deputy(p_member_id uuid, p_deputy boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_m public.admin_members;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can appoint a deputy' using errcode = 'insufficient_privilege';
  end if;
  select * into v_m from public.admin_members where id = p_member_id for update;
  if not found then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  if p_deputy and v_m.status <> 'active' then
    raise exception 'Only an admin already on the team can be a deputy' using errcode = 'check_violation';
  end if;
  update public.admin_members set deputy = coalesce(p_deputy, false) where id = p_member_id;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'set_admin_member_deputy', 'admin_members', p_member_id::text,
          jsonb_build_object('deputy', coalesce(p_deputy, false)));
end $$;
revoke execute on function public.set_admin_member_deputy(uuid, boolean) from public, anon;
grant execute on function public.set_admin_member_deputy(uuid, boolean) to authenticated;

-------------------------------------------------------------------------------
-- Taking the access away. The row stays, marked 'revoked', with who did it in the log: a team
-- list that forgets people is no record at all. A super admin is never touched from here.
-------------------------------------------------------------------------------
create function public.revoke_admin_member(p_member_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_m public.admin_members;
  v_role public.user_role;
  v_back public.user_role := 'user';
begin
  if not public.can_manage_admins() then
    raise exception 'Only the super admin or a deputy can take admin access away' using errcode = 'insufficient_privilege';
  end if;
  select * into v_m from public.admin_members where id = p_member_id for update;
  if not found then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  if v_m.user_id = v_uid then
    raise exception 'You cannot take away your own access' using errcode = 'check_violation';
  end if;
  if v_m.deputy and not public.is_super_admin() then
    raise exception 'Only the super admin can remove a deputy' using errcode = 'insufficient_privilege';
  end if;
  select role into v_role from public.profiles where user_id = v_m.user_id;
  if v_role = 'super_admin' then
    raise exception 'A super admin is not removed from here' using errcode = 'check_violation';
  end if;
  if v_m.user_id is not null and exists (select 1 from public.authority_units
                                          where user_id = v_m.user_id and status = 'verified') then
    v_back := 'authority';
  end if;
  update public.admin_members
     set status = 'revoked', deputy = false, revoked_at = now() where id = p_member_id;
  if v_m.user_id is not null then
    update public.profiles set role = v_back where user_id = v_m.user_id and role = 'admin';
  end if;
  update public.admin_invitations set status = 'revoked'
   where email_or_phone = v_m.email and status = 'pending';
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'revoke_admin_member', 'admin_members', p_member_id::text,
          jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 500)));
end $$;
revoke execute on function public.revoke_admin_member(uuid, text) from public, anon;
grant execute on function public.revoke_admin_member(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- The phone number itself, one look at a time, written to the log like every other reveal in
-- Jaga (safety rule 5).
-------------------------------------------------------------------------------
create function public.reveal_admin_phone(p_member_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_phone text;
begin
  if not public.can_manage_admins() then
    raise exception 'Only the super admin or a deputy can see an admin phone number' using errcode = 'insufficient_privilege';
  end if;
  select phone into v_phone from public.admin_member_contacts where member_id = p_member_id;
  if v_phone is null then
    raise exception 'No phone number on file' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (v_uid, 'reveal_admin_phone', 'admin_members', p_member_id::text, '{}'::jsonb);
  return v_phone;
end $$;
revoke execute on function public.reveal_admin_phone(uuid) from public, anon;
grant execute on function public.reveal_admin_phone(uuid) to authenticated;

-------------------------------------------------------------------------------
-- Binding an invited row to its account, at sign-in. Runs beside accept_admin_invitation()
-- (lib/auth.ts finishSignIn) and returns the row that has just become live, so the app can
-- send that person their way in over LINE.
-------------------------------------------------------------------------------
create function public.link_admin_member()
returns table (member_id uuid, duty text, line_user_id text, locale text, send boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_m public.admin_members;
begin
  if v_uid is null then return; end if;
  select case when u.email_confirmed_at is not null then lower(u.email) end into v_email
    from auth.users u where u.id = v_uid;

  -- An invitation waiting for this address becomes this person's row.
  if v_email is not null then
    select * into v_m from public.admin_members m
     where m.user_id is null and m.email = v_email and m.status = 'invited'
     order by m.created_at limit 1 for update;
    if found then
      update public.admin_members
         set user_id = v_uid, status = 'active', approved_at = now() where id = v_m.id;
      update public.profiles set role = 'admin'
       where user_id = v_uid and role not in ('admin', 'super_admin');
      insert into public.audit_log (actor, action, entity, entity_id, details)
      values (v_uid, 'link_admin_member', 'admin_members', v_m.id::text, '{}'::jsonb);
    end if;
  end if;

  -- Their way in goes out over LINE once, as soon as Jaga knows their LINE account.
  return query
    select m.id, m.duty, p.line_user_id, p.preferred_locale,
           (m.line_sent_at is null and p.line_user_id is not null)
      from public.admin_members m
      join public.profiles p on p.user_id = m.user_id
     where m.user_id = v_uid and m.status = 'active';
end $$;
revoke execute on function public.link_admin_member() from public, anon;
grant execute on function public.link_admin_member() to authenticated;

-- Somebody approved whose way in has not gone out yet, for the approving admin to send.
create function public.admin_welcome_target(p_member_id uuid)
returns table (duty text, full_name text, line_user_id text, locale text)
language sql stable security definer set search_path = '' as $$
  select m.duty, coalesce(nullif(m.full_name, ''), p.display_name), p.line_user_id, p.preferred_locale
    from public.admin_members m
    join public.profiles p on p.user_id = m.user_id
   where m.id = p_member_id and m.status = 'active' and m.line_sent_at is null
     and p.line_user_id is not null
     and (public.can_manage_admins() or m.user_id = (select auth.uid()))
$$;
revoke execute on function public.admin_welcome_target(uuid) from public, anon;
grant execute on function public.admin_welcome_target(uuid) to authenticated;

create function public.admin_welcome_sent(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.admin_members set line_sent_at = now()
   where id = p_member_id and line_sent_at is null
     and (public.can_manage_admins() or user_id = (select auth.uid()));
end $$;
revoke execute on function public.admin_welcome_sent(uuid) from public, anon;
grant execute on function public.admin_welcome_sent(uuid) to authenticated;
