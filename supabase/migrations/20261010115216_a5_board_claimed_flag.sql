-- A5 fix: the board said "null" where it meant "no".
--
-- `cl.unit_id in (select id from mine)` is null, not false, when a case has no claim yet, because
-- null is not "not in" a set - it is unknown. So an unclaimed case came back with claimed_is_mine
-- = null. The browser coerced it to false and behaved, which is exactly why this kind of thing
-- survives: the only way it showed was a test asking the database what it actually said.
--
-- Both flags are wrapped in coalesce() here. The rest of the function is unchanged from
-- 20261010112654_a5_dispatch.sql (that migration is applied, so it is not edited).

create or replace function public.authority_board(p_hours integer default 72)
returns table (
  sos_id uuid, created_at timestamptz, status public.sos_status, hazard public.hazard_type,
  lat double precision, lon double precision, accuracy_m real, location_text text,
  tambon text, tambon_name_th text, tambon_name_en text,
  people_count smallint, vulnerable_flags jsonb, depth_ref public.depth_ref, injuries text,
  text_note text, photos text[], voice_url text, priority_score real, has_phone boolean,
  suspected_spam boolean, waiting_minutes integer,
  claimed_by uuid, claimed_by_name text, claimed_is_mine boolean,
  eta_band public.eta_band, eta_given_at timestamptz,
  offered_to uuid, offered_is_mine boolean, offer_expires_at timestamptz, offer_exhausted boolean,
  my_response public.offer_response
)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if not public.is_verified_authority() then
    raise exception 'Verified authorities only' using errcode = 'insufficient_privilege';
  end if;
  return query
  with mine as (
    select u.id from public.authority_units u
     where u.user_id = uid and u.status = 'verified'
  ),
  covered as (
    select distinct ac.tambon from public.authority_coverage ac
     where ac.unit_id in (select id from mine)
  )
  select s.id, s.created_at, s.status, s.hazard_type,
         extensions.st_y(s.point)::double precision,
         extensions.st_x(s.point)::double precision,
         s.location_accuracy_m, s.location_text,
         s.tambon, t.name_th, t.name_en,
         s.people_count, s.vulnerable_flags, s.depth_ref, s.injuries,
         s.text, s.photos, s.voice_url, s.priority_score,
         exists (select 1 from public.sos_contacts sc where sc.sos_id = s.id),
         coalesce(rv.suspected_spam, false),
         (extract(epoch from (now() - s.created_at)) / 60)::integer,
         cl.unit_id, cu.unit_name,
         coalesce(cl.unit_id in (select id from mine), false),
         cl.eta_band, cl.eta_given_at,
         d.dispatch_unit, coalesce(d.dispatch_unit in (select id from mine), false),
         d.expires_at, coalesce(d.exhausted, false),
         (select o.response from public.sos_offers o
           where o.sos_id = s.id and o.unit_id in (select id from mine)
           order by o.round desc limit 1)
    from public.sos_requests s
    join covered c on c.tambon = s.tambon
    left join public.tambons t on t.code = s.tambon
    left join public.sos_review rv on rv.sos_id = s.id
    left join public.sos_claims cl on cl.sos_id = s.id and cl.released_at is null
    left join public.authority_units cu on cu.id = cl.unit_id
    left join lateral public.sos_offer_now(s.id) d on true
   where s.duplicate_of is null
     and (s.status in ('received', 'assigned', 'en_route', 'on_site')
          or s.created_at > now() - make_interval(hours => greatest(p_hours, 1)))
   order by s.status = 'received' desc, s.priority_score desc, s.created_at;
end $$;

grant execute on function public.authority_board(integer) to authenticated;
