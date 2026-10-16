-- A10 (1/2): an admin can turn a registration down (owner, 16 Oct 2026).
--
-- Until now a registration could only wait or be verified, and a team registered "to see what
-- happens" sat in the queue for ever. A fourth state says an admin looked at it and said no.
-- It is not "suspended": suspended is a team that was verified and has been stopped.
--
-- The value is in a migration of its own because a new enum value cannot be *used* in the same
-- transaction that adds it (the same reason as 20261010112651).
alter type public.authority_status add value if not exists 'rejected';
