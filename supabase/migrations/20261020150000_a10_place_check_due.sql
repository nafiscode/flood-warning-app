-- A10: the map's own place pop-up needs to say how old a reading is, like the cards do.
--
-- The map reads `safe_places` straight through PostgREST (2,566 rows, paged), not through
-- `safe_places_near`, so it has no way to call `place_check_window(tambon_level(...))` per row.
-- Without the due time it would have to assume the longest window, and a shelter in a tambon
-- under a warning would read as freshly checked for a week. That is the one thing this whole
-- feature exists to prevent, so the due time becomes a computed field on the table: PostgREST
-- serves it as a column, and it is worked out from the level in force where the place is.

create function public.check_due_at(sp public.safe_places)
returns timestamptz
language sql stable set search_path = '' as $$
  select sp.checked_at + public.place_check_window(public.tambon_level(sp.tambon))
$$;
grant execute on function public.check_due_at(public.safe_places) to anon, authenticated;
