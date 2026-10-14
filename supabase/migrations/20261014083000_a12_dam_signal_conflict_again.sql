-- The replacement in 20261014081500 lost the `#variable_conflict use_column` pragma that
-- 20261009230500 added, so dam_signal failed with "column reference storage_mcm is
-- ambiguous" on every call. Same function, pragma restored. An applied migration is never
-- edited, hence a second file.

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
           (coalesce(spilled_mcm_h, 0) > 0 or outflow > v_turbine) as is_releasing,
           (storage_mcm > v_normal
            or coalesce(inflow_rate, 0) > v_inflow
            or coalesce(rise, 0) > v_rise) as is_watchful
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
            case when l.storage_mcm > v_normal and h.watchful_held then 'above_normal_high' end,
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
