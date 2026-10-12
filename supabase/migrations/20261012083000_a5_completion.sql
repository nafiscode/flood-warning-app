-- A5, third piece: finishing a case (spec 5.4).
--
-- The team that holds a case says "rescued" and must attach at least one photo. That does not
-- close the case: it waits for the person who asked for help to confirm it. If they say they
-- have NOT been rescued, the case goes straight back to looking for a team. If nobody confirms
-- within 12 hours (a setting), a second verified team or an admin may confirm, with a photo of
-- their own and a note.
--
-- No new status is needed. "rescued" with closed_at still empty is "the team says rescued, not
-- yet confirmed"; closed_at is set only by a confirmation, and every confirmation is a row in
-- rescue_confirmations, which has existed since September. Points (5.5) will hang on that row.

-------------------------------------------------------------------------------
-- What the team reported, kept on its claim.
-------------------------------------------------------------------------------
alter table public.sos_claims
  add column completed_at timestamptz,
  add column completion_photos text[] not null default '{}',
  add column completion_note text check (char_length(completion_note) <= 1000);

insert into public.system_settings (key, value, note) values
  ('rescue_confirmation',
   '{"fallback_hours": 12}'::jsonb,
   'How long a rescue reported by a team waits for the person to confirm it before a second verified team or an admin may confirm instead (spec 5.4).')
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- Evidence photos go in the same private bucket as the sender's own, under <case>/proof/.
-- Only a verified team covering the case, or an admin, may write there; the sender's own window
-- (a day from sending) stays as it was and does not reach into proof/.
-------------------------------------------------------------------------------
create or replace function public.sos_media_writable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sos_requests s
    where s.id::text = split_part(p_path, '/', 1)
      and case when split_part(p_path, '/', 2) = 'proof'
               then public.is_admin() or public.covers_tambon(s.tambon)
               else s.created_at > now() - interval '24 hours' end
  )
$$;

-- The proof paths a caller named that really are files under this case's proof/ folder, at most
-- three. A path that was never uploaded is not evidence of anything.
create function public.sos_proof_paths(p_sos_id uuid, p_photos text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.name order by x.name), '{}')
    from (
      select o.name
        from storage.objects o
       where o.bucket_id = 'sos-media'
         and o.name = any (coalesce(p_photos, '{}'))
         and o.name like p_sos_id::text || '/proof/%'
       order by o.name
       limit 3
    ) x
