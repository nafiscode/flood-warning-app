-- A10: say on the team page whether an invited admin actually has an account yet.
--
-- `SUPABASE_SECRET_KEY` is deliberately not on the live site, and the Auth admin API is the
-- only thing that can open an account for an address. The email-link form will not open one
-- either (`shouldCreateUser: false` in the sign-in action, on purpose: an email link that
-- creates accounts is an open door). So adding somebody from jagaapp.org writes their row and
-- their invitation, but there is no account for them to sign in to, and until one exists they
-- cannot get in however correct the rest of it looks.
--
-- Rather than have the page guess, `admin_team()` now answers it from the only thing that can:
-- whether an account exists for that address. The page says "no account yet" and names the
-- command that opens one. Nobody is left believing an admin can sign in when they cannot.

-- A new column in the returned row, so the function is dropped and made again: Postgres will
-- not replace a set-returning function whose row type has changed. The grants below are part
-- of that, because dropping it takes them with it.
drop function if exists public.admin_team();

create function public.admin_team()
returns table (
  member_id uuid, user_id uuid, email text, full_name text, duty text, deputy boolean,
  status text, role public.user_role, phone_last4 text, has_phone boolean,
  has_account boolean, line_ready boolean, line_sent_at timestamptz,
  created_at timestamptz, approved_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, coalesce(m.email, lower(u.email)),
         case when m.full_name <> '' then m.full_name else coalesce(p.display_name, '') end,
         m.duty, m.deputy, m.status::text, p.role,
         right(c.phone, 4), c.phone is not null,
         -- Bound to an account already, or one exists for the address they were added with.
         m.user_id is not null
           or exists (select 1 from auth.users au where lower(au.email) = m.email),
         p.line_user_id is not null, m.line_sent_at, m.created_at, m.approved_at
    from public.admin_members m
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    left join public.admin_member_contacts c on c.member_id = m.id
   where public.can_manage_admins()
  union all
  -- An admin from before this page existed, or the super admins themselves: they signed in to
  -- get the role, so the account is not in question.
  select null, p.user_id, lower(u.email), p.display_name, '', false,
         'active', p.role, null, false,
         true, p.line_user_id is not null, null, p.created_at, null
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where public.can_manage_admins()
     and p.role in ('admin', 'super_admin')
     and not exists (select 1 from public.admin_members m where m.user_id = p.user_id)
$$;
revoke execute on function public.admin_team() from public, anon;
grant execute on function public.admin_team() to authenticated;
