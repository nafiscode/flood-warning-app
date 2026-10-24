-- Where does an approved team's person go on their next visit? (owner, 24 Oct 2026)
--
-- The home and map pages show a registered, approved team a highlighted way back into its board.
-- The page needs one answer about the signed-in person and nothing else:
--   'board'  they run a verified team (its owner, or a dispatcher): the case board and war room;
--   'mine'   they are only crew on a verified team: the cases handed to them;
--   null     neither (a visitor, a resident, a registration still waiting, a suspended team).
-- It names no team and no person, so nothing personal reaches a page that is drawn for anyone.

create function public.my_team_entry() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.authority_units u
                  where u.status = 'verified'
                    and public.unit_access(u.id, (select auth.uid()))) then 'board'
    when exists (select 1 from public.authority_unit_members m
                   join public.authority_units u on u.id = m.unit_id and u.status = 'verified'
                  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'field')
      then 'mine'
  end
$$;
revoke execute on function public.my_team_entry() from public, anon;
grant execute on function public.my_team_entry() to authenticated;
