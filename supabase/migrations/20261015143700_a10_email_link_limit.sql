-- A10 security review: a limit on admin sign-in links by email. Anyone can post the sign-in form,
-- so without a limit a script could flood an admin's inbox and use up the project's hourly email
-- allowance, locking every admin out during a flood. Only Jaga's server can ask (the push gate
-- token), so nobody can use up someone else's allowance by calling this directly. The phone
-- codes already have the same kind of limit in the SMS hook (otp_send_allowed).
--
-- At most 5 links an hour to one address, and 30 an hour from one internet address. The address
-- is kept only as a hash, for a day.

create function public.email_link_allowed(p_token text, p_email text, p_ip inet)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to('email:' || lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.otp_send_log where sent_at < now() - interval '1 day';
  if (select count(*) from public.otp_send_log
       where phone_hash = v_hash and sent_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;
  if p_ip is not null and (select count(*) from public.otp_send_log
                            where ip = p_ip and sent_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into public.otp_send_log (phone_hash, ip) values (v_hash, p_ip);
  return true;
end $$;

revoke execute on function public.email_link_allowed(text, text, inet) from public;
grant execute on function public.email_link_allowed(text, text, inet) to anon, authenticated;
