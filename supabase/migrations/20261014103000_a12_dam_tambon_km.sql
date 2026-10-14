-- How far down the river a tambon actually is.
--
-- `dam_tambons.km_from_dam` has been the **reach's** own distance from the dam, so every tambon
-- the main stem runs through read 0 km - Hat Yai as near the reservoir as the village below the
-- wall. It did not show while Bang Lang was the only dam (its arrival ranges are measured by the
-- pipeline, which computes river distance itself), but the app sorts by this column to decide
-- which of someone's places is nearest the dam, and with six dams it decides which reservoir a
-- home screen carries.
--
-- Now it is the distance along the reach to where the water **first enters that tambon**: the
-- reach's own start plus the earliest point of the intersection along the line.
create or replace function public.dam_tambons_rebuild(p_dam text, p_source text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  delete from public.dam_tambons where dam_code = p_dam and source = p_source;
  insert into public.dam_tambons (dam_code, source, tambon_code, via, km_from_dam)
  select p_dam, p_source, hit.code,
         -- The river itself outranks a tributary: a tambon the main stem runs through is named
         -- for that, even when a tributary also clips it.
         case when bool_or(hit.kind in ('main', 'outlet')) then 'main'::public.dam_reach_kind
              else 'tributary'::public.dam_reach_kind end,
         min(hit.km)
    from (
      select t.code, r.kind,
             r.km_from_dam + coalesce(
               (select min(extensions.st_linelocatepoint(r.line, p.geom))
                  from extensions.st_dumppoints(
                         extensions.st_intersection(r.line, t.geom)) as p), 0) * r.length_km
               as km
        from public.tambons t
        join public.dam_reaches r
          on r.dam_code = p_dam and r.source = p_source
         and extensions.st_intersects(t.geom, r.line)
    ) hit
   group by hit.code;
  select count(*) into v_rows from public.dam_tambons
   where dam_code = p_dam and source = p_source;
  return v_rows;
end $$;
revoke execute on function public.dam_tambons_rebuild(text, text) from public, anon, authenticated;
