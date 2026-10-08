-- A4 fix: a photo or voice note from a phone could not be uploaded at all.
--
-- The storage policies of 20261008110925 checked the case or report with "exists (select 1 from
-- public.sos_requests ...)" inside the policy. That subquery runs as the caller, and a visitor
-- has no read access to sos_requests, so the check was always false and every upload was refused
-- (seen against jaga-dev: "new row violates row-level security policy", even for a case created
-- a second earlier). The same trap applies to reports.
--
-- The question is now answered by security definer functions, which see the row and give back a
-- yes or no. They tell the caller nothing else: the id in the path is a random uuid the sender
-- was just handed, and the answer is only whether something may be written under it.

create function public.sos_media_writable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sos_requests s
    where s.id::text = split_part(p_path, '/', 1)
      -- A case stays open to its own media for a day: details, photos and a voice note often
      -- follow the request by minutes, sometimes by hours on a bad connection.
      and s.created_at > now() - interval '24 hours'
  )
$$;
revoke execute on function public.sos_media_writable(text) from public;
grant execute on function public.sos_media_writable(text) to anon, authenticated;

-- Who may read an SOS photo: admins, and verified authorities covering that case's tambon.
create function public.sos_media_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sos_requests s
    where s.id::text = split_part(p_path, '/', 1)
      and (public.is_admin() or public.covers_tambon(s.tambon))
  )
$$;
revoke execute on function public.sos_media_readable(text) from public, anon;
grant execute on function public.sos_media_readable(text) to authenticated;

create function public.report_media_writable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.reports r
    where r.id::text = split_part(p_path, '/', 1)
      and r.reporter_id = (select auth.uid())
  )
$$;
revoke execute on function public.report_media_writable(text) from public, anon;
grant execute on function public.report_media_writable(text) to authenticated;

-- The reporter, admins, and verified authorities covering that tambon. A moderated photo reaches
-- the public only through a signed link from the admin console (A6), never from here.
create function public.report_media_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.reports r
    where r.id::text = split_part(p_path, '/', 1)
      and (r.reporter_id = (select auth.uid()) or public.is_admin()
           or public.covers_tambon(r.tambon))
  )
$$;
revoke execute on function public.report_media_readable(text) from public, anon;
grant execute on function public.report_media_readable(text) to authenticated;

drop policy "sos-media: sender uploads under a young case" on storage.objects;
drop policy "sos-media: covering authority and admin read" on storage.objects;
drop policy "report-media: reporter uploads under own report" on storage.objects;
drop policy "report-media: reporter, covering authority and admin read" on storage.objects;

create policy "sos-media: sender uploads under a young case" on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'sos-media' and public.sos_media_writable(name));
create policy "sos-media: covering authority and admin read" on storage.objects for select
  to authenticated
  using (bucket_id = 'sos-media' and public.sos_media_readable(name));

create policy "report-media: reporter uploads under own report" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'report-media' and public.report_media_writable(name));
create policy "report-media: reporter, covering authority and admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'report-media' and public.report_media_readable(name));
