-- A10: admins sign in with the 6-digit code from the email, not only with the link (owner,
-- 2026-10-18). On an iPhone the link always opens the browser, which shares no cookies with
-- Jaga on the home screen, so the admin was signed in everywhere except in the app.
--
-- A code typed into the app can be guessed at, so the tries are counted the same way the sends
-- already are (20261015143700): at most 10 an hour for one address and 60 from one internet
-- address, kept in otp_send_log under a hash of 'code:' and the address, which cannot be
-- confused with the 'email:' rows that count the sends.
--
-- Asked with the server's own token. As with the sends, if the check itself fails the try is
-- allowed: an admin who cannot sign in during a flood cannot publish alerts.

create function public.email_code_allowed(p_token text, p_email text, p_ip inet)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to('code:' || lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.otp_send_log where sent_at < now() - interval '1 day';
  if (select count(*) from public.otp_send_log
       where phone_hash = v_hash and sent_at > now() - interval '1 hour') >= 10 then
    return false;
  end if;
  if p_ip is not null and (select count(*) from public.otp_send_log
                            where ip = p_ip and sent_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  insert into public.otp_send_log (phone_hash, ip) values (v_hash, p_ip);
  return true;
end $$;

revoke execute on function public.email_code_allowed(text, text, inet) from public;
grant execute on function public.email_code_allowed(text, text, inet) to anon, authenticated;
