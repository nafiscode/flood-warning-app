-- The numbers already written down about the two free plans, so the plan page (/admin/plans) opens
-- with something to read: the owner's 24 Oct dashboard readings (docs/runbook.md) and the two
-- warning emails of 27 Nov 2026. Typed by hand from those sources, not measured here.
--
-- Safe to load twice: a row is added only when the same meter has no reading at that moment.
-- Vercel's billing cycle is not known to Jaga, so its rows carry no reset date; an admin adds one
-- with the next reading. Supabase's runs 28th to 28th (runbook).
insert into public.plan_readings (service, meter, value, read_at, resets_on, note)
select v.service, v.meter, v.value, v.read_at::timestamptz, v.resets_on::date, v.note
  from (values
    ('vercel',   'active_cpu',     1.8667,  '2026-10-24 09:00+00', null,         'runbook 24 Oct: 1 h 52 m (47%)'),
    ('vercel',   'transfer',       3.6,     '2026-10-24 09:00+00', null,         'runbook 24 Oct: 3.6 GB (3.6%)'),
    ('vercel',   'cdn_requests',   192000,  '2026-10-24 09:00+00', null,         'runbook 24 Oct: 192k (19%)'),
    ('vercel',   'function_calls', 94000,   '2026-10-24 09:00+00', null,         'runbook 24 Oct: 94k (9%)'),
    ('vercel',   'active_cpu',     3.0,     '2026-11-27 09:00+00', null,         'Vercel email 27 Nov: 75% of 4 h used'),
    ('supabase', 'db_size',        71,      '2026-10-24 09:00+00', null,         'runbook 24 Oct: 71 MB (14%)'),
    ('supabase', 'egress',         1.24,    '2026-10-24 09:00+00', '2026-10-28', 'runbook 24 Oct: 1.24 GB (25%)'),
    ('supabase', 'log_ingest',     0.4,     '2026-10-24 09:00+00', '2026-10-28', 'runbook 24 Oct: 0.4 of 1 GB (40%)'),
    ('supabase', 'disk_io',        1,       '2026-11-27 09:00+00', null,         'Supabase email 27 Nov: depleting its Disk IO budget')
  ) as v (service, meter, value, read_at, resets_on, note)
 where not exists (
   select 1 from public.plan_readings r
    where r.service = v.service and r.meter = v.meter and r.read_at = v.read_at::timestamptz);
