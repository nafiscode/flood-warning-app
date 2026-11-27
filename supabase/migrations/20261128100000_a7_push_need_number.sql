-- Ask the sender of an open request for a phone number, by push (owner, 28 Nov 2026).
--
-- Of the six requests open on 27 Nov, none had a number: a request nobody can call back is half a
-- request, and a team that accepts it, or another team once it opens to every team, cannot reach
-- the person. The SOS screen now asks for a number before sending (27 Nov), but a request sent by
-- an older screen, by LINE or SMS, or from the offline queue can still arrive without one.
--
-- This is the same kind of thing as the "your case moved" pushes, in its own function so the one
-- that carries the offers and the admins' call (`push_due`) is not touched: the phones that follow
-- one request (`push_sos_followers`, registered from the sender's own case page) are told ONCE
-- that a number would help, and the case page they open has a field for it.
--
-- Who is asked: an open rescue request (not supplies, not merged into another, not flagged as a
-- suspected nuisance send) with no number on file, five minutes after it was sent, inside the
-- three days the other pushes cover, and only when a phone follows it. A phone that starts
-- following later is asked then: the line in `push_log` is written only when there was someone to
-- send to. Nothing here carries a place, a name or a number; the push says only to open the case.

create function public.push_need_number_due(p_token text)
returns table (endpoint text, keys jsonb, locale text, sos_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  with due as (
    insert into public.push_log (kind, sos_id, ref)
    select 'need_number', s.id, 'once'
      from public.sos_requests s
     where s.status in ('received', 'assigned', 'en_route', 'on_site')
       and s.closed_at is null
       and s.kind = 'rescue'
       and s.duplicate_of is null
       and s.created_at <= now() - interval '5 minutes'
       and s.created_at > now() - interval '3 days'
       and not exists (select 1 from public.sos_contacts c
                        where c.sos_id = s.id
                          and (c.contact_phone is not null or c.on_site_phone is not null))
       and not exists (select 1 from public.sos_review r
                        where r.sos_id = s.id and r.suspected_spam and r.spam_dismissed_at is null)
       and exists (select 1 from public.push_sos_followers f where f.sos_id = s.id)
    on conflict do nothing
    returning push_log.sos_id
  )
  select f.endpoint, f.keys, f.locale, f.sos_id
    from public.push_sos_followers f
    join due d on d.sos_id = f.sos_id;
end $$;
revoke execute on function public.push_need_number_due(text) from public;
grant execute on function public.push_need_number_due(text) to anon, authenticated;
