-- A15 (2/2): "How is Jaga for you?" answered in LINE, into the same table (spec 17 item 5).
--
-- The chat has no form, so it asks the one question a chat can carry well: the rating, as five
-- quick replies. Anything else a person types in that conversation is kept as the message, and
-- the reply points at /feedback for the two lists and the comment.
--
-- Why a function of its own rather than `submit_feedback`: the webhook speaks as the visitor
-- role with the push gate's token and knows a LINE id, not a session. This resolves that id to
-- the profile behind it - so a signed-in person's rating carries their account and they can read
-- it back and delete it - and refuses anybody without the gate's token, exactly as the other
-- LINE functions do.
--
-- It never publishes anything: a rating sent in LINE has no consent to be shown and no display
-- name, so `public_ok` stays false and it is admins-only like any other ungifted comment.

create function public.line_feedback(
  p_token text,
  p_line_user text,
  p_rating smallint default null,
  p_message text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_rating smallint := case when p_rating between 1 and 5 then p_rating end;
  v_message text := nullif(left(btrim(coalesce(p_message, '')), 2000), '');
  v_recent integer;
begin
  if not public.push_gate_ok(p_token) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_rating is null and v_message is null then
    return false;
  end if;
  select * into p from public.profiles x where x.line_user_id = p_line_user;

  -- The same daily limit as the form, counted against the account where there is one and against
  -- the LINE id where there is not. A chat makes it easy to tap a face five times in a row.
  select count(*) into v_recent from public.feedback f
   where f.created_at > now() - interval '1 day'
     and ((p.user_id is not null and f.user_id = p.user_id)
          or (p.user_id is null and f.device_id = 'line:' || p_line_user));
  if v_recent >= public.setting_int('feedback_limit', 'per_user_day', 3) then
    return false;
  end if;

  insert into public.feedback (
    kind, rating, message, screen, locale, moment, role_at_time, user_id, device_id, district_code)
  values (
    case when v_message is not null then 'other'::public.feedback_kind
         else 'rating'::public.feedback_kind end,
    v_rating, v_message, 'line',
    coalesce(p.preferred_locale, 'th'), 'line',
    coalesce(p.role::text, 'visitor'),
    p.user_id,
    -- Not a device at all: the LINE id, so the daily limit can count somebody with no account.
    -- It is anonymised on the same twelve-month clock as any other device code.
    'line:' || left(p_line_user, 80),
    -- The district the person's own home is in, never finer (spec 17).
    left(p.home_tambon, 4));
  return true;
end $$;
revoke execute on function public.line_feedback(text, text, smallint, text) from public;
grant execute on function public.line_feedback(text, text, smallint, text) to anon, authenticated;
