-- A10: the tries at an admin's sign-in code get their own log, and stop sharing otp_send_log
-- with the sends. Shared, ten mistyped codes would have eaten a third of the per-address budget
-- that email_link_allowed (20261015143700) counts, and Thai mobile networks put many phones
-- behind one address: during a flood a second admin could have been refused a new link because
-- a first one fumbled a code. Nothing here may stand between an admin and the alert they publish.
--
-- Same limits as before: 10 tries an hour for one address, 60 from one internet address, and
-- generous per internet address for exactly that reason. Only a hash of the email is kept.

create table public.otp_try_log (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip inet,
  tried_at timestamptz not null default now()
);
create index otp_try_log_email_idx on public.otp_try_log (email_hash, tried_at desc);
create index otp_try_log_ip_idx on public.otp_try_log (ip, tried_at desc);
alter table public.otp_try_log enable row level security;
revoke all on public.otp_try_log from anon, authenticated;

create or replace function public.email_code_allowed(p_token text, p_email text, p_ip inet)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to(lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.otp_try_log where tried_at < now() - interval '1 day';
  if (select count(*) from public.otp_try_log
       where email_hash = v_hash and tried_at > now() - interval '1 hour') >= 10 then
    return false;
  end if;
  if p_ip is not null and (select count(*) from public.otp_try_log
                            where ip = p_ip and tried_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  insert into public.otp_try_log (email_hash, ip) values (v_hash, p_ip);
  return true;
end $$;

-- The rows the first version of the function wrote into the send log, so they stop counting
-- against the sends from the same internet address.
delete from public.otp_send_log where phone_hash in (
  select encode(sha256(convert_to('code:' || lower(btrim(u.email)), 'UTF8')), 'hex')
  from auth.users u where u.email is not null
);
