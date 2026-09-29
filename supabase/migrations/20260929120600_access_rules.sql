-- A1 (7/8): who can see and change what (spec section 9, safety rules 5 and 6).
-- RLS is enabled on every table. Helpers are SECURITY DEFINER so policies can check roles without
-- recursing into the profiles policies; they only ever look at the caller's own rows.

-------------------------------------------------------------------------------
-- New users get a profile (role 'user'). A phone from OTP sign-in is stored as verified.
-------------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''));
  if new.phone is not null and new.phone <> '' then
    insert into public.profile_contacts (user_id, phone, phone_verified)
    values (new.id, new.phone, new.phone_confirmed_at is not null);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- Role helpers (about the caller only)
-------------------------------------------------------------------------------
create function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin', 'super_admin') from public.profiles
                   where user_id = (select auth.uid())), false)
$$;

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'super_admin' from public.profiles
                   where user_id = (select auth.uid())), false)
$$;

create function public.is_verified_authority() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.authority_units
                 where user_id = (select auth.uid()) and status = 'verified')
$$;

-- Does one of the caller's verified units cover this tambon (optionally with a capability)?
create function public.covers_tambon(
  p_tambon text, p_capabilities public.authority_capability[] default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where u.user_id = (select auth.uid())
      and u.status = 'verified'
      and c.tambon = p_tambon
      and (p_capabilities is null or u.capabilities && p_capabilities)
  )
$$;

-- Does this unit's coverage include the tambon? (spec A1 helper)
create function public.unit_covers(p_unit_id uuid, p_tambon text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.authority_coverage
                 where unit_id = p_unit_id and tambon = p_tambon)
$$;

-------------------------------------------------------------------------------
-- Role and status can't be changed by the client (only through definer functions in A2).
-------------------------------------------------------------------------------
create function public.guard_profile_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and (select auth.uid()) is not null then
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
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

create function public.guard_authority_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.status is distinct from old.status
      or new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at)
     and (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an admin can verify or suspend an authority' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger authority_units_guard_status before update on public.authority_units
  for each row execute function public.guard_authority_status();

-------------------------------------------------------------------------------
-- Table privileges. Visitors (anon) never write directly: SOS goes through the submit function (A5).
-- Column-level UPDATE grants keep role, status and verification columns out of clients' reach.
-------------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

revoke update on public.profiles from authenticated;
grant update (display_name, preferred_locale, home_point, home_tambon, consents, line_user_id)
  on public.profiles to authenticated;

revoke update on public.authority_units from authenticated;
grant update (unit_name, capabilities) on public.authority_units to authenticated;

-------------------------------------------------------------------------------
-- Enable RLS everywhere
-------------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Public reference data: everyone reads, admins write
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hazards', 'provinces', 'districts', 'tambons', 'warning_zones',
    'warning_zone_tambons', 'stations', 'observations', 'forecasts', 'thresholds',
    'alerts', 'alert_tambons'] loop
    execute format('create policy "%1$s: everyone reads" on public.%1$I for select to anon, authenticated using (true)', t);
    execute format('create policy "%1$s: admins insert" on public.%1$I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "%1$s: admins update" on public.%1$I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "%1$s: admins delete" on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Only humans publish alerts, and the issuer is always the signed-in admin (safety rules 2, 3).
drop policy "alerts: admins insert" on public.alerts;
create policy "alerts: admins publish as themselves" on public.alerts for insert to authenticated
  with check (public.is_admin() and issued_by = (select auth.uid()));

-------------------------------------------------------------------------------
-- Profiles and personal data: own rows only (admins see profiles; phones only via logged functions)
-------------------------------------------------------------------------------
create policy "profiles: own or admin reads" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "profiles: own updates" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "profile_contacts: own" on public.profile_contacts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "saved_places: own" on public.saved_places for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "households: own" on public.households for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "push_subscriptions: own" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-------------------------------------------------------------------------------
-- Organizations and authority units
-------------------------------------------------------------------------------
-- Visitors and users see an organization only if it opted in to a public contact (decision e).
create policy "organizations: public if opted in" on public.organizations for select to anon, authenticated
  using (public_contact_opt_in
         or created_by = (select auth.uid())
         or public.is_verified_authority()
         or public.is_admin());
create policy "organizations: registering user creates" on public.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "organizations: admins update" on public.organizations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Units (no phones here): own unit; the responsibility map for verified authorities; admins.
create policy "authority_units: own, verified authorities, admins read" on public.authority_units
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_verified_authority() or public.is_admin());
create policy "authority_units: register own as pending" on public.authority_units for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending'
              and verified_by is null and verified_at is null);
create policy "authority_units: edit own while pending" on public.authority_units for update to authenticated
  using ((user_id = (select auth.uid()) and status = 'pending') or public.is_admin())
  with check ((user_id = (select auth.uid()) and status = 'pending') or public.is_admin());

create policy "authority_unit_contacts: own unit" on public.authority_unit_contacts for all to authenticated
  using (exists (select 1 from public.authority_units u
                 where u.id = unit_id and u.user_id = (select auth.uid())))
  with check (exists (select 1 from public.authority_units u
                      where u.id = unit_id and u.user_id = (select auth.uid()) and u.status = 'pending'));

