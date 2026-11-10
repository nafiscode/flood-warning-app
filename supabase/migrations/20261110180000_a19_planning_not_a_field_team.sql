-- A19, step 0: a planning office is not a team in the field (CLAUDE.md safety rule 5).
--
-- A19 (docs/prompts.md) asks, before anything else is built: "Check and state in the spec that
-- `planning` alone opens no SOS, no household data and no phone reveal (safety rule 5); if it
-- does today, close that first." It does today. This closes it.
--
-- What is open. Every verified unit picks a coverage area when it registers, and `covers_tambon()`
-- - with no capability named - is the gate in front of the sensitive reads across the whole app:
-- the exact location and phone of a request for help, residents' reports and their media, the
-- safe-place rounds. `is_verified_authority()` is the gate in front of the case board, the
-- household figures, the village layer, the field rescues and the supply board. Neither asks what
-- the unit is for. That is right for a rescue team, which is who they were written for.
--
-- A19 invites a provincial highway office (แขวงทางหลวง) or an irrigation project office
-- (โครงการชลประทาน) to register with the `planning` capability and PROVINCE-WIDE coverage, so that
-- it can be shown which stretches of its own roads to look at. Verified today, such an office
-- would have read every resident's exact address and telephone number in four provinces. Nobody
-- asked for that and nobody would want it: an engineer deciding where a culvert goes has no reason
-- to know who called for a boat last night.
--
-- The fix is the one the dam operator already uses (20261109120100, section 11), widened by one
-- capability. `unit_is_dam_only(caps)` tested caps <@ {dam}; `unit_is_office_only(caps)` tests
-- caps <@ {dam, planning}. Both mean the same thing - an organisation that works at a desk or at a
-- structure, not a crew that goes to a house - and the four gates switch to the wider test.
--
--   * A unit that is planning AND rescue (or coordination, or supplies, or support) keeps
--     everything a team has. The test is "an office and nothing else", never "planning at all".
--     A provincial irrigation office that also runs boats is a rescue team, as it was yesterday.
--   * `unit_is_dam_only()` stays exactly as it is, and still means what it says. The dam LINK
--     (`dam_operator_unit`, `admin_link_dam_operator`) asks about the `dam` capability and must
--     not start accepting a planning office; only the four gates below change.
--   * Nothing here grants anything. A19's own migration does that, and it names `planning`
--     explicitly rather than leaning on coverage.
--
-- Known limit, carried over word for word from 20261109120100: an account that holds BOTH an
-- office-only unit AND a rescue unit is a verified authority through the second, and the case
-- board takes the union of that account's units' coverage, so the office unit's tambons widen
-- their board. The residual is the union of two areas the same person already answers for.

-------------------------------------------------------------------------------
-- 1. An office, and nothing else.
-------------------------------------------------------------------------------
-- An office's capabilities are operating a dam and planning: a unit that holds neither of the
-- other four is not a crew. Written as a test on the LABELS rather than as the array literal
-- `<@ array['dam', 'planning']::public.authority_capability[]`, which would read better, for one
-- reason worth the ugliness: Postgres refuses a newly added enum value in the transaction that
-- added it, and 'dam' arrives in 20261109120000. The literal form therefore could not be run -
-- and so could not be tested - in one transaction with the migration it depends on.
create function public.unit_is_office_only(p_caps public.authority_capability[]) returns boolean
language sql stable set search_path = '' as $fn$
  select not exists (
    select 1 from unnest(coalesce(p_caps, '{}'::public.authority_capability[])) c
     where c::text not in ('dam', 'planning'))
$fn$;
grant execute on function public.unit_is_office_only(public.authority_capability[])
  to anon, authenticated;

comment on function public.unit_is_office_only(public.authority_capability[]) is
  'True when a unit holds no capability except operating a dam or planning, so it is not a team in '
  'the field and its coverage grants it none of a team''s reads (safety rule 5). A19, 10 Nov 2026.';

-------------------------------------------------------------------------------
-- 2. The four gates. Bodies identical to 20261109120100 but for the one call.
-------------------------------------------------------------------------------
create or replace function public.covers_tambon(
  p_tambon text, p_capabilities public.authority_capability[] default null
) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1
    from public.authority_coverage c
    join public.authority_units u on u.id = c.unit_id
    where u.user_id = (select auth.uid())
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
   where u.user_id = (select auth.uid())
     and u.status = 'verified'
     and not public.unit_is_office_only(u.capabilities)
   order by (u.id = (select d.dispatch_unit from public.sos_offer_now(p_sos_id) d)) desc nulls last,
            u.on_duty desc, u.created_at
   limit 1
$fn$;
revoke execute on function public.my_unit_for_sos(uuid) from public, anon, authenticated;

-- Another unit's point-of-contact phone. An office reaches a rescue team the way the public does.
create or replace function public.reveal_poc_phone(p_unit_id uuid)
returns table (poc_name text, poc_phone text)
language plpgsql security definer set search_path = '' as $fn$
begin
  if not (public.is_admin() or exists (
      select 1
      from public.authority_coverage theirs
      join public.authority_coverage mine on mine.tambon = theirs.tambon
      join public.authority_units u on u.id = mine.unit_id
      where theirs.unit_id = p_unit_id
        and u.user_id = (select auth.uid())
        and u.status = 'verified'
        and not public.unit_is_office_only(u.capabilities))) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone
    from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $fn$;

-- The case board, residents' reports, the household figures, the village layer, the safe-place
-- rounds, the field rescues, the supply board: about twenty places, all of which mean "a team in
-- the field". An office is not one, and is turned away from every one of them untouched.
create or replace function public.is_verified_authority() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.authority_units
                 where user_id = (select auth.uid()) and status = 'verified'
                   and not public.unit_is_office_only(capabilities))
$fn$;

-------------------------------------------------------------------------------
-- 3. A drill addressed to every unit still reaches every unit.
--
-- Not part of A19's list, but a loose end the change above would otherwise leave, and the dam
-- operator already left it on 9 November: `drill_audience_users()` (20261020220000) picks the
-- people to notify with its own query - every verified unit covering the chosen tambons - while
-- `drill_visible()` decides who may READ the drill, and for the audience 'units' it asked
-- `is_verified_authority()`. Since an office is no longer one, an office would be sent a
-- notification about a drill and then find it could not open it. That is the worst of both.
--
-- 'units' in a drill means what it says: every unit Jaga has checked, office or crew. So this
-- asks that question directly instead of asking the field-team gate. 'rescue' is untouched and
-- still means the capability. Nothing else a drill can carry changes.
-------------------------------------------------------------------------------
create or replace function public.drill_visible(p_audience text[]) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select 'everyone' = any (p_audience)
      or ('admins' = any (p_audience) and public.is_admin())
      or ('units' = any (p_audience) and exists (
            select 1 from public.authority_units u
             where u.user_id = (select auth.uid()) and u.status = 'verified'))
      or ('rescue' = any (p_audience) and exists (
            select 1 from public.authority_units u
             where u.user_id = (select auth.uid()) and u.status = 'verified'
               and u.capabilities && array['rescue']::public.authority_capability[]))
$fn$;
