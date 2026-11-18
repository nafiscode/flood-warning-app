-- SITREP for a verified unit (owner, 18 Nov 2026): a situation report a team or agency can print,
-- file or send on, covering its own area over a chosen period.
--
-- Counts only. Nothing in it is personal data: no point, phone, name, free text or photo of a
-- requester, reporter or household, and no team position (safety rules 5 and 6). That is what
-- lets it travel beyond the team - a SITREP is forwarded by design.
--
-- Who: the owner or an active dispatcher of a VERIFIED unit, for that unit's own coverage. A unit
-- that only runs a dam or only plans (unit_is_office_only) is not a team in the field and gets
-- none, like every other team read. Admins have their own exports. Every generation is in
-- audit_log with the unit and the period.

create function public.unit_sitrep(p_unit uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
-- Volatile, not stable: it writes the read to audit_log.
language plpgsql security definer set search_path = '' as $fn$
declare
  u public.authority_units;
  v_tambons text[];
  v_provinces text[];
  v_out jsonb;
begin
  select * into u from public.authority_units where id = p_unit;
  if u.id is null
     or u.status <> 'verified'
     or public.unit_is_office_only(u.capabilities)
     or not public.is_my_unit(p_unit) then
    raise exception 'Not allowed to read this unit''s report' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '7 days'
     or p_to > now() + interval '5 minutes' then
    raise exception 'A report covers up to seven days that have already passed'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct c.tambon), '{}') into v_tambons
    from public.authority_coverage c where c.unit_id = p_unit;
  select coalesce(array_agg(distinct t.province_code), '{}') into v_provinces
    from public.tambons t where t.code = any (v_tambons);

  with
  area as (
    select t.code, t.name_th, t.name_en, d.name_th as district_th, d.name_en as district_en,
           p.name_th as province_th, p.name_en as province_en, t.province_code
      from public.tambons t
      join public.districts d on d.code = t.district_code
      join public.provinces p on p.code = t.province_code
     where t.code = any (v_tambons)
  ),
  sos as (
    select s.*, (r.suspected_spam and r.spam_dismissed_at is null) as spam
      from public.sos_requests s
      left join public.sos_review r on r.sos_id = s.id
     where s.tambon = any (v_tambons)
  ),
  sos_tambon as (
    select s.tambon,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null) as new_cases,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null and s.kind = 'rescue') as new_rescue,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null and s.kind = 'supplies') as new_supplies,
           coalesce(sum(s.people_count) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null), 0) as new_people,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null
                              and s.vulnerable_flags is not null
                              and s.vulnerable_flags <> '{}'::jsonb
                              and s.vulnerable_flags <> 'null'::jsonb) as new_vulnerable,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is null and coalesce(s.spam, false)) as new_spam,
           count(*) filter (where s.created_at >= p_from and s.created_at < p_to
                              and s.duplicate_of is not null) as merged,
           count(*) filter (where s.duplicate_of is null and s.created_at < p_to
                              and (s.closed_at is null or s.closed_at >= p_to)
                              and s.status in ('received', 'assigned', 'en_route', 'on_site'))
             as open_now,
           count(*) filter (where s.duplicate_of is null and s.created_at < p_to
                              and (s.closed_at is null or s.closed_at >= p_to)
                              and s.status = 'received') as waiting_now,
           count(*) filter (where s.closed_at >= p_from and s.closed_at < p_to
                              and s.status = 'rescued') as closed_rescued,
           count(*) filter (where s.closed_at >= p_from and s.closed_at < p_to
                              and s.status = 'safe_cancelled') as closed_safe,
           count(*) filter (where s.closed_at >= p_from and s.closed_at < p_to
                              and s.status = 'dismissed') as closed_dismissed
      from sos s
     group by s.tambon
  ),
  rescues as (
    select f.tambon, count(*) as records, coalesce(sum(f.people_count), 0) as people
      from public.field_rescues f
     where f.tambon = any (v_tambons) and f.status <> 'rejected'
       and f.created_at >= p_from and f.created_at < p_to
     group by f.tambon
  ),
  reps as (
    select r.tambon, count(*) as reports,
           count(*) filter (where r.depth_ref in ('waist', 'chest', 'above_head', 'roof')) as deep,
           count(*) filter (where r.road_access = 'impassable') as roads_cut,
           count(*) filter (where r.trend = 'rising') as rising,
           max(array_position(array['dry','ankle','knee','waist','chest','above_head','roof'],
                              r.depth_ref::text)) as worst_rank
      from public.reports r
     where r.tambon = any (v_tambons) and r.moderation_status <> 'hidden'
       and r.created_at >= p_from and r.created_at < p_to
     group by r.tambon
  ),
  alerts_now as (
    select a.id, a.level, a.hazard_type, a.reason, a.issued_at, a.next_update_at,
           (a.signals_snapshot ->> 'kind') = 'auto_alarm' as automatic,
           (select array_agg(at.tambon order by at.tambon) from public.alert_tambons at
             where at.alert_id = a.id and at.tambon = any (v_tambons)) as tambons
      from public.alerts a
     where a.superseded_by is null and a.cancelled_at is null and not a.is_drill
       and a.issued_at < p_to
       and exists (select 1 from public.alert_tambons at
                    where at.alert_id = a.id and at.tambon = any (v_tambons))
  ),
  alerts_period as (
    select a.level, count(*) as n
      from public.alerts a
     where not a.is_drill and a.issued_at >= p_from and a.issued_at < p_to
       and exists (select 1 from public.alert_tambons at
                    where at.alert_id = a.id and at.tambon = any (v_tambons))
     group by a.level
  ),
  places as (
    select sp.id, sp.name, sp.type::text as type, sp.status::text as status, sp.capacity,
           sp.checked_at, sp.tambon, sp.verification_status::text as verification
      from public.safe_places sp
     where sp.tambon = any (v_tambons)
  ),
  gauges as (
    select ss.code, ss.name, ss.basin, ss.value, ss.observed_at, ss.status, ss.rise_3h, ss.bank_m
      from public.station_status() ss
      join public.stations st on st.id = ss.id
     where exists (select 1 from public.provinces p
                    where p.code = any (v_provinces)
                      and extensions.st_covers(p.geom, st.point))
  )
  select jsonb_build_object(
    'unit', jsonb_build_object(
      'id', u.id, 'name', u.unit_name,
      'org', (select o.name from public.organizations o where o.id = u.org_id),
      'capabilities', to_jsonb(u.capabilities)),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'area', jsonb_build_object(
      'tambons', cardinality(v_tambons),
      'districts', (select count(distinct a.district_th) from area a),
      'provinces', coalesce((select jsonb_agg(distinct jsonb_build_object(
                       'th', a.province_th, 'en', a.province_en)) from area a), '[]')),
    'alerts_now', coalesce((select jsonb_agg(jsonb_build_object(
        'level', an.level, 'hazard', an.hazard_type, 'reason', an.reason,
        'issued_at', an.issued_at, 'next_update_at', an.next_update_at,
        'stale', an.next_update_at is not null and an.next_update_at < p_to,
        'automatic', coalesce(an.automatic, false),
        'tambons', (select jsonb_agg(jsonb_build_object('th', a.name_th, 'en', a.name_en)
                                     order by a.name_th)
                      from area a where a.code = any (an.tambons)))
        order by public.alert_rank(an.level) desc, an.issued_at desc)
      from alerts_now an), '[]'),
    'alerts_issued', coalesce((select jsonb_object_agg(ap.level, ap.n) from alerts_period ap), '{}'),
    'sos', jsonb_build_object(
      'new_cases', coalesce((select sum(new_cases) from sos_tambon), 0),
      'new_rescue', coalesce((select sum(new_rescue) from sos_tambon), 0),
      'new_supplies', coalesce((select sum(new_supplies) from sos_tambon), 0),
      'new_people', coalesce((select sum(new_people) from sos_tambon), 0),
      'new_vulnerable', coalesce((select sum(new_vulnerable) from sos_tambon), 0),
      'new_spam', coalesce((select sum(new_spam) from sos_tambon), 0),
      'merged', coalesce((select sum(merged) from sos_tambon), 0),
      'open_now', coalesce((select sum(open_now) from sos_tambon), 0),
      'waiting_now', coalesce((select sum(waiting_now) from sos_tambon), 0),
      'closed_rescued', coalesce((select sum(closed_rescued) from sos_tambon), 0),
      'closed_safe', coalesce((select sum(closed_safe) from sos_tambon), 0),
      'closed_dismissed', coalesce((select sum(closed_dismissed) from sos_tambon), 0)),
    'field_rescues', jsonb_build_object(
      'records', coalesce((select sum(records) from rescues), 0),
      'people', coalesce((select sum(people) from rescues), 0)),
    'reports', jsonb_build_object(
      'reports', coalesce((select sum(reports) from reps), 0),
      'deep', coalesce((select sum(deep) from reps), 0),
      'roads_cut', coalesce((select sum(roads_cut) from reps), 0),
      'rising', coalesce((select sum(rising) from reps), 0)),
    -- Only tambons where something happened: a province is a few hundred rows otherwise.
    'by_tambon', coalesce((select jsonb_agg(jsonb_build_object(
        'code', a.code, 'th', a.name_th, 'en', a.name_en,
        'district_th', a.district_th, 'district_en', a.district_en,
        'level', (select an.level from alerts_now an where a.code = any (an.tambons)
                   order by public.alert_rank(an.level) desc limit 1),
        'new_cases', coalesce(st.new_cases, 0), 'new_people', coalesce(st.new_people, 0),
        'open_now', coalesce(st.open_now, 0), 'waiting_now', coalesce(st.waiting_now, 0),
        'closed_rescued', coalesce(st.closed_rescued, 0),
        'field_people', coalesce(fr.people, 0),
        'reports', coalesce(rp.reports, 0), 'roads_cut', coalesce(rp.roads_cut, 0),
        'worst_depth', (array['dry','ankle','knee','waist','chest','above_head','roof'])[rp.worst_rank])
        order by a.province_th, a.district_th, a.name_th)
      from area a
      left join sos_tambon st on st.tambon = a.code
      left join rescues fr on fr.tambon = a.code
      left join reps rp on rp.tambon = a.code
     where coalesce(st.new_cases, 0) + coalesce(st.open_now, 0) + coalesce(st.merged, 0)
           + coalesce(st.closed_rescued, 0) + coalesce(st.closed_safe, 0)
           + coalesce(st.closed_dismissed, 0) + coalesce(fr.records, 0)
           + coalesce(rp.reports, 0) > 0
        or exists (select 1 from alerts_now an where a.code = any (an.tambons))), '[]'),
    'places', jsonb_build_object(
      'open', (select count(*) from places where status = 'open'),
      'full', (select count(*) from places where status = 'full'),
      'closed', (select count(*) from places where status = 'closed'),
      'unknown', (select count(*) from places where status = 'unknown'),
      'capacity_open', coalesce((select sum(capacity) from places where status = 'open'), 0),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'name', pl.name, 'type', pl.type, 'status', pl.status, 'capacity', pl.capacity,
          'checked_at', pl.checked_at,
          'tambon_th', a.name_th, 'tambon_en', a.name_en)
          order by pl.status, a.name_th)
        from places pl join area a on a.code = pl.tambon
       where pl.status in ('open', 'full')), '[]')),
    'gauges', coalesce((select jsonb_agg(jsonb_build_object(
        'code', g.code, 'name', g.name, 'basin', g.basin, 'value', g.value,
        'observed_at', g.observed_at, 'status', g.status, 'rise_3h', g.rise_3h, 'bank_m', g.bank_m)
        order by g.basin, g.code)
      from gauges g), '[]')
  ) into v_out;

  perform public.log_access('read_sitrep', 'authority_units', p_unit::text,
                            jsonb_build_object('from', p_from, 'to', p_to));
  return v_out;
end $fn$;

revoke all on function public.unit_sitrep(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.unit_sitrep(uuid, timestamptz, timestamptz) to authenticated;

comment on function public.unit_sitrep(uuid, timestamptz, timestamptz) is
  'SITREP for a verified field unit''s own coverage over up to seven days: counts only, no '
  'personal data. Owner or active dispatcher. Logged as read_sitrep. 18 Nov 2026.';