$$;
revoke execute on function public.sos_proof_paths(uuid, text[]) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The team says: rescued. A photo is required; the case then waits for a confirmation.
-------------------------------------------------------------------------------
create function public.authority_complete_sos(p_sos_id uuid, p_photos text[], p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  mine uuid := public.my_unit_for_sos(p_sos_id);
  st public.sos_status;
  proof text[];
begin
  select s.status into st from public.sos_requests s where s.id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if mine is null or not exists (select 1 from public.sos_claims c
                                  where c.sos_id = p_sos_id and c.released_at is null
                                    and c.unit_id = mine) then
    raise exception 'Only the team holding this case can report the rescue'
      using errcode = 'insufficient_privilege';
  end if;
  if st not in ('assigned', 'en_route', 'on_site') then
    raise exception 'This case is not open' using errcode = 'check_violation';
  end if;
  proof := public.sos_proof_paths(p_sos_id, p_photos);
  if cardinality(proof) = 0 then
    raise exception 'A photo is required to report a rescue' using errcode = 'check_violation';
  end if;

  update public.sos_claims c
     set completed_at = now(), completion_photos = proof,
         completion_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
   where c.sos_id = p_sos_id and c.released_at is null and c.unit_id = mine;

  -- closed_at stays empty: that is what "not yet confirmed" means.
  update public.sos_requests s set status = 'rescued' where s.id = p_sos_id;

  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'rescued_by_team', (select auth.uid()), mine,
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
end $$;

-------------------------------------------------------------------------------
-- The sender's own words. Two things change from the A4 version:
--  - a case whose team has arrived ("on_site") can be closed by its sender. It could not: the
--    list of open statuses was written before that status existed.
--  - when the team has reported the rescue, the sender's answer is the confirmation that closes
--    the case.
-------------------------------------------------------------------------------
create or replace function public.sos_close(
  p_sos_id uuid, p_token text default null, p_rescued boolean default false, p_note text default null
) returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  uid uuid := (select auth.uid());
begin
  if s.status = 'rescued' and s.closed_at is null then
    update public.sos_requests set closed_at = now() where id = s.id;
    insert into public.sos_events (sos_id, event, actor_id, note)
      values (s.id, 'confirmed', uid, nullif(p_note, ''));
    insert into public.rescue_confirmations (sos_id, method, confirmed_by, note)
      values (s.id, 'requester', uid, nullif(p_note, ''));
    return 'rescued';
  end if;
  if s.status not in ('received', 'assigned', 'en_route', 'on_site') then return s.status; end if;
  update public.sos_requests
     set status = case when p_rescued then 'rescued' else 'safe_cancelled' end::public.sos_status,
         closed_at = now()
   where id = s.id;
  insert into public.sos_events (sos_id, event, actor_id, note)
    values (s.id, case when p_rescued then 'rescued' else 'safe_cancelled' end, uid, nullif(p_note, ''));
  if p_rescued then
    insert into public.rescue_confirmations (sos_id, method, confirmed_by, note)
      values (s.id, 'requester', uid, nullif(p_note, ''));
  end if;
  return (select status from public.sos_requests where id = s.id);
end $$;

-------------------------------------------------------------------------------
-- "No, I have not been rescued." The team's report is set aside and the case goes back to
-- looking for a team at once, the same team included: a mistaken tap should not lock out the
-- people nearest. It is written to the access log so the admins see that it happened.
-------------------------------------------------------------------------------
create function public.sos_dispute_rescue(p_sos_id uuid, p_token text default null)
returns public.sos_status
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests := public.sos_for_caller(p_sos_id, p_token);
  held uuid;
  next_round smallint;
begin
  if not (s.status = 'rescued' and s.closed_at is null) then
    return s.status;
  end if;

  update public.sos_claims c
     set released_at = now(), release_reason = 'The requester says they have not been rescued'
   where c.sos_id = s.id and c.released_at is null
   returning c.unit_id into held;

  update public.sos_requests r set status = 'received' where r.id = s.id;

  insert into public.sos_events (sos_id, event, actor_id, unit_id)
  values (s.id, 'not_rescued', (select auth.uid()), held);

  perform public.log_access('rescue_disputed', 'sos_requests', s.id::text,
                            jsonb_build_object('unit', held));

  select (coalesce(max(o.round), 1) + 1)::smallint into next_round
    from public.sos_offers o where o.sos_id = s.id;
  begin
    perform public.sos_build_offers(s.id, next_round, null);
  exception when others then
    -- As on insert: a routing fault must never cost the request. It is open and on every board.
    perform public.log_access('dispatch_failed', 'sos_requests', s.id::text,
                              jsonb_build_object('error', sqlerrm, 'at', 'dispute'));
  end;
  return 'received';
end $$;
revoke execute on function public.sos_dispute_rescue(uuid, text) from public;
grant execute on function public.sos_dispute_rescue(uuid, text) to anon, authenticated;

-------------------------------------------------------------------------------
-- The fallback: nobody confirmed within the waiting time, so a second verified team covering
-- the case, or an admin, confirms it with a photo of their own and a note. Never the team that
-- reported the rescue, and never the same person through another of their units.
-------------------------------------------------------------------------------
create function public.authority_confirm_rescue(p_sos_id uuid, p_photos text[], p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  uid uuid := (select auth.uid());
  cl public.sos_claims;
  hours integer := public.setting_int('rescue_confirmation', 'fallback_hours', 12);
  how public.rescue_confirmation_method;
  proof text[];
  note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  select * into s from public.sos_requests r where r.id = p_sos_id;
  if not found then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if public.is_admin() then
    how := 'admin';
  elsif public.is_verified_authority() and public.covers_tambon(s.tambon) then
    how := 'second_authority';
  else
    raise exception 'This case is not in your coverage' using errcode = 'insufficient_privilege';
  end if;
  if not (s.status = 'rescued' and s.closed_at is null) then
    raise exception 'This case is not waiting for a confirmation' using errcode = 'check_violation';
  end if;

  select c.* into cl from public.sos_claims c
   where c.sos_id = p_sos_id and c.released_at is null;
  if how = 'second_authority' and exists (
       select 1 from public.authority_units u where u.id = cl.unit_id and u.user_id = uid) then
    raise exception 'The team that reported the rescue cannot confirm it'
      using errcode = 'insufficient_privilege';
  end if;
  if cl.completed_at is null or cl.completed_at > now() - make_interval(hours => greatest(hours, 0)) then
    raise exception 'The person still has time to confirm this themselves'
      using errcode = 'check_violation';
  end if;
  if note is null then
    raise exception 'A confirmation needs a note' using errcode = 'check_violation';
  end if;
  proof := public.sos_proof_paths(p_sos_id, p_photos);
  if cardinality(proof) = 0 then
    raise exception 'A photo is required to confirm a rescue' using errcode = 'check_violation';
  end if;

  insert into public.rescue_confirmations (sos_id, method, confirmed_by, photos, note)
  values (p_sos_id, how, uid, proof, note);
  update public.sos_requests r set closed_at = now() where r.id = p_sos_id;
  insert into public.sos_events (sos_id, event, actor_id, unit_id, note)
  values (p_sos_id, 'confirmed', uid,
          case when how = 'second_authority' then public.my_unit_for_sos(p_sos_id) end, note);
  perform public.log_access('rescue_confirmed', 'sos_requests', p_sos_id::text,
                            jsonb_build_object('method', how));
end $$;

-------------------------------------------------------------------------------
-- The board, with what finishing a case needs: whether it is closed, when the team reported
-- the rescue, how many proof photos there are, and whether this caller may now confirm it.
-- A rescue nobody has confirmed stays on the board however old it is.
-- The return type changes, so the function is dropped and made again.
-------------------------------------------------------------------------------
drop function public.authority_board(integer);
create function public.authority_board(p_hours integer default 72)
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
  my_response public.offer_response,
  closed_at timestamptz, completed_at timestamptz, proof_count integer, can_confirm boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  wait_hours integer := public.setting_int('rescue_confirmation', 'fallback_hours', 12);
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
           order by o.round desc limit 1),
         s.closed_at, cl.completed_at,
         coalesce(cardinality(cl.completion_photos), 0),
         coalesce(s.status = 'rescued' and s.closed_at is null
                  and cl.completed_at <= now() - make_interval(hours => greatest(wait_hours, 0))
                  and cu.user_id <> uid, false)
    from public.sos_requests s
    join covered c on c.tambon = s.tambon
    left join public.tambons t on t.code = s.tambon
    left join public.sos_review rv on rv.sos_id = s.id
    left join public.sos_claims cl on cl.sos_id = s.id and cl.released_at is null
    left join public.authority_units cu on cu.id = cl.unit_id
    left join lateral public.sos_offer_now(s.id) d on true
   where s.duplicate_of is null
     and (s.status in ('received', 'assigned', 'en_route', 'on_site')
          or (s.status = 'rescued' and s.closed_at is null)
          or s.created_at > now() - make_interval(hours => greatest(p_hours, 1)))
   order by s.status = 'received' desc, s.priority_score desc, s.created_at;
end $$;

-------------------------------------------------------------------------------
-- Who may call what. A new function is open to everyone until it is closed.
-------------------------------------------------------------------------------
revoke execute on function public.authority_board(integer) from public, anon;
revoke execute on function public.authority_complete_sos(uuid, text[], text) from public, anon;
revoke execute on function public.authority_confirm_rescue(uuid, text[], text) from public, anon;
grant execute on function public.authority_board(integer) to authenticated;
grant execute on function public.authority_complete_sos(uuid, text[], text) to authenticated;
grant execute on function public.authority_confirm_rescue(uuid, text[], text) to authenticated;
