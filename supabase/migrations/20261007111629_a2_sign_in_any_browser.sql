-- A2: a LINE sign-in may finish in another browser than the one that started it
-- (decision 2026-10-07). Inside Messenger and similar apps the LINE app hands the person back
-- to the phone's own browser, which does not hold the one-time key (the PKCE code verifier) the
-- sign-in was started with. The key is kept here for ten minutes instead, under an id that
-- travels in the return address, and can be taken once.
--
-- Nobody can read the table. Whoever holds the return address (code and id) can finish that one
-- sign-in; the app then shows whose account it is before anything else.

create table public.sign_in_flows (
  id_hash text primary key,
  verifier text not null,
  created_at timestamptz not null default now()
);
alter table public.sign_in_flows enable row level security;
revoke all on public.sign_in_flows from anon, authenticated;

create function public.sign_in_flow_put(p_id text, p_verifier text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or length(p_id) < 32 or length(p_id) > 128
     or p_verifier is null or length(p_verifier) = 0 or length(p_verifier) > 2000 then
    raise exception 'invalid sign-in flow' using errcode = '22023';
  end if;
  delete from public.sign_in_flows where created_at < now() - interval '10 minutes';
  -- A flood of started sign-ins must not fill the database. Over the cap, sign-in still works
  -- in the browser that started it.
  if (select count(*) from public.sign_in_flows) >= 20000 then
    raise exception 'too many sign-in flows' using errcode = '53400';
  end if;
  insert into public.sign_in_flows (id_hash, verifier)
  values (encode(sha256(convert_to(p_id, 'UTF8')), 'hex'), p_verifier)
  on conflict do nothing;
end $$;

-- The key for this id, once: the row is gone afterwards. Null when unknown, used or too old.
create function public.sign_in_flow_take(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_verifier text;
begin
  if p_id is null then
    return null;
  end if;
  delete from public.sign_in_flows
  where id_hash = encode(sha256(convert_to(p_id, 'UTF8')), 'hex')
  returning case when created_at > now() - interval '10 minutes' then verifier end
  into v_verifier;
  return v_verifier;
end $$;

revoke execute on function public.sign_in_flow_put(text, text) from public;
revoke execute on function public.sign_in_flow_take(text) from public;
grant execute on function public.sign_in_flow_put(text, text) to anon, authenticated;
grant execute on function public.sign_in_flow_take(text) to anon, authenticated;
