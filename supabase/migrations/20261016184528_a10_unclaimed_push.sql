-- A10: the admins' phones ring for a request no team has taken, including when there was no
-- team to ask in the first place (owner, 16 Oct 2026).
--
-- Two things were wrong with the 'unclaimed' notification in push_due():
--
--  * **A case nobody could be offered was never notified at all.** sos_offer_now() returns no row
--    when the relay never started - no verified unit covers that tambon (the state Jaga is in on
--    launch day, before the first team registers), the point fell outside every tambon, or
--    building the queue failed. `select * into o` then leaves o.exhausted null, and `elsif
--    o.exhausted` is not true, so no admin was told. Meanwhile sos_responder() already tells the
--    sender their case "is now with Jaga's admins" (it coalesces the same null to true). The
--    sender was promised a watcher nobody had woken. Now the null reads as exhausted here too:
--    nobody to ask is the same as everybody asked.
--
--  * **It fired the moment the queue ran out**, which with two teams and a 60-second window is
--    two minutes in. The admins' own threshold for calling a case out is sos_unclaimed_minutes
--    (15 by default, theirs to tighten at the flood peak), and the war room already shouts at
--    exactly that mark. The notification now waits for it, so one number governs both.
--
-- Nothing about delivery changes: the case is on every covering unit's board from the second it
-- arrives, any covering unit may accept at any time, and the sender has seen the hotlines since
-- the request was sent (safety rule 1).
create or replace function public.push_due(p_token text)
returns table (kind text, endpoint text, keys jsonb, locale text, sos_id uuid, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  o record;
  c record;
  step text;
  fresh integer;
  v_overdue integer := public.setting_int('sos_unclaimed_minutes', 'minutes', 15);
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id, s.kind as sos_kind, s.status, s.closed_at, s.created_at, s.tambon,
           t.name_th, t.name_en
    from public.sos_requests s
    left join public.tambons t on t.code = s.tambon
    where s.created_at > now() - interval '3 days'
      and s.duplicate_of is null
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null))
  loop
    select cl.id, cl.unit_id, cl.completed_at, u.unit_name into c
      from public.sos_claims cl
      join public.authority_units u on u.id = cl.unit_id
     where cl.sos_id = r.id and cl.released_at is null;

    if c.id is null then
      -- Nobody holds it: whose turn is it?
      select * into o from public.sos_offer_now(r.id);
      if o.dispatch_unit is not null then
        insert into public.push_log (kind, sos_id, ref)
        values ('offer', r.id, o.dispatch_unit::text || ':' || extract(epoch from o.offered_at)::bigint)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'offer'::text, ps.endpoint, ps.keys, ps.locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en, 'expires_at', o.expires_at)
            from public.authority_units u
            join public.push_subscriptions ps on ps.user_id = u.user_id
            where u.id = o.dispatch_unit and u.status = 'verified';
        end if;
      -- No row at all means the relay never started: there was nobody to ask. Both that and a
      -- queue that ran out wait for the admins' own overdue mark before a phone rings.
      elsif coalesce(o.exhausted, true)
            and r.created_at <= now() - make_interval(mins => greatest(v_overdue, 0)) then
        insert into public.push_log (kind, sos_id, ref) values ('unclaimed', r.id, 'once')
        on conflict do nothing;
        get diagnostics fresh = row_count;
        if fresh > 0 then
          return query
            select 'unclaimed'::text, ps.endpoint, ps.keys, ps.locale, r.id,
                   jsonb_build_object('request', r.sos_kind, 'tambon_th', r.name_th,
                                      'tambon_en', r.name_en)
            from public.profiles p
            join public.push_subscriptions ps on ps.user_id = p.user_id
            where p.role in ('admin', 'super_admin');
        end if;
      end if;
    else
      -- A team holds it: tell the sender each step once, for this team's hold of the case.
      foreach step in array array[
        'accepted',
        case when r.status in ('en_route', 'on_site', 'rescued') then 'en_route' end,
        case when r.status in ('on_site', 'rescued') then 'on_site' end,
        case when r.status = 'rescued' and c.completed_at is not null then 'rescued' end
      ] loop
        continue when step is null;
        insert into public.push_log (kind, sos_id, ref) values (step, r.id, c.id::text)
        on conflict do nothing;
        get diagnostics fresh = row_count;
        -- Only the newest step is worth a notification when several are found at once.
        continue when fresh = 0
          or step <> (case when r.status = 'rescued' and c.completed_at is not null then 'rescued'
                           when r.status in ('on_site', 'rescued') then 'on_site'
                           when r.status = 'en_route' then 'en_route'
                           else 'accepted' end);
        return query
          select step, f.endpoint, f.keys, f.locale, r.id,
                 jsonb_build_object('request', r.sos_kind, 'unit', c.unit_name)
          from public.push_sos_followers f where f.sos_id = r.id;
      end loop;
    end if;
  end loop;
end $$;
