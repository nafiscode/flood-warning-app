-- A12 part 1 (fix): dam_signal() could not run.
--
-- Its RETURNS TABLE columns are named after the readings they come from - storage_mcm,
-- observed_at, level_m - and plpgsql reads a bare name as the output parameter, so every call
-- failed with "column reference storage_mcm is ambiguous". Those names are what the app reads
-- as JSON keys, so they stay and the body now says a bare name means the column.
--
-- Only the body changes. The rules, the two tiers and the spike guard are as applied.

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
-- Several output columns are named after the columns they come from (storage_mcm,
-- observed_at, level_m). plpgsql reads a bare name as the output parameter and refuses the
-- query as ambiguous, so inside this body a bare name means the column.
#variable_conflict use_column
declare
  g jsonb := coalesce((select s.value from public.system_settings s where s.key = 'dam_grades'),
                      '{}'::jsonb);
  v_turbine double precision := coalesce((g ->> 'turbine_max_cms')::double precision, 160);
  v_inflow double precision := coalesce((g ->> 'inflow_high_cms')::double precision, 500);
  v_rise double precision := coalesce((g ->> 'rise_mcm_per_h')::double precision, 4.0);
  v_window integer := coalesce((g ->> 'rise_window_h')::integer, 6);
  v_stale integer := coalesce((g ->> 'stale_after_h')::integer, 6);
  v_consecutive integer := greatest(coalesce((g ->> 'min_consecutive_h')::integer, 2), 1);
  v_normal double precision;
  v_max double precision;
begin
  select d.storage_normal_mcm, d.storage_max_mcm into v_normal, v_max
    from public.dams d where d.code = p_dam;
  if not found then
    return;
  end if;

  return query
  with recent as (
    -- Enough rows to judge the rules on each of the last v_consecutive readings, each of which
    -- needs v_window readings behind it to have a rate of rise at all.
    select r.*,
           public.mcm_per_h_to_cms(coalesce(r.released_mcm_h, 0))
             + public.mcm_per_h_to_cms(coalesce(r.spilled_mcm_h, 0)) as outflow,
           row_number() over (order by r.observed_at desc) as back
      from public.dam_readings r
     where r.dam_code = p_dam
     order by r.observed_at desc
     limit (v_consecutive + v_window + 2)
  ),
  -- The rate of rise for *every* reading, not just the newest, so that it can be held to the
  -- same confirmation rule as the others. Null where there is not enough history behind it:
  -- a missing rate is never treated as zero rise, only as unknown.
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
           (coalesce(spilled_mcm_h, 0) > 0 or outflow > v_turbine) as is_releasing,
           (storage_mcm > v_normal
            or public.mcm_per_h_to_cms(coalesce(inflow_mcm_h, 0)) > v_inflow
            or coalesce(rise, 0) > v_rise) as is_watchful
      from risen
  ),
  latest as (select * from tested where back = 1),
  -- A rule counts once it has held for v_consecutive readings in a row. Every rule goes through
  -- here, the rate of rise included: the archive's 141 Mm3/h hour is exactly what this stops.
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
         public.mcm_per_h_to_cms(l.inflow_mcm_h),
         public.mcm_per_h_to_cms(l.released_mcm_h),
         public.mcm_per_h_to_cms(l.spilled_mcm_h),
         l.outflow,
         round(l.rise::numeric, 2)::double precision, v_window,
         case
           when h.have >= v_consecutive and h.releasing_held then 'releasing'::public.dam_grade
           when h.have >= v_consecutive and h.watchful_held then 'watchful'::public.dam_grade
           else 'quiet'::public.dam_grade
         end,
         -- Which rule fired, in the words the app looks up. Never a number on its own.
         (select array_remove(array[
            case when coalesce(l.spilled_mcm_h, 0) > 0 and h.releasing_held then 'spilling' end,
            case when l.outflow > v_turbine and h.releasing_held then 'above_turbines' end,
            case when l.storage_mcm > v_normal and h.watchful_held then 'above_normal_high' end,
            case when public.mcm_per_h_to_cms(coalesce(l.inflow_mcm_h, 0)) > v_inflow
                      and h.watchful_held then 'inflow_high' end,
            case when coalesce(l.rise, 0) > v_rise and h.watchful_held then 'rising_fast' end
          ], null)),
         -- Fired on the newest reading alone. Shown, but not graded on: the next reading decides.
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
