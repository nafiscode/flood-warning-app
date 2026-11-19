-- A pending unit's POC phone was readable again: the target-verified clause had been lost.
--
-- 20261015135100_a10_security_fixes closed this on 15 Oct 2026, under the heading "Another unit's
-- POC phone: only a verified unit's". Its gate had two halves - the TARGET unit must be verified,
-- and the CALLER must be a verified unit sharing coverage with it.
--
-- 20261109120100_a12_dam_operator rewrote the function whole to add the dam-only exclusion and kept
-- only the caller's half; 20261110180000_a19_planning_not_a_field_team rewrote it again, swapping
-- unit_is_dam_only for unit_is_office_only, and carried the loss forward. So from 9 Nov a verified
-- rescue unit could reveal the POC phone of a unit that had merely registered and was still waiting
-- to be verified, anywhere their chosen coverage overlapped - a personal number belonging to someone
-- nobody had checked yet. The reveal was logged and the caller had to be a verified team, so this
-- was narrow, not public; it was still a reveal that the security pass had deliberately closed.
--
-- Caught 19 Nov 2026 by tests/rls/security-a10.test.ts, "is never shown for a unit still waiting
-- for verification", which had been failing since 9 Nov.
--
-- The body below is A19's word for word with that one clause put back. Coverage a unit claims at
-- registration is not evidence of anything until an admin verifies it (safety rule 5).
create or replace function public.reveal_poc_phone(p_unit_id uuid)
returns table (poc_name text, poc_phone text)
language plpgsql security definer set search_path = '' as $fn$
begin
  if not (public.is_admin() or (
      exists (select 1 from public.authority_units target
               where target.id = p_unit_id and target.status = 'verified')
      and exists (
        select 1
        from public.authority_coverage theirs
        join public.authority_coverage mine on mine.tambon = theirs.tambon
        join public.authority_units u on u.id = mine.unit_id
        where theirs.unit_id = p_unit_id
          and u.user_id = (select auth.uid())
          and u.status = 'verified'
          and not public.unit_is_office_only(u.capabilities)))) then
    raise exception 'Not allowed to see this contact' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'authority_units', p_unit_id::text);
  return query select c.poc_name, c.poc_phone
    from public.authority_unit_contacts c where c.unit_id = p_unit_id;
end $fn$;
