-- A5 (1/2): the types the dispatch needs (spec 5.2, decisions of 9 and 10 Oct).
--
-- They are in a migration of their own because a new enum value cannot be *used* in the same
-- transaction that adds it. Adding them here means the next migration can write 'on_site' in a
-- default, a check or an index without Postgres refusing.

-- The main path of spec 5.2 gains the step the team reports when it arrives.
alter type public.sos_status add value if not exists 'on_site' after 'en_route';

-- How long until a team expects to be there. Bands, never a clock time (safety rule 8): a time
-- would be read as a promise, and nobody can promise one in a flood.
create type public.eta_band as enum ('under15', 'to30', 'to60', 'over60', 'unknown');

-- Who the relay asks, in order: the rescue-capable units covering the tambon, then the
-- coordination ones. After those it is the admins' monitor, which is not a unit and has no tier.
create type public.offer_tier as enum ('rescue', 'coordination');

-- What a unit said. "timed_out" is not a refusal: nobody was holding the phone.
create type public.offer_response as enum ('accepted', 'declined', 'timed_out');
