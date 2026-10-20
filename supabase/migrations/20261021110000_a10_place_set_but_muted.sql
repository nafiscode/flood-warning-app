-- A10 fix: having turned notifications off for a place is a choice, not an absence of one.
--
-- `users_without_a_place()` (21 Oct) asked for nobody with a *notifying* saved place. That put
-- somebody who saved a place and deliberately muted it into the same set as somebody who never
-- chose anywhere - so muting a watched place quietly signed them up to every alert in all four
-- provinces, the opposite of what they asked for. The existing LINE test caught it.
--
-- The set is now exactly what it says: no home, and no saved place at all. Whoever saved one
-- and muted it keeps their silence.
create or replace function public.users_without_a_place() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id
    from public.profiles p
   where p.home_tambon is null
     and not exists (select 1 from public.saved_places sp where sp.user_id = p.user_id)
$$;
