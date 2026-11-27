-- An unanswered SOS pulses on the public Live map (owner, 27 Nov 2026).
--
-- When a request for rescue has not been accepted by any team, everyone looking at the map can
-- see that the area needs help and that no team is on it, so a person with a boat, a neighbour or
-- a team outside Jaga can act. This is the PUBLIC cut, and so it is aggregated (safety rule 6):
--
--   * one row per tambon: its name, how many open rescue requests nobody holds, and how long the
--     oldest has waited, rounded down to ten minutes;
--   * no point, no accuracy, no phone, no sender, no text, no photo, no case id. The exact place
--     and the number reach only teams and admins, by the reads safety rule 5 allows.
--
-- Which cases count: open (`received`, so not rescued, cancelled or dismissed), a rescue and not
-- a request for supplies, not merged into another case, no unit holding it, not flagged as a
-- suspected nuisance send an admin has not cleared (a bot must not be able to light the map), and
-- the sender heard from within 72 hours (a case past that is in the war room's fold, see
-- 20261127130000_a6_clear_stale_sos). A case is shown from the second it arrives: the signal says
-- "no team yet", never "nobody will come" (safety rules 1 and 10).

create or replace function public.public_unanswered_sos()
returns table (
  tambon text, province_code text, name_th text, name_en text, district_th text,
  province_th text, cases integer, waiting_minutes integer
)
language sql stable security definer set search_path = '' as $$
  select s.tambon, t.province_code, t.name_th, t.name_en, d.name_th, pv.name_th,
         count(*)::integer,
         (floor(extract(epoch from (now() - min(s.created_at))) / 600) * 10)::integer
    from public.sos_requests s
    join public.tambons t on t.code = s.tambon
    left join public.districts d on d.code = t.district_code
    left join public.provinces pv on pv.code = t.province_code
   where s.status = 'received'
     and s.closed_at is null
     and s.kind = 'rescue'
     and s.duplicate_of is null
     and not exists (select 1 from public.sos_claims c
                     where c.sos_id = s.id and c.released_at is null)
     and not exists (select 1 from public.sos_review r
                     where r.sos_id = s.id and r.suspected_spam and r.spam_dismissed_at is null)
     and public.sos_last_heard(s.id) > now() - make_interval(hours => public.sos_stale_hours())
   group by s.tambon, t.province_code, t.name_th, t.name_en, d.name_th, pv.name_th
   order by min(s.created_at)
$$;

revoke execute on function public.public_unanswered_sos() from public;
grant execute on function public.public_unanswered_sos() to anon, authenticated;
