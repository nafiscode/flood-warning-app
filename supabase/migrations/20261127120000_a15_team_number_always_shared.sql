-- A team's number is always shown to the person it is rescuing (owner, 27 Nov 2026).
--
-- Spec 5.3 let each team untick "When you accept an SOS, the person you are rescuing can see this
-- number". Two of the twelve verified teams had it off, and nine SOS in five days reached nobody
-- who could be called back from either side. The owner chose to switch it on for every team and
-- lock it: a team can no longer turn it off, and a new team starts with it on.
--
-- The column stays (reveal_responder_phone still reads it, and an off value would still be
-- honoured there), but nothing can store false any more:
--   1. every row is set to true now;
--   2. a trigger forces true on every insert and update, so not even a pending unit editing its
--      own row can turn it off;
--   3. authority_set_phone_sharing() keeps its signature and its checks (so an old tab does not
--      break) and ignores the answer: it sets true and says so.
-- Every reveal of the number is still written to audit_log by the same functions as before.

update public.authority_units set poc_phone_to_requester = true where not poc_phone_to_requester;

create function public.authority_units_force_poc_phone() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.poc_phone_to_requester := true;
  return new;
end $$;

create trigger authority_units_force_poc_phone
  before insert or update on public.authority_units
  for each row execute function public.authority_units_force_poc_phone();

create or replace function public.authority_set_phone_sharing(p_unit_id uuid, p_share boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- Same check as before (the unit's owner, verified). The answer asked for is ignored.
  update public.authority_units u set poc_phone_to_requester = true, updated_at = now()
   where u.id = p_unit_id and public.unit_access(u.id, (select auth.uid()), '{owner}') and u.status = 'verified';
  if not found then
    raise exception 'Not your unit' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('set_phone_sharing', 'authority_units', p_unit_id::text,
                            jsonb_build_object('share', true, 'asked', p_share));
  return true;
end $$;
