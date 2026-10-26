-- A reservoir simply being full now grades as something (the owner, 26 Oct 2026).
--
-- The five Royal Irrigation Department reservoirs publish one figure a day and no level. For all
-- five the capacity at normal high water *is* the full capacity, so S7's `above_normal_high` rule
-- could only ever fire above 100% - a reservoir at 99% and climbing graded as quiet, and nothing
-- pointed at it. That is the case the owner asked about: Khlong Chamrai went from 42.8% on 12
-- October to 55.8% on 24 October 2026 with the season's rain still to come, and an irrigation
-- reservoir that is full has to pass on whatever arrives.
--
-- Two rules, both per dam and both in `dams.grades` so admins own the numbers (the seed
-- supabase/seed/43_dam_spill_zone.sql sets 80 and 95 for the five):
--
--   near_full_pct     at or above this share of capacity: watchful, reason `near_full`. The app's
--                     own quiet notice, with its disclaimer.
--   full_pct          at or above this share *and still filling*: releasing, reason
--                     `full_and_rising`. That raises a row on the war room for the admins, who
--                     review it and send the alert themselves. Code still never publishes
--                     anything (safety rule 2).
--
-- "Still filling" is the rise the function already works out over the dam's own window, so on a
-- daily feed it means "more water in it than yesterday". A dam with neither key set is untouched:
-- Bang Lang keeps grading on spill, outflow, inflow and its own normal high water, which for it
-- is a real level well below full.
--
-- Same signature and columns as 20261014083000; two reasons are added to the array it returns,
-- and lib/dam.ts lists them in the order the app shows them.

