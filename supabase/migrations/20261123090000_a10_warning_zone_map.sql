-- The warning zone itself, drawn on the public map (the owner, 22 Nov 2026: "in the map should
-- highlight the warning zone, for all users to see, not just the affected users").
--
-- Until now a warning zone was an internal unit: the thing an admin ticks a gauge into and the
-- thing `auto_alarm_check()` publishes for. A reader saw only the result - their own tambon's
-- colour - and never the river basin the warning was about. Someone a tambon outside the alert,
-- upstream on the same river, had no way to see that the warning next to them follows the water
-- they live on.
--
-- Two things this deliberately does NOT do:
--
--   * **It does not compute a level.** The columns are the zone's name, its basin, its tambon
--     codes and its outline - nothing else. The level is worked out in the browser from the live
--     alerts it already holds (`public_alert_status`), by the same `alertForTambon()` that colours
--     the tambons. So the outline and the tambons inside it can never disagree about what is in
--     force: there is one definition of "in force", not a second one here.
--   * **It is not security definer.** `warning_zones` and `warning_zone_tambons` are already
--     readable by `anon` (20260929120100_geography.sql), as the tambon boundaries are. This
--     function exists to turn the geometry into GeoJSON in one round trip, not to reach past RLS,
--     so it runs as the caller and a future narrowing of those tables narrows this too.
--
-- The geometry is sent whole. Measured on jaga-dev: the three zones are 1,027 points and 20 KB of
-- GeoJSON at five decimals, and `st_simplifypreservetopology` at 50 m and at 100 m removes not one
-- point - the stored outlines are already coarser than that. Simplifying would cost accuracy and
-- save nothing, so it is not done (the dam zone, which is a fine raster-derived boundary, does
-- simplify; this is a basin made of whole tambons).
create function public.warning_zone_map()
returns table (
  id uuid, name jsonb, basin text, hazard_type public.hazard_type, tambons text[], geom json
)
language sql stable set search_path = '' as $$
  select z.id, z.name, z.basin, z.hazard_type,
         coalesce((select array_agg(t.tambon_code order by t.tambon_code)
                   from public.warning_zone_tambons t where t.zone_id = z.id), '{}'),
         extensions.st_asgeojson(z.geom, 5)::json
    from public.warning_zones z
   -- A zone with no outline cannot be drawn. It is left out rather than sent as a null, so the
   -- client never has to decide what an empty shape means.
   where z.geom is not null
   order by z.basin
$$;
grant execute on function public.warning_zone_map() to anon, authenticated;
