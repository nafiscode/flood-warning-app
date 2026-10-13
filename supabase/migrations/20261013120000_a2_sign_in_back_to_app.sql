-- A2: a LINE sign-in started in Jaga on the home screen finishes in Jaga on the home screen
-- (owner, 2026-10-13). The LINE app cannot return to an installed web app: it opens the phone's
-- browser, which on an iPhone shares no cookies with the app. Until now that browser was signed
-- in and the app stayed signed out.
--
-- A flow started from the installed app is marked. When its return lands in another browser,
-- that browser does not use the code: it leaves it here ("parks" it) and tells the person to go
-- back to the app. The app, which still holds the one-time key, asks for the code and finishes
-- the sign-in itself. The browser can still finish it instead if the person says so.
--
-- The code alone signs nobody in: it needs the one-time key. Whoever holds the flow id already
-- held the code (both travel in the same return address), so nothing new is exposed.

alter table public.sign_in_flows
  add column from_app boolean not null default false,
  add column code text;

-- Mark a flow as started from the installed app. Only an untouched, fresh flow can be marked.
create function public.sign_in_flow_mark_app(p_id text) returns void
language sql security definer set search_path = '' as $$
  update public.sign_in_flows
  set from_app = true
  where id_hash = encode(sha256(convert_to(p_id, 'UTF8')), 'hex')
    and code is null
    and created_at > now() - interval '10 minutes';
$$;

-- Leave the code for the app to collect. True when this flow came from the app and the code is
-- now waiting; false for any other flow, which then finishes where it landed, as before.
create function public.sign_in_flow_park(p_id text, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_done boolean;
begin
  if p_id is null or p_code is null or length(p_code) = 0 or length(p_code) > 500 then
    return false;
  end if;
  update public.sign_in_flows
  set code = p_code
  where id_hash = encode(sha256(convert_to(p_id, 'UTF8')), 'hex')
    and from_app
    and code is null
    and created_at > now() - interval '10 minutes'
  returning true into v_done;
  return coalesce(v_done, false);
end $$;

-- The waiting code and the one-time key, once: the row is gone afterwards. Null while nothing
-- is waiting (the row stays, so the app can ask again), and null when unknown or too old.
create function public.sign_in_flow_claim(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_verifier text;
begin
  if p_id is null then
    return null;
  end if;
  delete from public.sign_in_flows
  where id_hash = encode(sha256(convert_to(p_id, 'UTF8')), 'hex')
    and code is not null
    and created_at > now() - interval '10 minutes'
  returning code, verifier into v_code, v_verifier;
  if v_code is null then
    return null;
  end if;
  return jsonb_build_object('code', v_code, 'verifier', v_verifier);
end $$;

revoke execute on function public.sign_in_flow_mark_app(text) from public;
revoke execute on function public.sign_in_flow_park(text, text) from public;
revoke execute on function public.sign_in_flow_claim(text) from public;
grant execute on function public.sign_in_flow_mark_app(text) to anon, authenticated;
grant execute on function public.sign_in_flow_park(text, text) to anon, authenticated;
grant execute on function public.sign_in_flow_claim(text) to anon, authenticated;