create or replace function public.dam_signal(p_dam text)
returns table (
  observed_at timestamptz, fetched_at timestamptz,
  storage_mcm double precision, percent_full double precision, level_m double precision,
  inflow_cms double precision, released_cms double precision, spilled_cms double precision,
  outflow_cms double precision,
  rise_mcm_per_h double precision, rise_window_h integer,
  grade public.dam_grade, reasons text[], awaiting text[],
  readings integer, stale boolean, confirmed_over integer
)
language plpgsql stable security definer set search_path = '' as $$
-- Output column names shadow the columns they come from ('storage_mcm is
-- ambiguous'); the column always wins here, as in the version this replaces.
#variable_conflict use_column
declare
  -- The shared defaults, with this dam's own rules on top: jsonb concat lets a dam override one
  -- key and inherit the rest.
  g jsonb;
  v_turbine double precision;
  v_inflow double precision;
  v_rise double precision;
  v_window integer;
  v_stale integer;
  v_consecutive integer;
  v_release_reason text;
  v_normal double precision;
  v_max double precision;
  -- The two shares of capacity, as storage in million m3 so every test below is one comparison.
  -- Unset means "never": a share no reservoir can reach rather than a null to guard at each use.
  v_near_full double precision;
  v_full double precision;
begin
  select coalesce((select s.value from public.system_settings s where s.key = 'dam_grades'),
                  '{}'::jsonb) || coalesce(d.grades, '{}'::jsonb),
         d.storage_normal_mcm, d.storage_max_mcm
    into g, v_normal, v_max
    from public.dams d where d.code = p_dam;
  if not found then
    return;
  end if;
  v_turbine := coalesce((g ->> 'turbine_max_cms')::double precision, 160);
  v_inflow := coalesce((g ->> 'inflow_high_cms')::double precision, 500);
  v_rise := coalesce((g ->> 'rise_mcm_per_h')::double precision, 4.0);
  v_window := greatest(coalesce((g ->> 'rise_window_h')::integer, 6), 1);
  v_stale := coalesce((g ->> 'stale_after_h')::integer, 6);
  v_consecutive := greatest(coalesce((g ->> 'min_consecutive_h')::integer, 2), 1);
  -- A reservoir with no power station has no "above the turbines": the same rule is then the
  -- plain one, that it is letting a lot of water go.
  v_release_reason := case when (g ->> 'release_reason') = 'release_high' then 'release_high'
                           else 'above_turbines' end;
  v_near_full := case when v_max > 0 and (g ? 'near_full_pct')
                      then v_max * (g ->> 'near_full_pct')::double precision / 100 end;
  v_full := case when v_max > 0 and (g ? 'full_pct')
                 then v_max * (g ->> 'full_pct')::double precision / 100 end;

  return query
  with recent as (
    select r.*,
           coalesce(public.mcm_over_hours_to_cms(r.released_mcm_h, r.window_h), 0)
             + coalesce(public.mcm_over_hours_to_cms(r.spilled_mcm_h, r.window_h), 0) as outflow,
           public.mcm_over_hours_to_cms(r.inflow_mcm_h, r.window_h) as inflow_rate,
           row_number() over (order by r.observed_at desc) as back
      from public.dam_readings r
     where r.dam_code = p_dam
     order by r.observed_at desc
     limit (v_consecutive + v_window + 2)
  ),
  risen as (
    select recent.*,
           case when lag(storage_mcm, v_window) over w is null or storage_mcm is null then null
                else (storage_mcm - lag(storage_mcm, v_window) over w)
                     / greatest(extract(epoch from (observed_at
                                                    - lag(observed_at, v_window) over w))
                                / 3600.0, 1)
           end as rise
      from recent
    window w as (order by observed_at)
  ),
  tested as (
    select risen.*,
           (coalesce(spilled_mcm_h, 0) > 0
            or outflow > v_turbine
            -- Full and still filling. The rise must be positive, not merely not falling: a
            -- reservoir held steady at the top of its range is watchful, not releasing.
            or (v_full is not null and storage_mcm >= v_full
                and coalesce(rise, 0) > 0)) as is_releasing,
           (storage_mcm > v_normal
            or coalesce(inflow_rate, 0) > v_inflow
            or coalesce(rise, 0) > v_rise
            or (v_near_full is not null and storage_mcm >= v_near_full)) as is_watchful
      from risen
  ),
  latest as (select * from tested where back = 1),
  held as (
    select bool_and(is_releasing) filter (where back <= v_consecutive) as releasing_held,
           bool_and(is_watchful) filter (where back <= v_consecutive) as watchful_held,
           count(*) filter (where back <= v_consecutive) as have
      from tested
  )
  select l.observed_at, l.fetched_at, l.storage_mcm,
         case when v_max > 0 then round((l.storage_mcm / v_max * 100)::numeric, 1)::double precision
              end,
         l.level_m,
         l.inflow_rate,
         public.mcm_over_hours_to_cms(l.released_mcm_h, l.window_h),
         public.mcm_over_hours_to_cms(l.spilled_mcm_h, l.window_h),
         l.outflow,
         round(l.rise::numeric, 2)::double precision, v_window,
         case
           when h.have >= v_consecutive and h.releasing_held then 'releasing'::public.dam_grade
           when h.have >= v_consecutive and h.watchful_held then 'watchful'::public.dam_grade
           else 'quiet'::public.dam_grade
         end,
         (select array_remove(array[
            case when coalesce(l.spilled_mcm_h, 0) > 0 and h.releasing_held then 'spilling' end,
            case when l.outflow > v_turbine and h.releasing_held then v_release_reason end,
            case when v_full is not null and l.storage_mcm >= v_full
                      and coalesce(l.rise, 0) > 0 and h.releasing_held
                 then 'full_and_rising' end,
            case when l.storage_mcm > v_normal and h.watchful_held then 'above_normal_high' end,
            -- Said once: a reservoir past the releasing share is already past this one, and
            -- `full_and_rising` above says more.
            case when v_near_full is not null and l.storage_mcm >= v_near_full
                      and not (v_full is not null and l.storage_mcm >= v_full
                               and coalesce(l.rise, 0) > 0)
                      and h.watchful_held
                 then 'near_full' end,
            case when coalesce(l.inflow_rate, 0) > v_inflow
                      and h.watchful_held then 'inflow_high' end,
            case when coalesce(l.rise, 0) > v_rise and h.watchful_held then 'rising_fast' end
          ], null)),
         (select array_remove(array[
            case when l.is_releasing and not coalesce(h.releasing_held, false)
                 then 'release_unconfirmed' end,
            case when l.is_watchful and not coalesce(h.watchful_held, false)
                 then 'watch_unconfirmed' end
          ], null)),
         (select count(*)::integer from tested),
         l.observed_at < now() - make_interval(hours => v_stale),
         v_consecutive
    from latest l, held h;
end $$;
grant execute on function public.dam_signal(text) to anon, authenticated;
