-- A5, last piece: what the admins need for points and households.
--
--  - The points ledger, and taking a row back with a reason (spec 5.5: "stored as a ledger, so
--    admins can revoke them"). A revoked row stays in the ledger; it only stops counting.
--  - The households admins may read (spec section 9: "Admin: read (logged)"), on the same terms
--    as a team: no phone number in the list, each read and each look at a number logged.

alter table public.hero_points
  add column revoked_by uuid references public.profiles (user_id) on delete set null,
  add column revoke_reason text check (char_length(revoke_reason) <= 500);

-------------------------------------------------------------------------------
-- The ledger, newest first. Revoked rows are shown, struck out, never hidden.
-------------------------------------------------------------------------------
create function public.admin_points_ledger(p_limit integer default 200)
returns table (
  award_id bigint, created_at timestamptz, unit_id uuid, unit_name text, org_name text,
  sos_id uuid, tambon_name_th text, tambon_name_en text,
  points integer, reason text, revoked_at timestamptz, revoke_reason text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select h.id, h.created_at, u.id, u.unit_name, o.name,
         h.sos_id, t.name_th, t.name_en,
         h.points, h.reason, h.revoked_at, h.revoke_reason
    from public.hero_points h
    join public.authority_units u on u.id = h.unit_id
    join public.organizations o on o.id = u.org_id
    left join public.sos_requests s on s.id = h.sos_id
    left join public.tambons t on t.code = s.tambon
   order by h.created_at desc
   limit least(greatest(p_limit, 1), 1000);
end $$;

-- Take an award back. It needs a reason, it cannot be done twice, and it is in the access log.
create function public.admin_revoke_points(p_award_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  why text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  perform public.admin_only();
  if why is null then
    raise exception 'Taking points back needs a reason' using errcode = 'check_violation';
  end if;
  update public.hero_points h
     set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = why
   where h.id = p_award_id and h.revoked_at is null;
  if not found then
    raise exception 'No such award, or it was already taken back' using errcode = 'no_data_found';
  end if;
  perform public.log_access('revoke_points', 'hero_points', p_award_id::text,
                            jsonb_build_object('reason', why));
end $$;

-------------------------------------------------------------------------------
-- Every registered household, for admins. Volatile: the read is logged, with the count.
-------------------------------------------------------------------------------
create function public.admin_households()
returns table (
  household_id uuid, tambon text, tambon_name_th text, tambon_name_en text,
  lat double precision, lon double precision,
  size smallint, vulnerable jsonb, mobility_notes text,
  has_phone boolean, on_behalf boolean, updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  n integer;
begin
  perform public.admin_only();
  select count(*) into n from public.households;
  perform public.log_access('read_households', 'households', null, jsonb_build_object('count', n));
  return query
  select h.id, h.tambon, t.name_th, t.name_en,
         extensions.st_y(h.point)::double precision, extensions.st_x(h.point)::double precision,
         h.size, h.vulnerable, h.mobility_notes,
         h.contact_phone is not null, h.on_behalf_of_other, h.updated_at
    from public.households h
    left join public.tambons t on t.code = h.tambon
   order by h.tambon nulls last, h.updated_at desc
   limit 2000;
end $$;

revoke execute on function public.admin_points_ledger(integer) from public, anon;
revoke execute on function public.admin_revoke_points(bigint, text) from public, anon;
revoke execute on function public.admin_households() from public, anon;
grant execute on function public.admin_points_ledger(integer) to authenticated;
grant execute on function public.admin_revoke_points(bigint, text) to authenticated;
grant execute on function public.admin_households() to authenticated;