create policy "authority_coverage: own, verified authorities, admins read" on public.authority_coverage
  for select to authenticated
  using (public.is_verified_authority() or public.is_admin()
         or exists (select 1 from public.authority_units u
                    where u.id = unit_id and u.user_id = (select auth.uid())));
-- Coverage decides who sees personal data, so it can only change while the unit is pending.
create policy "authority_coverage: own unit while pending" on public.authority_coverage
  for insert to authenticated
  with check (public.is_admin() or exists (
    select 1 from public.authority_units u
    where u.id = unit_id and u.user_id = (select auth.uid()) and u.status = 'pending'));
create policy "authority_coverage: remove own while pending" on public.authority_coverage
  for delete to authenticated
  using (public.is_admin() or exists (
    select 1 from public.authority_units u
    where u.id = unit_id and u.user_id = (select auth.uid()) and u.status = 'pending'));

-------------------------------------------------------------------------------
-- Safe places and reports
-------------------------------------------------------------------------------
create policy "safe_places: everyone reads unless rejected" on public.safe_places for select to anon, authenticated
  using (verification_status <> 'rejected' or public.is_admin());
create policy "safe_places: admins insert" on public.safe_places for insert to authenticated
  with check (public.is_admin());
create policy "safe_places: admins update" on public.safe_places for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "safe_places: admins delete" on public.safe_places for delete to authenticated
  using (public.is_admin());

-- Exact report locations: reporter, verified authorities covering the tambon, admins (safety rule 6).
create policy "reports: own, covering authority, admin read" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.covers_tambon(tambon) or public.is_admin());
create policy "reports: users submit their own" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and moderation_status = 'pending');
create policy "reports: admins moderate" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "reports: own or admin delete" on public.reports for delete to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());

-------------------------------------------------------------------------------
-- SOS (no direct insert: the A5 submit function creates cases and never rejects one)
-------------------------------------------------------------------------------
create policy "sos_requests: requester, covering authority, admin read" on public.sos_requests
  for select to authenticated
  using (requester_id = (select auth.uid()) or public.covers_tambon(tambon) or public.is_admin());
create policy "sos_requests: admins update" on public.sos_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The phone: only the requester directly; everyone else via reveal_sos_phone() (logged).
create policy "sos_contacts: requester reads own" on public.sos_contacts for select to authenticated
  using (exists (select 1 from public.sos_requests s
                 where s.id = sos_id and s.requester_id = (select auth.uid())));

-- The spam flag: never the requester (spec 9).
create policy "sos_review: covering authority and admin read" on public.sos_review for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.sos_requests s where s.id = sos_id and public.covers_tambon(s.tambon)));
create policy "sos_review: admins update" on public.sos_review for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Child tables follow the visibility of their SOS (the subquery runs under the caller's RLS).
create policy "sos_locations: follow the SOS" on public.sos_locations for select to authenticated
  using (exists (select 1 from public.sos_requests s where s.id = sos_id));
create policy "sos_events: follow the SOS" on public.sos_events for select to authenticated
  using (exists (select 1 from public.sos_requests s where s.id = sos_id));
create policy "rescue_confirmations: follow the SOS" on public.rescue_confirmations for select to authenticated
  using (exists (select 1 from public.sos_requests s where s.id = sos_id));
create policy "sos_claims: follow the SOS" on public.sos_claims for select to authenticated
  using (exists (select 1 from public.sos_requests s where s.id = sos_id));

-- A verified unit may claim an SOS in its own coverage; one active claim per SOS (unique index).
create policy "sos_claims: verified unit claims in coverage" on public.sos_claims for insert to authenticated
  with check (
    exists (select 1 from public.authority_units u
            where u.id = unit_id and u.user_id = (select auth.uid()) and u.status = 'verified')
    and exists (select 1 from public.sos_requests s
                where s.id = sos_id and public.unit_covers(unit_id, s.tambon)));
create policy "sos_claims: own unit releases" on public.sos_claims for update to authenticated
  using (public.is_admin() or exists (select 1 from public.authority_units u
                                      where u.id = unit_id and u.user_id = (select auth.uid())))
  with check (public.is_admin() or exists (select 1 from public.authority_units u
                                           where u.id = unit_id and u.user_id = (select auth.uid())));

create policy "hero_points: verified authorities and admins read" on public.hero_points for select to authenticated
  using (public.is_verified_authority() or public.is_admin());
create policy "hero_points: admins write" on public.hero_points for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-------------------------------------------------------------------------------
-- Admin-only tables
-------------------------------------------------------------------------------
create policy "alert_deliveries: admins" on public.alert_deliveries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "line_quota_usage: admins" on public.line_quota_usage for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "handover_notes: admins read" on public.handover_notes for select to authenticated
  using (public.is_admin());
create policy "handover_notes: admins write as themselves" on public.handover_notes for insert to authenticated
  with check (public.is_admin() and author_id = (select auth.uid()));
create policy "audit_log: admins read" on public.audit_log for select to authenticated
  using (public.is_admin());
create policy "admin_invitations: admins read" on public.admin_invitations for select to authenticated
  using (public.is_admin());
create policy "admin_invitations: super admin manages" on public.admin_invitations for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin() and invited_by = (select auth.uid()));
