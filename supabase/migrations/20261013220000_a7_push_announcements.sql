-- A7: an announcement from the admins is pushed too (the owner, 13 Oct: every alert and every
-- announcement reaches the phone and the bell). Same rule as an alert: the admin who has just
-- posted it reads the addresses with their own session, it is logged, and only phones that
-- follow one of its tambons get it - or every subscribed phone when it is for everyone.
create function public.push_targets_for_announcement(p_announcement uuid)
returns table (endpoint text, keys jsonb, locale text)
language plpgsql security definer set search_path = '' as $$
declare
  a public.announcements;
begin
  perform public.admin_only();
  select * into a from public.announcements x where x.id = p_announcement;
  if a.id is null or a.cancelled_at is not null or a.starts_at > now() + interval '1 minute'
     or (a.ends_at is not null and a.ends_at <= now()) then
    return;
  end if;
  perform public.log_access('push_targets', 'announcements', p_announcement::text, '{}'::jsonb);
  return query
    select s.endpoint, s.keys, s.locale
    from public.push_subscriptions s
    where a.tambons is null or s.tambons && a.tambons;
end $$;
revoke execute on function public.push_targets_for_announcement(uuid) from public, anon;
grant execute on function public.push_targets_for_announcement(uuid) to authenticated;

-- Addresses the push services called dead while an announcement was being sent.
create function public.push_drop_gone(p_gone text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_only();
  delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
end $$;
revoke execute on function public.push_drop_gone(text[]) from public, anon;
grant execute on function public.push_drop_gone(text[]) to authenticated;
