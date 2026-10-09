-- A display name is required (spec section 3). The form asks for one and the save action
-- refuses an empty one, but until now the database would have taken it from anything else that
-- can write the column, and a name of nothing but spaces counted as a name.
--
-- The column cannot simply be "not empty": a profile is created the moment someone signs in,
-- before they have been asked anything, and it legitimately starts empty (the trigger in
-- 20260929120600_access_rules.sql fills in whatever LINE gave us, which may be nothing). So the
-- rule is about *changing* it: the name is trimmed, and it may never be set to nothing once it
-- has been given. Only sign-in itself may leave it empty.

create function public.guard_display_name() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.display_name := btrim(coalesce(new.display_name, ''));
  if new.display_name = '' and btrim(coalesce(old.display_name, '')) <> '' then
    raise exception 'A display name is required' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger profiles_display_name_required
  before update of display_name on public.profiles
  for each row execute function public.guard_display_name();

-- Names already stored with spaces around them are tidied once, so the rule starts from a
-- clean slate.
update public.profiles
   set display_name = btrim(display_name)
 where display_name <> btrim(display_name);
