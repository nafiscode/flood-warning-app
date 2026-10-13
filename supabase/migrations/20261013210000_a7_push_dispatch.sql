-- A7, web push for an SOS: the offer reaches a team's phone with the board closed, and the sender
-- hears that a team has accepted.
--
-- Who sends? A notification here is caused by something nobody in particular is doing at that
-- moment: a clock running past one team's window, or a stranger's request arriving. So the send
-- cannot ride on the acting person's own rights, as an alert's does (an admin publishes it).
-- Instead:
--
--   * `push_due(token)` works out what is owed right now, from the same rows and clock the boards
--     read, hands it out once, and remembers that it did (`push_log`). Nothing is pushed on a
--     timer inside the database; whoever asks gets the list.
--   * Only Jaga's own server may ask. It proves itself with a token that it derives from the key
--     it already holds for signing pushes, so there is no new secret to keep. The database keeps
--     the token in a table no client can read, and uses it itself once a minute to wake the
--     server (pg_cron), which is what moves an offer on to the next team's phone while nobody has
--     the app open.
--   * The server also asks whenever something happens: a request arrives, a team acts, the sender's
--     own page checks in. The first team is told at once; the one-minute tick is the floor.
--
-- What leaves: to a team, the tambon and the kind of request, never the place or the person
-- (safety rules 5 and 6: the detail is on the board, behind the sign-in). To the sender, the name
-- of the team that took their case, which their own page already shows them.

-- The token and the site's address. One row, no policies: only the functions below read it.
create table public.push_gate (
  id boolean primary key default true check (id),
  token text not null check (char_length(token) >= 32),
  site_url text check (site_url is null or site_url ~ '^https://[a-z0-9.-]+$'),
  updated_at timestamptz not null default now()
);
alter table public.push_gate enable row level security;
revoke all on public.push_gate from public, anon, authenticated;

create function public.push_gate_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_token is not null and exists (select 1 from public.push_gate g where g.token = p_token)
$$;
revoke execute on function public.push_gate_ok(text) from public, anon, authenticated;

-- The phones that follow one request: its sender's, registered from the request's own page.
create table public.push_sos_followers (
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  endpoint text not null check (public.push_endpoint_ok(endpoint)),
  keys jsonb not null,
  locale text not null default 'th' check (locale in ('th', 'ms', 'en')),
  created_at timestamptz not null default now(),
  primary key (sos_id, endpoint)
);
alter table public.push_sos_followers enable row level security;
revoke all on public.push_sos_followers from public, anon, authenticated;

-- What has been handed out already, so nothing is sent twice.
create table public.push_log (
  kind text not null,
  sos_id uuid not null references public.sos_requests (id) on delete cascade,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, sos_id, ref)
);
alter table public.push_log enable row level security;
revoke all on public.push_log from public, anon, authenticated;

-------------------------------------------------------------------------------
-- The sender asks to be told about their own request. Only they can: the same check as every
-- other thing a sender does to a case (their account, or the token their phone holds).
-------------------------------------------------------------------------------
create function public.push_follow_sos(
  p_sos uuid,
  p_token text,
  p_endpoint text,
  p_keys jsonb,
  p_locale text default 'th'
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sos_for_caller(p_sos, p_token);
  if not public.push_endpoint_ok(p_endpoint) then
    raise exception 'Not a push service address' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_keys ->> 'p256dh', '') = '' or coalesce(p_keys ->> 'auth', '') = ''
     or char_length(p_keys::text) > 600 then
    raise exception 'A subscription needs its two keys' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.push_sos_followers (sos_id, endpoint, keys, locale)
  values (p_sos, p_endpoint,
          jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'),
          case when p_locale in ('th', 'ms', 'en') then p_locale else 'th' end)
  on conflict (sos_id, endpoint) do update set keys = excluded.keys, locale = excluded.locale;
  return true;
end $$;
revoke execute on function public.push_follow_sos(uuid, text, text, jsonb, text) from public;
grant execute on function public.push_follow_sos(uuid, text, text, jsonb, text)
  to anon, authenticated;

-------------------------------------------------------------------------------
-- What is owed right now. Each row is one notification for one phone; a thing is handed out
-- once. Requests older than three days are left alone.
--   offer     to the phones of the team being asked at this moment
--   unclaimed to the admins' phones, once every team has been asked and none has accepted
--   accepted, en_route, on_site, rescued
--             to the sender's phones, as their case moves
-------------------------------------------------------------------------------
create function public.push_due(p_token text)
returns table (kind text, endpoint text, keys jsonb, locale text, sos_id uuid, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  o record;
  c record;
  step text;
  fresh integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id, s.kind as sos_kind, s.status, s.closed_at, s.tambon, t.name_th, t.name_en
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
      elsif o.exhausted then
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
revoke execute on function public.push_due(text) from public;
grant execute on function public.push_due(text) to anon, authenticated;

-- Addresses the push services say are gone for good.
create function public.push_forget(p_token text, p_endpoints text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.push_subscriptions where endpoint = any (coalesce(p_endpoints, '{}'));
  delete from public.push_sos_followers where endpoint = any (coalesce(p_endpoints, '{}'));
end $$;
revoke execute on function public.push_forget(text, text[]) from public;
grant execute on function public.push_forget(text, text[]) to anon, authenticated;

-------------------------------------------------------------------------------
-- The one-minute tick. It sends nothing itself: it wakes Jaga's server, which asks push_due.
-- Skipped while nothing is waiting, and while the gate has not been set up (a fresh database,
-- the test database), so it can never fail loudly or call an address nobody chose.
-------------------------------------------------------------------------------
create function public.push_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.push_gate;
begin
  select * into g from public.push_gate limit 1;
  if g.site_url is null then
    return;
  end if;
  if not exists (
    select 1 from public.sos_requests s
    where s.created_at > now() - interval '3 days'
      and (s.status in ('received', 'assigned', 'en_route', 'on_site')
           or (s.status = 'rescued' and s.closed_at is null))) then
    return;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  perform extensions.http((
    'POST', g.site_url || '/api/push/tick',
    array[extensions.http_header('x-jaga-push', g.token)],
    'application/json', '{}'
  )::extensions.http_request);
exception when others then
  -- A site that is down must not fill the cron log with errors, or stop the next minute's try.
  null;
end $$;
revoke execute on function public.push_tick() from public, anon, authenticated;

select cron.schedule('jaga-push-tick', '* * * * *', 'select public.push_tick()');
