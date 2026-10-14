-- A7, LINE for requests for help: the offer reaches a team's LINE as well as its phone, and the
-- sender can confirm "I have been helped" (or say they have not) from a button in LINE
-- (spec 5.4: "The requester confirms in the app, or through a LINE button, and the case
-- closes").
--
-- Same shape as web push: `line_due(token)` works out what is owed from the boards' own rows and
-- clock, hands each thing out once (push_log, with kinds of its own) and only Jaga's server may
-- ask. A LINE message names a tambon or a team, never a place or a person.
--
-- A button pressed in LINE comes back through LINE's signed webhook. Jaga then acts *as the
-- sender* - the same functions the app's own buttons call - after checking that the LINE user
-- who pressed it is the account that sent the request. Nobody else's press counts.

create function public.line_due(p_token text)
returns table (kind text, line_user_id text, locale text, sos_id uuid, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  o record;
  c record;
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id, s.kind as sos_kind, s.status, s.closed_at, s.requester_id,
           t.name_th, t.name_en
    from public.sos_requests s
    left join public.tambons t on t.code = s.tambon
    where s.created_at > now() - interval '3 days'
      and s.duplicate_of is null
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null))
  loop
    select cl.id, cl.completed_at, u.unit_name into c
      from public.sos_claims cl
      join public.authority_units u on u.id = cl.unit_id
     where cl.sos_id = r.id and cl.released_at is null;

    if c.id is null then
      select * into o from public.sos_offer_now(r.id);
      if o.dispatch_unit is not null then
        insert into public.push_log (kind, sos_id, ref)
        values ('line_offer', r.id,
                o.dispatch_unit::text || ':' || extract(epoch from o.offered_at)::bigint)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'offer'::text, p.line_user_id, p.preferred_locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en, 'expires_at', o.expires_at)
            from public.authority_units u
            join public.profiles p on p.user_id = u.user_id
            where u.id = o.dispatch_unit and u.status = 'verified'
              and p.line_user_id is not null
              and not exists (select 1 from public.line_follows f
                               where f.line_user_id = p.line_user_id and not f.following);
        end if;
      end if;
    elsif r.status = 'rescued' and r.closed_at is null and c.completed_at is not null
          and r.requester_id is not null then
      -- The team reports it done: the sender is asked, with two buttons.
      insert into public.push_log (kind, sos_id, ref) values ('line_rescued', r.id, c.id::text)
      on conflict do nothing;
      get diagnostics fresh = row_count;
      if fresh > 0 then
        return query
          select 'rescued'::text, p.line_user_id, p.preferred_locale, r.id,
                 jsonb_build_object('request', r.sos_kind, 'unit', c.unit_name)
          from public.profiles p
          where p.user_id = r.requester_id and p.line_user_id is not null
            and not exists (select 1 from public.line_follows f
                             where f.line_user_id = p.line_user_id and not f.following);
      end if;
    end if;
  end loop;
end $$;
revoke execute on function public.line_due(text) from public;
grant execute on function public.line_due(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- A press of "Yes, I have been helped" or "No, I still need help" in LINE.
-- Returns what happened: confirmed, disputed, closed (nothing left to answer), not_yours.
-------------------------------------------------------------------------------
create function public.line_case_answer(
  p_token text, p_line_user text, p_sos uuid, p_rescued boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.sos_requests;
  sender text;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.sos_requests x where x.id = p_sos;
  select p.line_user_id into sender from public.profiles p where p.user_id = s.requester_id;
  if s.id is null or sender is null or sender is distinct from p_line_user then
    return 'not_yours';
  end if;
  if not (s.status = 'rescued' and s.closed_at is null) then
    return 'closed';
  end if;
  -- Act as the sender for the rest of this transaction only: the very functions behind the
  -- app's own two buttons then run their own checks and write their own records.
  perform set_config('request.jwt.claim.sub', s.requester_id::text, true);
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', s.requester_id, 'role', 'authenticated')::text, true);
  if p_rescued then
    perform public.sos_close(p_sos, null, true, 'Confirmed from LINE');
  else
    perform public.sos_dispute_rescue(p_sos, null);
  end if;
  perform public.log_access(
    case when p_rescued then 'rescue_confirmed_line' else 'rescue_disputed_line' end,
    'sos_requests', p_sos::text, '{}'::jsonb);
  return case when p_rescued then 'confirmed' else 'disputed' end;
end $$;
revoke execute on function public.line_case_answer(text, text, uuid, boolean) from public;
grant execute on function public.line_case_answer(text, text, uuid, boolean) to anon, authenticated;

-- The month's LINE figures for the admins' screens (counts only).
create function public.line_quota_now()
returns table (used integer, monthly_limit integer, checked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return query
    select q.messages_used, q.monthly_limit, q.checked_at
    from public.line_quota_usage q
    where q.month = date_trunc('month', now())::date;
end $$;
revoke execute on function public.line_quota_now() from public, anon;
grant execute on function public.line_quota_now() to authenticated;
