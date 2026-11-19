-- A team's dispatchers had lost every read the team has: unit_access() had been dropped again.
--
-- 20261024090000_t1_unit_members put the 24 Oct 2026 decision into the three gates - a verified
-- team's people count as the team, so the owner and its ACTIVE DISPATCHERS read what the team may
-- read - by replacing `u.user_id = auth.uid()` with `public.unit_access(u.id, auth.uid())` in
-- is_verified_authority(), covers_tambon() and my_unit_for_sos().
--
-- 20261109120100_a12_dam_operator rewrote all three from their pre-24-October bodies to add the
-- dam-only exclusion, and 20261110180000_a19_planning_not_a_field_team rewrote them again for the
-- office-only one. Both kept `u.user_id = auth.uid()`, so from the day A12 went on (10 Nov) only
-- the account that registered a unit could act for it: a dispatcher asking for the case board got
-- 'Verified authorities only', a case they were sent was 'not in your coverage', and a requester's
-- phone would not open for them. During a flood that is a team's people locked out of the board
-- while the owner's phone is the only way in.
--
-- The bodies below are A19's word for word with unit_access() put back, so the office-only and
-- dam-only lockdowns stay exactly as they are. unit_access() grants the owner and members whose
-- row is `status = 'active'` and `role in ('owner','dispatcher')`: a FIELD member is still not the
-- team here - they read only the point and phone of a case assigned to them, through their own
-- path, and never vulnerable-household data (safety rule 5).
--
-- reveal_poc_phone() is deliberately NOT widened: 20261024090000 did not make it member-aware, so
-- another unit's POC phone stays with the registering account, which is the narrower reading.
--
-- Caught 19 Nov 2026 by tests/rls/unit-members.test.ts (three cases under "an approved
-- dispatcher" and "the door closes"), failing since 10 Nov.

create or replace function public.covers_tambon(
  p_tambon text, p_capabilities public.authority_capability[] default null
) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where public.unit_access(u.id, (select auth.uid()))
      and u.status = 'verified'
      and c.tambon = p_tambon
      and (p_capabilities is null or u.capabilities && p_capabilities)
      -- A19: an office's coverage is not a team's coverage (was unit_is_dam_only, A12 part 2).
      and not public.unit_is_office_only(u.capabilities)
  )
$fn$;

create or replace function public.my_unit_for_sos(p_sos_id uuid) returns uuid
language sql stable security definer set search_path = '' as $fn$
  select u.id
    from public.authority_units u
    join public.authority_coverage ac on ac.unit_id = u.id
    join public.sos_requests s on s.id = p_sos_id and s.tambon = ac.tambon
   where public.unit_access(u.id, (select auth.uid()))
     and u.status = 'verified'
     and not public.unit_is_office_only(u.capabilities)
   order by (u.id = (select d.dispatch_unit from public.sos_offer_now(p_sos_id) d)) desc nulls last,
            u.on_duty desc, u.created_at
   limit 1
$fn$;

create or replace function public.is_verified_authority() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.authority_units
                 where public.unit_access(id, (select auth.uid())) and status = 'verified'
                   and not public.unit_is_office_only(capabilities))
$fn$;
