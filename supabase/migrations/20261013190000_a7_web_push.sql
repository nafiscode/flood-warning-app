-- A7, web push: an alert reaches the phone with the app closed.
--
-- A subscription is what a browser hands a page once its person has allowed notifications: an
-- address at the browser maker's push service, and two keys to encrypt for that one browser. It
-- names nobody. Jaga keeps beside it the tambons that phone follows, because that is all it needs
-- to decide whom an alert is for (spec 4.8: only people in the affected tambons).
--
--   * A visitor may subscribe too: an alert must reach someone who chose their area on the home
--     screen and never made an account. So the user is optional, and writing goes through
--     functions rather than the table's own-rows policy.
--   * Only the push services of the browser makers are accepted as addresses. Jaga's server will
--     later send a request to each address it holds, and must not be made to call anything else.
--   * Reading the addresses is for an admin, at the moment they publish an alert, and it is logged.
--     A drill is never pushed: the public cannot see a drill.

alter table public.push_subscriptions
  alter column user_id drop not null,
  add column tambons text[] not null default '{}',
  add column locale text not null default 'th' check (locale in ('th', 'ms', 'en')),
  add column updated_at timestamptz not null default now();
create index push_subscriptions_tambons_idx on public.push_subscriptions using gin (tambons);

-- The addresses Chrome and Android (FCM), Firefox, Safari and iOS, and Edge and Windows hand out.
create function public.push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable set search_path = '' as $$
  select p_endpoint is not null
     and char_length(p_endpoint) between 20 and 1000
     and p_endpoint ~ '^https://([a-z0-9-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'
$$;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_ok check (public.push_endpoint_ok(endpoint));

-------------------------------------------------------------------------------
-- Subscribe, or say again which tambons this phone follows. Called on every app open by a phone
-- that has notifications on, so the list follows the person's places as they change them.
-------------------------------------------------------------------------------
create function public.push_subscribe(
  p_endpoint text,
  p_keys jsonb,
  p_tambons text[],
  p_locale text default 'th'
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tambons text[];
begin
  if not public.push_endpoint_ok(p_endpoint) then
    raise exception 'Not a push service address' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_keys ->> 'p256dh', '') = '' or coalesce(p_keys ->> 'auth', '') = ''
     or char_length(p_keys::text) > 600 then
    raise exception 'A subscription needs its two keys' using errcode = 'invalid_parameter_value';
  end if;
  -- Only tambons that exist, and no more than a person can follow.
  select coalesce(array_agg(t.code order by t.code), '{}') into v_tambons
    from (select code from public.tambons
           where code = any (coalesce(p_tambons, '{}')) limit 60) t;
  insert into public.push_subscriptions (user_id, endpoint, keys, tambons, locale)
  values ((select auth.uid()), p_endpoint,
          jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'),
          v_tambons, case when p_locale in ('th', 'ms', 'en') then p_locale else 'th' end)
  on conflict (endpoint) do update
    set keys = excluded.keys, tambons = excluded.tambons, locale = excluded.locale,
        -- Signing out on this phone must not leave the last person's name on its subscription.
        user_id = excluded.user_id, updated_at = now();
  return true;
end $$;
revoke execute on function public.push_subscribe(text, jsonb, text[], text) from public;
grant execute on function public.push_subscribe(text, jsonb, text[], text) to anon, authenticated;

-- Turn notifications off for this phone. The address is known only to the phone that holds it.
create function public.push_unsubscribe(p_endpoint text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.push_unsubscribe(text) from public;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- For the admin who has just published: the phones following a tambon the alert names.
-------------------------------------------------------------------------------
create function public.push_targets_for_alert(p_alert uuid)
returns table (endpoint text, keys jsonb, locale text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  if not exists (select 1 from public.alerts a
                  where a.id = p_alert and not a.is_drill
                    and a.cancelled_at is null and a.superseded_by is null) then
    return;
  end if;
  perform public.log_access('push_targets', 'alerts', p_alert::text, '{}'::jsonb);
  return query
    select s.endpoint, s.keys, s.locale
    from public.push_subscriptions s
    where s.tambons && (select array_agg(at.tambon) from public.alert_tambons at
                         where at.alert_id = p_alert);
end $$;
revoke execute on function public.push_targets_for_alert(uuid) from public, anon;
grant execute on function public.push_targets_for_alert(uuid) to authenticated;

-- What came of the send: how many phones took it, and the addresses the push services say are
-- gone for good (the person removed the app or took the permission back), which are dropped.
create function public.push_record_alert(p_alert uuid, p_sent integer, p_failed integer, p_gone text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
  insert into public.alert_deliveries (alert_id, channel, recipients, status, sent_at)
  values (p_alert, 'web_push', greatest(coalesce(p_sent, 0), 0),
          case when coalesce(p_failed, 0) > 0 then 'partial' else 'sent' end, now());
end $$;
revoke execute on function public.push_record_alert(uuid, integer, integer, text[]) from public, anon;
grant execute on function public.push_record_alert(uuid, integer, integer, text[]) to authenticated;
