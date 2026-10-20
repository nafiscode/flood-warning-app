-- A10: a public bucket for the text and pictures of pages that are *about* somebody.
--
-- "Who built Jaga" (/about) is a page about the founder: their career, their employers, their
-- face. The owner's decision of 20 Oct 2026 is that none of that belongs in this repository,
-- which is public and which they did not choose as the place to publish their own employment
-- history. The page stays public on the site; only its source leaves the repo.
--
-- So the page's copy and pictures live here instead, and the build downloads them. Nothing is
-- read at request time: `scripts/fetch-content.mjs` fetches once during the build and writes
-- the files into gitignored paths, so a visitor's page costs exactly what it costs today and a
-- slow or absent bucket can never make a page on this site slow.
--
-- The bucket is public on purpose. Everything in it is already on a public page: the same
-- paragraphs, the same photograph. It carries no personal data of anybody else - no phone
-- number, no location, no account - and the one rule it must keep is that nothing belonging to a
-- *user* is ever put in it. Uploads go through `scripts/push-content.mjs` with the secret key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-content', 'site-content', true, 2097152,
   array['application/json', 'image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do nothing;

-- Anyone may read it; that is the point of a public page's text. Nobody writes through the API:
-- there is no insert, update or delete policy, so only the secret key (which bypasses RLS) can
-- put anything in, and that only happens from the owner's laptop.
create policy site_content_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-content');
