-- The automated alarm, armed for the five irrigation reservoirs (the owner, 27 Oct 2026).
--
-- A gauge or a reservoir only raises a draft if an admin has ticked it (migration
-- 20261014093100 for the gauges, 20261027023000 for the reservoirs). The owner asked on 27 Oct
-- 2026 for the reservoirs to work the same way as the river gauges and not to be asked again
-- about the figures, so they are armed here rather than left for a tap: in a seed, so that a
-- rebuild of the database does not quietly disarm them.
--
-- Bang Lang is deliberately **not** armed. It is EGAT's, it has four river gauges below it, and
-- its releases are an operator's decision that an admin sends the notice for
-- (`admin_send_dam_release`). The five here are the Royal Irrigation Department's, publish once a
-- day, have no gauge below them at all, and are the ones whose filling up nothing was watching.
--
-- What being armed means, in full: at or above `full_pct` of capacity (95%) **and still filling**,
-- a draft goes to every admin's phone with the reviewed words of `reservoir_full_warning`, naming
-- the tambons of the reservoir's own overflow zone. If no admin sends or dismisses it within the
-- grace time, Jaga publishes that draft itself, marked as issued without review and written to
-- `audit_log`. If the reservoir has stopped filling by then, nothing is published. When the water
-- is clearly back down and the alert has stood six hours, the same road carries the all-clear
-- (migration 20261027034500).
--
-- To disarm one: `select public.admin_set_auto_alarm_dam('<code>', false);` as an admin, or set
-- `enabled = false` here and load this file again.

insert into public.auto_alarm_dams (dam_code, enabled, set_by, set_at)
  select d.code, true,
         (select p.user_id from public.profiles p
           where p.role = 'super_admin' order by p.created_at limit 1),
         now()
    from public.dams d
   where d.operator = 'RID'
     -- Never arm a reservoir with nobody to warn: without a zone the draft could not be filled
     -- in, and `auto_alarm_check` would skip it anyway.
     and exists (select 1 from public.dam_tambons t
                  where t.dam_code = d.code and t.source = d.geometry_source)
on conflict (dam_code) do update
  set enabled = excluded.enabled, set_by = excluded.set_by, set_at = now();

insert into public.audit_log (actor, action, entity, entity_id, details)
  select (select p.user_id from public.profiles p
           where p.role = 'super_admin' order by p.created_at limit 1),
         'auto_alarm_on', 'dams', null,
         jsonb_build_object('all', true, 'reservoirs',
                            (select count(*) from public.auto_alarm_dams where enabled),
                            'by', 'supabase/seed/44_auto_alarm_dams.sql');
