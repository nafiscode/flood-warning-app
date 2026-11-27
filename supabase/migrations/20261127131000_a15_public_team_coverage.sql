-- The "Team coverage" switch on the main map, for everyone (owner, 27 Nov 2026).
--
-- `coverage_summary()` stays closed to verified teams and admins: it carries team counts, whether
-- a coordinator or a supplies team covers a tambon, and which tambons are the caller's own. This
-- is the public cut of the same fact: for each tambon, is it covered by at least one verified
-- team with the rescue capability - a yes or a no and nothing else. No count, no unit, no
-- organization, no capability beyond rescue, no phone, no person (safety rule 6: only aggregated
-- data on the public map). A unit that only runs a dam or a planning office holds no rescue
-- capability, so it never turns a tambon "covered" here (safety rule 5, `unit_is_office_only`).
--
-- "Not covered" means no team has registered yet. It never means nobody will come: an SOS reaches
-- the admins wherever it is sent from, and the app's copy says so (safety rules 1 and 10).

create or replace function public.public_team_coverage()
returns table (tambon text, province_code text, covered boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  select t.code,
         t.province_code,
         exists (
           select 1
             from public.authority_coverage ac
             join public.authority_units u on u.id = ac.unit_id
            where ac.tambon = t.code
              and u.status = 'verified'
              and 'rescue' = any (u.capabilities)
         )
    from public.tambons t
   order by t.code
$function$;

revoke execute on function public.public_team_coverage() from public;
grant execute on function public.public_team_coverage() to anon, authenticated;
