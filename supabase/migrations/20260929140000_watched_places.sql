-- Watched places: watching places for others (spec 4.9, decisions 29 Sep 2026).
-- Many people at risk are elderly without smartphones; their relatives watch their place,
-- call them from an alert, can send an SOS for them, and can register their household.

-------------------------------------------------------------------------------
-- Tambons are always derived from the location in the database, never taken from the client:
-- the tambon decides which authorities can see an SOS, report or household.
-------------------------------------------------------------------------------
create function public.set_tambon_from_point() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    new.home_tambon := case when new.home_point is null then null
                            else public.tambon_for_point(new.home_point) end;
  else
    new.tambon := public.tambon_for_point(new.point);
  end if;
  return new;
end $$;

create trigger saved_places_tambon before insert or update of point, tambon on public.saved_places
  for each row execute function public.set_tambon_from_point();
create trigger households_tambon before insert or update of point, tambon on public.households
  for each row execute function public.set_tambon_from_point();
create trigger reports_tambon before insert or update of point, tambon on public.reports
  for each row execute function public.set_tambon_from_point();
create trigger sos_requests_tambon before insert or update of point, tambon on public.sos_requests
  for each row execute function public.set_tambon_from_point();
create trigger safe_places_tambon before insert or update of point, tambon on public.safe_places
  for each row execute function public.set_tambon_from_point();
create trigger profiles_home_tambon before insert or update of home_point, home_tambon on public.profiles
  for each row execute function public.set_tambon_from_point();

-------------------------------------------------------------------------------
-- Watched places: up to 10, a notifications switch, and the person there (private to the user)
-------------------------------------------------------------------------------
alter table public.saved_places
  add column notify boolean not null default true,
  add column contact_name text check (char_length(contact_name) <= 80),
  add column contact_phone text check (contact_phone ~ '^\+?[0-9]{8,15}$'),
  -- the user confirms the person agreed to their phone being stored here (PDPA)
  add column contact_consent_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint saved_places_contact_consent
    check (contact_phone is null or contact_consent_at is not null);
comment on table public.saved_places is
  'Watched places (spec 4.9): up to 10 per user. Owner-only, including the stored person''s phone.';

create or replace function public.enforce_saved_place_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.saved_places where user_id = new.user_id) >= 10 then
    raise exception 'A user can watch at most 10 places' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------
-- Households: one for the user's home, and one per watched place (e.g. a bedridden mother)
-------------------------------------------------------------------------------
alter table public.households drop constraint households_owner_id_key;
alter table public.households
  add column saved_place_id uuid references public.saved_places (id) on delete cascade,
  add column on_behalf_of_other boolean not null default false,
  add constraint households_on_behalf_needs_place
    check (not on_behalf_of_other or saved_place_id is not null);
create unique index households_one_home_idx on public.households (owner_id) where saved_place_id is null;
create unique index households_one_per_place_idx on public.households (saved_place_id)
  where saved_place_id is not null;

-- A household at a watched place must be at one of the owner's own places.
create policy "households: only at own watched places" on public.households as restrictive
  for all to authenticated
  using (true)
  with check (saved_place_id is null or exists (
    select 1 from public.saved_places sp
    where sp.id = saved_place_id and sp.user_id = (select auth.uid())));

-------------------------------------------------------------------------------
-- SOS sent by a relative for someone at a watched place
-------------------------------------------------------------------------------
alter table public.sos_requests
  add column on_behalf boolean not null default false,
  add column on_behalf_note text check (char_length(on_behalf_note) <= 200);

-- contact_phone: who to call back (the sender); on_site_phone: the person at the location.
alter table public.sos_contacts alter column contact_phone drop not null;
alter table public.sos_contacts
  add column on_site_phone text check (on_site_phone ~ '^\+?[0-9]{8,15}$'),
  add constraint sos_contacts_some_phone check (contact_phone is not null or on_site_phone is not null);

-- Both phones for an SOS, for covering verified authorities and admins; every call is logged.
create function public.reveal_sos_contacts(p_sos_id uuid)
returns table (contact_phone text, on_site_phone text)
language plpgsql security definer set search_path = '' as $$
declare
  t text;
begin
  select tambon into t from public.sos_requests where id = p_sos_id;
  if not found then return; end if;
  if not (public.is_admin() or public.covers_tambon(t)) then
    raise exception 'Not allowed to see these phone numbers' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('both', true));
  return query select c.contact_phone, c.on_site_phone from public.sos_contacts c where c.sos_id = p_sos_id;
end $$;
revoke execute on function public.reveal_sos_contacts(uuid) from public, anon;
grant execute on function public.reveal_sos_contacts(uuid) to authenticated;

-------------------------------------------------------------------------------
-- Who gets an alert: users whose home or any watched place (notifications on) is in its area.
-- One row per user, listing the affected places with the user's own labels (spec 4.8, 4.9).
-- For the notification sender only (service role), never for clients.
-------------------------------------------------------------------------------
create function public.alert_recipients(p_alert_id uuid)
returns table (user_id uuid, home_affected boolean, places jsonb)
language sql stable security definer set search_path = '' as $$
  with area as (select tambon from public.alert_tambons where alert_id = p_alert_id),
  homes as (
    select p.user_id from public.profiles p where p.home_tambon in (select tambon from area)
  ),
  watched as (
    select sp.user_id,
           jsonb_agg(jsonb_build_object('id', sp.id, 'label', sp.label, 'tambon', sp.tambon)
                     order by sp.label) as places
    from public.saved_places sp
    where sp.notify and sp.tambon in (select tambon from area)
    group by sp.user_id
  )
  select coalesce(h.user_id, w.user_id), h.user_id is not null, coalesce(w.places, '[]'::jsonb)
  from homes h full join watched w on w.user_id = h.user_id
$$;
revoke execute on function public.alert_recipients(uuid) from public, anon, authenticated;
