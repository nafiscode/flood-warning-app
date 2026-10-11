-- A12 (addition, 11 Oct 2026, the owner's request): the mean flow of the last day and the volume
-- of water behind it, shown beside the dam's hourly figures.
--
-- Why this belongs next to the hourly reading rather than instead of it. The published hourly
-- figures are volumes for that hour, and they jump about: on 11 Oct the newest hour said the dam
-- was releasing nothing at all, while the day behind it had passed 3.98 million m3 downstream, a
-- mean of 46 m3/s. The inflow figure is a residual of the storage balance, so single hours even
-- come out negative (-0.36 Mm3/h in that same day). A day's sum is the figure an operator or a
-- hydrologist reads, and on its own the latest hour can say the opposite of what the day did.
--
-- Everything here is arithmetic on the readings we already store: no new feed, no new request,
-- nothing fetched. The window ends at the **newest reading**, not at now(), because the feed lags
-- by hours; the screen prints that reading's own hour and age beside these figures.
--
-- Nothing in here grades, raises a notice or sends anything. It is the same quiet record as the
-- rest of the dam's figures (safety rules 2 and 8).

-------------------------------------------------------------------------------
-- The last p_hours of published readings, summed. One row, or none when the dam has no readings.
-------------------------------------------------------------------------------
create function public.dam_daily(p_dam text, p_hours integer default 24)
returns table (
  window_h integer,
  -- The newest reading the window ends at, so a caller can say which day this is.
  until timestamptz,
  -- Hours counted per variable, because the feed can publish one and not the other. A mean is
  -- always over the hours that exist, and the count travels with it: a "daily mean" resting on
  -- three hours must say so (safety rule 8).
  inflow_hours integer,
  inflow_mean_cms double precision,
  inflow_mcm double precision,
  outflow_hours integer,
  outflow_mean_cms double precision,
  outflow_mcm double precision,
  spilled_mcm double precision
)
language sql stable security definer set search_path = '' as $$
  with newest as (
    select max(r.observed_at) as until from public.dam_readings r where r.dam_code = p_dam
  ),
  win as (
    select r.*
      from public.dam_readings r, newest n
     where r.dam_code = p_dam
       and n.until is not null
       and r.observed_at > n.until - make_interval(hours => greatest(p_hours, 1))
  ),
  summed as (
    select count(*) filter (where w.inflow_mcm_h is not null)::integer as inflow_hours,
           sum(w.inflow_mcm_h) as inflow_mcm,
           -- An hour counts for the outflow when either part of it was published; the parts
           -- themselves are added as nothing when missing, never as a guess.
           count(*) filter (where w.released_mcm_h is not null
                              or w.spilled_mcm_h is not null)::integer as outflow_hours,
           sum(coalesce(w.released_mcm_h, 0) + coalesce(w.spilled_mcm_h, 0))
             filter (where w.released_mcm_h is not null or w.spilled_mcm_h is not null)
             as outflow_mcm,
           sum(w.spilled_mcm_h) as spilled_mcm
      from win w
  )
  select greatest(p_hours, 1),
         (select n.until from newest n),
         s.inflow_hours,
         -- A volume in million m3 over the hours it covers, as cubic metres a second.
         case when s.inflow_hours > 0
              then s.inflow_mcm * 1000000.0 / (s.inflow_hours * 3600.0) end,
         s.inflow_mcm,
         s.outflow_hours,
         case when s.outflow_hours > 0
              then s.outflow_mcm * 1000000.0 / (s.outflow_hours * 3600.0) end,
         s.outflow_mcm,
         s.spilled_mcm
    from summed s
   where s.inflow_hours > 0 or s.outflow_hours > 0
$$;
grant execute on function public.dam_daily(text, integer) to anon, authenticated;

-------------------------------------------------------------------------------
-- The app's one read gains the day's figures beside the hourly ones. The output columns change,
-- so the function has to be dropped and made again rather than replaced.
-------------------------------------------------------------------------------
drop function public.dam_state(text);
create function public.dam_state(p_source text default 'osm')
returns table (
  code text, name jsonb, river jsonb, operator text,
  storage_max_mcm double precision, storage_normal_mcm double precision,
  geometry_note jsonb, signal json, daily json
)
language sql stable security definer set search_path = '' as $$
  select d.code, d.name, d.river, d.operator, d.storage_max_mcm, d.storage_normal_mcm,
         d.geometry_note,
         (select row_to_json(s) from public.dam_signal(d.code) s),
         (select row_to_json(x) from public.dam_daily(d.code) x)
    from public.dams d
   where d.geometry_source = p_source
$$;
grant execute on function public.dam_state(text) to anon, authenticated;
