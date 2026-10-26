-- The reservoirs get what the river gauges have: thresholds an admin can change, and a tick for
-- the automatic alarm (the owner, 27 Oct 2026).
--
-- The rules of 20261027011500 and the arming of supabase/seed/44_auto_alarm_dams.sql were set
-- from the laptop, which left the owner unable to change either from a screen. A threshold nobody
-- but a developer can move is not a threshold the people who run this app own, and the owner's
-- standing instruction is the opposite: the figures live in the database and the admins own them
-- (safety rule 2's habit, and the same choice as `admin_set_gauge_levels` for a gauge).
--
-- Two functions, both admin-only and both logged:
--
--   admin_set_dam_levels     the two shares of capacity, as percentages. Clearing both takes the
--                            rules off that reservoir, which is the honest way to say "do not
--                            grade this one on how full it is" - it keeps grading on release,
--                            inflow and rise as it always did.
--   admin_dam_levels         what the console draws: every reservoir with its live figure, its
--                            two thresholds, whether the alarm is armed, and how many tambons its
--                            zone would warn.
--
-- `admin_set_auto_alarm_dam` already exists (20261027023000); nothing here changes it.

create function public.admin_set_dam_levels(
  p_dam text, p_near_full_pct double precision, p_full_pct double precision,
  p_note text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := now();
  v_old jsonb;
  v_new jsonb;
begin
  perform public.admin_only();
  select coalesce(d.grades, '{}'::jsonb) into v_old from public.dams d where d.code = p_dam;
  if not found then
    raise exception 'no such reservoir' using errcode = 'no_data_found';
  end if;
  -- A share of capacity. Above 100 is allowed because a reservoir can be reported over its
  -- capacity at normal high water, which is what the figure is a share of.
  if (p_near_full_pct is not null and (p_near_full_pct <= 0 or p_near_full_pct > 150))
     or (p_full_pct is not null and (p_full_pct <= 0 or p_full_pct > 150)) then
    raise exception 'a share of capacity is between 1 and 150 per cent'
      using errcode = 'check_violation';
  end if;
  -- Watchful cannot sit above the share that raises a draft: the quiet notice has to come first.
  if p_near_full_pct is not null and p_full_pct is not null and p_near_full_pct > p_full_pct then
    raise exception 'the watchful share cannot be higher than the share that raises a draft'
      using errcode = 'check_violation';
  end if;

  v_new := (v_old - 'near_full_pct' - 'full_pct')
    || case when p_near_full_pct is null then '{}'::jsonb
            else jsonb_build_object('near_full_pct', p_near_full_pct) end
    || case when p_full_pct is null then '{}'::jsonb
            else jsonb_build_object('full_pct', p_full_pct) end;
  update public.dams set grades = v_new, updated_at = v_at where code = p_dam;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'dam_levels_set', 'dams', null,
            jsonb_build_object('dam', p_dam, 'note', p_note,
                               'was', jsonb_build_object(
                                 'near_full_pct', v_old -> 'near_full_pct',
                                 'full_pct', v_old -> 'full_pct'),
                               'now', jsonb_build_object(
                                 'near_full_pct', p_near_full_pct,
                                 'full_pct', p_full_pct)));
  return v_at;
end $$;
revoke all on function public.admin_set_dam_levels(text, double precision, double precision, text)
  from public, anon;
grant execute on function public.admin_set_dam_levels(text, double precision, double precision, text)
  to authenticated;

-- What the console draws. One row per reservoir, newest reading included, so the screen does not
-- have to ask three functions and line them up itself.
create function public.admin_dam_levels()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_only();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."storageMaxMcm" desc nulls last)
      from (
        select d.code, d.name, d.operator, d.feed,
               d.storage_max_mcm as "storageMaxMcm",
               d.storage_normal_mcm as "storageNormalMcm",
               -- The shares this reservoir is graded on. Null means the rules are off for it.
               (d.grades ->> 'near_full_pct')::double precision as "nearFullPct",
               (d.grades ->> 'full_pct')::double precision as "fullPct",
               coalesce(a.enabled, false) as auto,
               a.set_at as "autoSetAt",
               p.display_name as "autoSetBy",
               (select count(*)::integer from public.dam_tambons t
                 where t.dam_code = d.code and t.source = d.geometry_source) as tambons,
               (select row_to_json(s) from public.dam_signal(d.code) s) as signal
          from public.dams d
          left join public.auto_alarm_dams a on a.dam_code = d.code
          left join public.profiles p on p.user_id = a.set_by
      ) x), '[]'::jsonb);
end $$;
revoke execute on function public.admin_dam_levels() from public, anon;
grant execute on function public.admin_dam_levels() to authenticated;
