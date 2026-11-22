-- "Arm every gauge" leaves out the gauges whose raw level is not a flood.
--
-- On 22 Nov 2026, 17 stations were given the warning zone they physically stand in (the owner:
-- "Zone every unzoned gauge"), because `auto_alarm_check()` skips a station that has none. Zoning
-- arms nothing - `auto_alarm_gauges.enabled` is a separate tick - but it does widen what one
-- button reaches: `admin_set_auto_alarm(null, true)`, the owner's "arm all of them at once" of
-- 14 Oct, arms every station that HAS a zone. Measured the same day, that went from 13 stations to
-- 30, and 8 of the newcomers are gauges the tide or a dam's turbines move: BLGTD01, BLGTD02,
-- BLGTD05, BLGTU05, BLGTU06, FOP045, PAT001 and ONE037.
--
-- Why that matters is already decided, on figures, earlier the same day. SLA005 ปากรอ was left
-- unarmed because its daily high tide reaches its Evacuate level: its highest reading in 3,652 is
-- 0.97 m, which IS that level, and it touched it at 08:20 that morning. BLGTD05 at the Pattani
-- city bridge has a Warning of 1.05 m and the same shape of problem. Arming those on their raw
-- stage would publish an Evacuate from a high tide, and a false Evacuate costs the trust every
-- later alert depends on.
--
-- So the bulk arm now covers only the stations Module 11 keeps - the harmonic fit's tide-free set,
-- the same test the week trend and the season state use, so the three cannot disagree about which
-- gauges mean what they read.
--
-- Three things this deliberately does NOT do:
--   * It does not stop an admin arming any single gauge by hand. The owner has X.77 armed on
--     purpose, a gauge below a hydropower station, and that stays exactly as it is. Choosing one
--     gauge is a judgement; sweeping thirty is not the place to make it.
--   * It does not narrow turning them OFF. `p_enabled = false` still reaches every station,
--     because nothing should ever make disarming harder than arming.
--   * It changes no threshold and no alert. Which gauges are armed decides what the alarm looks
--     at; it cannot change what the alarm says about a gauge it is looking at.
--
-- One fallback, so this cannot fail silently: `season_baseflow` is loaded by seed 61 from
-- `season_state run`. If that table is empty - a fresh database, a seed not yet loaded - every
-- station would look tidal and the button would arm nobody. In that case the old rule stands
-- (every station with a zone), because an empty reference table means "not measured", never
-- "all of them are tidal" (safety rule 10's habit).

create or replace function public.admin_set_auto_alarm(p_station uuid, p_enabled boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  skipped integer := 0;
  -- Has the tide-free reference been loaded at all?
  measured boolean := exists (select 1 from public.season_baseflow);
begin
  perform public.admin_only();

  if p_station is null and p_enabled and measured then
    select count(*) into skipped
      from public.stations s
     where s.zone_id is not null
       and not exists (select 1 from public.season_baseflow b where b.station_id = s.id);
  end if;

  insert into public.auto_alarm_gauges (station_id, enabled, set_by, set_at)
    select s.id, p_enabled, auth.uid(), now() from public.stations s
     where (p_station is null and s.zone_id is not null
            -- Sweeping them all on reaches only the gauges whose reading is the river, not the
            -- sea or a turbine. Turning them all off reaches every one of them.
            and (not p_enabled or not measured
                 or exists (select 1 from public.season_baseflow b
                             where b.station_id = s.id)))
        or s.id = p_station
  on conflict (station_id) do update set enabled = excluded.enabled, set_by = excluded.set_by,
                                         set_at = excluded.set_at;
  get diagnostics n = row_count;

  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), case when p_enabled then 'auto_alarm_on' else 'auto_alarm_off' end,
            'stations', p_station,
            jsonb_build_object('all', p_station is null, 'gauges', n,
                               -- How many the sweep left alone, so the figure in the log explains
                               -- itself a season later.
                               'skipped_tidal', skipped));
  return n;
end $$;
