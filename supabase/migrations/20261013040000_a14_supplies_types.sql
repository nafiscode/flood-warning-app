-- A14 (1/2): requests for food, water and other essentials - the new enum values.
--
-- A new enum value cannot be used in the transaction that adds it, so these stand in a file of
-- their own, as the dispatch types did (20261010112651).

-- A team that carries food, drinking water and other essentials to people the water has cut off.
alter type public.authority_capability add value if not exists 'supplies';

-- The relay's first tier for a supply request; coordination stays the second.
alter type public.offer_tier add value if not exists 'supplies';

-- What a request asks for. Every request is one or the other, and "rescue" is what a request is
-- unless it says otherwise: nothing may make a call for rescue look like something smaller.
create type public.sos_kind as enum ('rescue', 'supplies');
