-- A5, fourth piece: points for teams (spec 5.5), the responsibility map (5.6), and the list of
-- rescues an admin may confirm (5.4).

-------------------------------------------------------------------------------
-- Points. Awarded only when a case closes with a confirmation, never for accepting it; a ledger,
-- so an admin can revoke a row without rewriting history.
-------------------------------------------------------------------------------
insert into public.system_settings (key, value, note) values
  ('hero_points',
   '{"per_case": 10, "per_person": 2, "vulnerable_bonus": 3, "max_people": 20}'::jsonb,
   'Points a team earns when a rescue it reported is confirmed (spec 5.5): a fixed amount per case, an amount per person rescued (counted up to max_people, so a typed-in number cannot run away), and a bonus when vulnerable people were involved.')
on conflict (key) do nothing;

-- One live award per team and case, whatever happens to be retried.
create unique index hero_points_one_live_award_idx
  on public.hero_points (unit_id, sos_id) where revoked_at is null and sos_id is not null;

create function public.award_hero_points() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  team public.authority_units;
  people integer;
  pts integer;
begin
  select * into s from public.sos_requests r where r.id = new.sos_id;
  select u.* into team
    from public.sos_claims c join public.authority_units u on u.id = c.unit_id
   where c.sos_id = new.sos_id and c.released_at is null;
  -- Nobody held the case (the person got out by themselves): nothing to award.
  if team.id is null then
    return new;
  end if;
  -- A team does not earn points for a request its own account sent.
  if s.requester_id is not null and s.requester_id = team.user_id then
    return new;
  end if;

  people := least(greatest(coalesce(s.people_count, 1), 1),
                  public.setting_int('hero_points', 'max_people', 20));
  pts := public.setting_int('hero_points', 'per_case', 10)
       + public.setting_int('hero_points', 'per_person', 2) * people
       + case when exists (select 1 from jsonb_each(coalesce(s.vulnerable_flags, '{}'::jsonb)) f
                            where f.value = 'true'::jsonb)
              then public.setting_int('hero_points', 'vulnerable_bonus', 3) else 0 end;

  insert into public.hero_points (unit_id, sos_id, points, reason)
  values (team.id, new.sos_id, pts, 'rescue confirmed: ' || new.method::text)
  on conflict do nothing;
  return new;
exception when others then
  -- Points are never a reason for a confirmation to fail.
  perform public.log_access('hero_points_failed', 'sos_requests', new.sos_id::text,
                            jsonb_build_object('error', sqlerrm));
  return new;
end $$;
revoke execute on function public.award_hero_points() from public, anon, authenticated;

create trigger rescue_confirmations_award_points
  after insert on public.rescue_confirmations
  for each row execute function public.award_hero_points();

-- The board of thanks: each team's confirmed rescues and points, by the province of the case.
-- Verified teams and admins only (decision of 9 Oct: no ranking in public).
create function public.hero_leaderboard(p_province text default null)
returns table (province_code text, unit_id uuid, unit_name text, org_name text,
               points integer, cases integer, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select left(s.tambon, 2), u.id, u.unit_name, o.name,
         sum(h.points)::integer, count(distinct h.sos_id)::integer, u.user_id = uid
    from public.hero_points h
    join public.authority_units u on u.id = h.unit_id
    join public.organizations o on o.id = u.org_id
    join public.sos_requests s on s.id = h.sos_id
   where h.revoked_at is null
     and s.tambon is not null
     and (p_province is null or left(s.tambon, 2) = p_province)
   group by left(s.tambon, 2), u.id, u.unit_name, o.name, u.user_id
   order by 1, 5 desc, u.unit_name;
end $$;

-------------------------------------------------------------------------------
-- The responsibility map (spec 5.6): for every tambon, how many verified teams with rescue
-- capability cover it, how many coordinators, and whether the caller's own team does. A tambon
-- with no rescue team is a gap. No phone number and no person is in any of this.
-------------------------------------------------------------------------------
create function public.coverage_summary()
returns table (tambon text, name_th text, name_en text, province_code text,
               rescue_units integer, coordination_units integer, mine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select t.code, t.name_th, t.name_en, t.province_code,
         count(*) filter (where 'rescue' = any (u.capabilities))::integer,
         count(*) filter (where 'coordination' = any (u.capabilities)
                            and not 'rescue' = any (u.capabilities))::integer,
         coalesce(bool_or(u.user_id = uid), false)
    from public.tambons t
    left join public.authority_coverage ac on ac.tambon = t.code
    left join public.authority_units u on u.id = ac.unit_id and u.status = 'verified'
   group by t.code, t.name_th, t.name_en, t.province_code
   order by t.code;
end $$;

-- The verified teams covering one tambon, for "who else is here".
create function public.coverage_units(p_tambon text)
returns table (unit_id uuid, unit_name text, org_name text, capabilities text[],
               on_duty boolean, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.unit_name, o.name, u.capabilities::text[], u.on_duty, u.user_id = uid
    from public.authority_coverage ac
    join public.authority_units u on u.id = ac.unit_id and u.status = 'verified'
    join public.organizations o on o.id = u.org_id
   where ac.tambon = p_tambon
   order by ('rescue' = any (u.capabilities)) desc, u.unit_name;
end $$;

-------------------------------------------------------------------------------
-- Rescues a team reported and nobody has confirmed, for the admins' war room (spec 5.4). "due"
-- says the person has had their time and an admin may now confirm with a photo and a note.
-------------------------------------------------------------------------------
create function public.admin_unconfirmed_rescues()
returns table (sos_id uuid, tambon text, tambon_name_th text, tambon_name_en text,
               unit_name text, completed_at timestamptz, proof_count integer,
               people_count smallint, due boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  wait_hours integer := public.setting_int('rescue_confirmation', 'fallback_hours', 12);
begin
  perform public.admin_only();
  return query
  select s.id, s.tambon, t.name_th, t.name_en, u.unit_name, c.completed_at,
         coalesce(cardinality(c.completion_photos), 0), s.people_count,
         coalesce(c.completed_at <= now() - make_interval(hours => greatest(wait_hours, 0)), false)
    from public.sos_requests s
    join public.sos_claims c on c.sos_id = s.id and c.released_at is null
    join public.authority_units u on u.id = c.unit_id
    left join public.tambons t on t.code = s.tambon
   where s.status = 'rescued' and s.closed_at is null and s.duplicate_of is null
   order by c.completed_at;
end $$;

revoke execute on function public.hero_leaderboard(text) from public, anon;
revoke execute on function public.coverage_summary() from public, anon;
revoke execute on function public.coverage_units(text) from public, anon;
revoke execute on function public.admin_unconfirmed_rescues() from public, anon;
grant execute on function public.hero_leaderboard(text) to authenticated;
grant execute on function public.coverage_summary() to authenticated;
grant execute on function public.coverage_units(text) to authenticated;
grant execute on function public.admin_unconfirmed_rescues() to authenticated;
