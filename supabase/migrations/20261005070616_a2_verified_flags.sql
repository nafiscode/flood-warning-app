-- A2: "verified" flags on phone numbers are set by the database, never by the client.
-- Before this, the owner of a row could write phone_verified / poc_phone_verified themselves,
-- and a registrant could mark their own contact phone as confirmed by a call.

-------------------------------------------------------------------------------
-- A personal phone is verified only when it is the number the person signed in with by OTP.
-------------------------------------------------------------------------------
create function public.set_profile_phone_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.phone_verified := new.phone is not null and exists (
    select 1 from auth.users u
    where u.id = new.user_id and u.phone_confirmed_at is not null
      and ltrim(u.phone, '+') = ltrim(new.phone, '+'));
  new.updated_at := now();
  return new;
end $$;
create trigger profile_contacts_verified before insert or update on public.profile_contacts
  for each row execute function public.set_profile_phone_verified();

revoke insert, update on public.profile_contacts from authenticated;
grant insert (user_id, phone), update (phone) on public.profile_contacts to authenticated;

-------------------------------------------------------------------------------
-- An authority's contact: created by register_authority_unit(); the registrant may correct
-- the name and phone while pending. Changing the phone clears both confirmations.
-------------------------------------------------------------------------------
create function public.reset_poc_phone_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.poc_phone is distinct from old.poc_phone then
    new.poc_phone_verified := exists (
      select 1
      from public.authority_units au
      join auth.users u on u.id = au.user_id
      where au.id = new.unit_id and u.phone_confirmed_at is not null
        and ltrim(u.phone, '+') = ltrim(new.poc_phone, '+'));
    new.poc_phone_verified_by_call := false;
  end if;
  return new;
end $$;
create trigger authority_unit_contacts_verified before update on public.authority_unit_contacts
  for each row execute function public.reset_poc_phone_verified();

revoke insert, update, delete on public.authority_unit_contacts from authenticated;
grant update (poc_name, poc_phone) on public.authority_unit_contacts to authenticated;

-------------------------------------------------------------------------------
-- When a phone is confirmed by OTP (first phone sign-in, or a changed number), it becomes the
-- person's contact phone; the trigger above then marks it verified.
-------------------------------------------------------------------------------
create function public.handle_user_phone_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is not null and new.phone <> '' and new.phone_confirmed_at is not null then
    insert into public.profile_contacts (user_id, phone) values (new.id, new.phone)
    on conflict (user_id) do update set phone = excluded.phone;
  end if;
  return new;
end $$;
create trigger on_auth_user_phone_confirmed after update of phone, phone_confirmed_at on auth.users
  for each row
  when (old.phone_confirmed_at is distinct from new.phone_confirmed_at or old.phone is distinct from new.phone)
  execute function public.handle_user_phone_confirmed();
