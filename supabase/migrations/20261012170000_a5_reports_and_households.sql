-- A5, fifth piece: what a team reads besides its cases (spec 5.7) - the flood reports in its
-- coverage, and the households that asked to be known about before a flood (spec 4.7).
--
-- Household data is the most sensitive thing Jaga holds: who is old, who cannot walk, where they
-- live. It reaches only a verified team that covers the tambon AND has the rescue or coordination
-- capability, every read is written to the access log, and the phone number is not in the list at
-- all: it is one more deliberate, logged tap (safety rule 5).

-------------------------------------------------------------------------------
-- Flood reports in the caller's coverage, newest first. No reporter: a team needs to know what
-- the water is doing and where, not who said so.
-------------------------------------------------------------------------------
create function public.authority_reports(p_hours integer default 72)
returns table (
  report_id uuid, created_at timestamptz, hazard public.hazard_type,
  lat double precision, lon double precision,
  tambon text, tambon_name_th text, tambon_name_en text,
  depth_ref public.depth_ref, trend public.water_trend, road_access public.road_access,
  text_note text, photo_count integer, has_voice boolean, moderation public.moderation_status
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_verified_authority() then
    raise exception 'Verified authorities only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.id, r.created_at, r.hazard_type,
         extensions.st_y(r.point)::double precision, extensions.st_x(r.point)::double precision,
         r.tambon, t.name_th, t.name_en,
         r.depth_ref, r.trend, r.road_access,
         r.text, cardinality(r.photos), r.voice_url is not null, r.moderation_status
    from public.reports r
    left join public.tambons t on t.code = r.tambon
   where public.covers_tambon(r.tambon)
     -- A report an admin hid (a prank, a wrong place) is not passed on to the teams.
     and r.moderation_status <> 'hidden'
     and r.created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 720))
   order by r.created_at desc
   limit 200;
end $$;

-- Who may read a report's photo: unchanged in substance (the reporter, an admin, a covering
-- team), restated here only so the team's route can ask for one report's files.
-- (report_media_readable already covers it; nothing to change.)

-------------------------------------------------------------------------------
-- Households in the caller's coverage, for teams with the rescue or coordination capability.
-- Volatile on purpose: it writes the read to the access log, one line a call with the count.
-------------------------------------------------------------------------------
create function public.authority_households()
returns table (
  household_id uuid, tambon text, tambon_name_th text, tambon_name_en text,
  lat double precision, lon double precision,
  size smallint, vulnerable jsonb, mobility_notes text,
  has_phone boolean, on_behalf boolean, updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  caps constant public.authority_capability[] := array['rescue', 'coordination']::public.authority_capability[];
  n integer;
begin
  if not exists (select 1 from public.authority_units u
                  where u.user_id = (select auth.uid()) and u.status = 'verified'
                    and u.capabilities && caps) then
    raise exception 'Only teams with rescue or coordination capability see household data'
      using errcode = 'insufficient_privilege';
  end if;
  select count(*) into n from public.households h where public.covers_tambon(h.tambon, caps);
  perform public.log_access('read_households', 'authority_coverage', null,
                            jsonb_build_object('count', n));
  return query
  select h.id, h.tambon, t.name_th, t.name_en,
         extensions.st_y(h.point)::double precision, extensions.st_x(h.point)::double precision,
         h.size, h.vulnerable, h.mobility_notes,
         h.contact_phone is not null, h.on_behalf_of_other, h.updated_at
    from public.households h
    left join public.tambons t on t.code = h.tambon
   where public.covers_tambon(h.tambon, caps)
   order by h.tambon, h.updated_at desc
   limit 500;
end $$;

-- One household's phone number: the same fence, and its own line in the access log.
create function public.reveal_household_phone(p_household_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
begin
  select * into h from public.households x where x.id = p_household_id;
  if not found then
    raise exception 'No such household' using errcode = 'no_data_found';
  end if;
  if not (public.is_admin()
          or public.covers_tambon(h.tambon, array['rescue', 'coordination']::public.authority_capability[])) then
    raise exception 'Not allowed to see this phone number' using errcode = 'insufficient_privilege';
  end if;
  perform public.log_access('reveal_phone', 'households', p_household_id::text,
                            jsonb_build_object('had_phone', h.contact_phone is not null));
  return h.contact_phone;
end $$;

revoke execute on function public.authority_reports(integer) from public, anon;
revoke execute on function public.authority_households() from public, anon;
revoke execute on function public.reveal_household_phone(uuid) from public, anon;
grant execute on function public.authority_reports(integer) to authenticated;
grant execute on function public.authority_households() to authenticated;
grant execute on function public.reveal_household_phone(uuid) to authenticated;
