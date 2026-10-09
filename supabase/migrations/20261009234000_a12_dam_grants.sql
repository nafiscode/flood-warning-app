-- A12 part 1 (fix 3): take the write privileges off the dam tables.
--
-- The blanket "revoke insert, update, delete ... on all tables in schema public from anon" in
-- 20260929120600_access_rules.sql only covered the tables that existed when it ran, and the
-- project's default privileges hand every new table back to anon and authenticated. So these
-- six had read policies and no write policy - which stops an insert, because that raises, but
-- lets an update or a delete pass silently against nought rows.
--
-- Nothing should be writing here from a client at all: the geometry comes from the seed, the
-- readings from the hourly job, and an admin's review from a security-definer function. Taking
-- the privilege away says so, instead of relying on the absence of a policy.

revoke insert, update, delete, truncate on
    public.dams, public.dam_reaches, public.dam_tambons,
    public.dam_readings, public.dam_notices, public.dam_feed_log
  from anon, authenticated;
