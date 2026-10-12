-- A6: the alert console (docs/spec.md 6.2 and 7).
--
-- Only people publish alerts (safety rule 2). Everything here is something an admin does with a
-- button; nothing runs on a timer and nothing decides a level.
--
-- What this migration is really guarding:
--   * the words. An alert's Thai, Malay and English text is built here, in the database, from a
--     reviewed template. The publish function takes a template id, never a message, so the
--     console cannot send text nobody reviewed and nothing is translated by a machine at the
--     moment of sending. The admin's own note is kept as typed and only ever sits beside the
--     template's reason.
--   * drills. Until the service is switched on at launch the console saves every alert as a
--     drill (decision 2026-10-13). A drill is hidden from everyone but admins by row-level
--     security on the table itself, so every public reader - the status answer, the bell, any
--     direct select - is fenced at once, whatever functions are written later.
--   * safety rule 3. Level, area, issuer, issue time, reason and next update are all required
--     before a row is written; Evacuate needs a second, explicit yes.
--   * the record. Publishing, extending, superseding and cancelling each write to audit_log,
--     and the console's history is read back from there.

-------------------------------------------------------------------------------
-- 1. Templates. Admins read them; only the super admin may change the wording.
-------------------------------------------------------------------------------
create table public.alert_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,60}$'),
  hazard_type public.hazard_type not null default 'flood',
  level public.alert_level not null check (level <> 'normal'),
  -- the name an admin sees in the list
  label jsonb not null check (label ? 'th' and label ? 'en'),
  -- why, in one sentence per language; never a certainty (safety rule 8)
  reason jsonb not null check (reason ? 'th' and reason ? 'ms' and reason ? 'en'),
  -- what to do; "{area}" is replaced by the tambons the alert names
  messages jsonb not null check (messages ? 'th' and messages ? 'ms' and messages ? 'en'),
  active boolean not null default true,
  updated_by uuid references public.profiles (user_id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.alert_templates enable row level security;
revoke all on public.alert_templates from anon;
revoke delete, truncate on public.alert_templates from authenticated;

create policy "alert_templates: admins read" on public.alert_templates
  for select to authenticated using (public.is_admin());
create policy "alert_templates: super admin adds" on public.alert_templates
  for insert to authenticated with check (public.is_super_admin());
create policy "alert_templates: super admin changes" on public.alert_templates
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

insert into public.alert_templates (code, level, label, reason, messages) values
(
  'flood_watch', 'watch',
  '{"th": "เฝ้าระวังน้ำท่วม", "ms": "Berjaga-jaga banjir", "en": "Flood watch"}',
  '{"th": "ฝนตกหนักต่อเนื่องและระดับน้ำมีแนวโน้มสูงขึ้น",
    "ms": "Hujan lebat berterusan dan paras air cenderung meningkat.",
    "en": "Heavy rain is continuing and water levels are tending to rise."}',
  '{"th": "เฝ้าระวังน้ำท่วมในพื้นที่ {area} ชาร์จโทรศัพท์ เตรียมเอกสารสำคัญ ยา และกระเป๋าฉุกเฉิน วางแผนเส้นทางไปที่ปลอดภัย และดูแลผู้สูงอายุ เด็ก และผู้ป่วยใกล้บ้าน",
    "ms": "Berjaga-jaga banjir di {area}. Cas telefon, sediakan dokumen penting, ubat dan beg kecemasan, rancang laluan ke tempat selamat, dan jenguk warga emas, kanak-kanak serta pesakit berhampiran.",
    "en": "Flood watch for {area}. Charge your phone, pack documents, medicine and a go-bag, plan your route to a safe place, and check on elderly people, children and the sick nearby."}'
),
(
  'flood_warning', 'warning',
  '{"th": "เตือนภัยน้ำท่วม", "ms": "Amaran banjir", "en": "Flood warning"}',
  '{"th": "มีแนวโน้มว่าน้ำจะท่วมในพื้นที่นี้ภายในประมาณ 24–48 ชั่วโมง",
    "ms": "Banjir dijangka berlaku di kawasan ini dalam kira-kira 24–48 jam.",
    "en": "Flooding is likely in this area within about 24–48 hours."}',
  '{"th": "เตือนภัยน้ำท่วมในพื้นที่ {area} ย้ายผู้สูงอายุ เด็ก ผู้ป่วย และรถไปยังที่ปลอดภัยตั้งแต่ตอนนี้ ยกของขึ้นที่สูง และติดตามประกาศครั้งถัดไป",
    "ms": "Amaran banjir di {area}. Pindahkan warga emas, kanak-kanak, pesakit dan kenderaan ke tempat selamat sekarang, angkat barang ke tempat tinggi, dan ikuti makluman seterusnya.",
    "en": "Flood warning for {area}. Move elderly people, children, the sick and your vehicles to a safe place now, lift belongings off the floor, and follow the next update."}'
),
(
  'flood_evacuate', 'evacuate',
  '{"th": "อพยพ (น้ำท่วม)", "ms": "Pindah (banjir)", "en": "Evacuate (flood)"}',
  '{"th": "น้ำกำลังจะท่วมหรือเริ่มท่วมแล้วในพื้นที่นี้",
    "ms": "Banjir hampir berlaku atau sudah bermula di kawasan ini.",
    "en": "Flooding is imminent or has started in this area."}',
  '{"th": "อพยพทันทีในพื้นที่ {area} ไปยังที่ปลอดภัยเดี๋ยวนี้ อย่าเดินหรือขับรถผ่านน้ำที่ไหลเชี่ยว หากติดอยู่ให้กด SOS ในแอป หรือโทร 1784 หรือ 1669",
    "ms": "Pindah segera di {area}. Pergi ke tempat selamat sekarang. Jangan berjalan atau memandu merentasi air yang deras. Jika terperangkap, tekan SOS dalam aplikasi atau hubungi 1784 atau 1669.",
    "en": "Evacuate now in {area}. Go to your safe place immediately. Do not walk or drive through fast-moving water. If you are trapped, press SOS in the app or call 1784 or 1669."}'
),
(
  'flood_return', 'return',
  '{"th": "กลับบ้านได้ (น้ำลด)", "ms": "Selamat pulang (air surut)", "en": "Safe to return (water receded)"}',
  '{"th": "ระดับน้ำในพื้นที่นี้ลดลงแล้ว",
    "ms": "Paras air di kawasan ini telah surut.",
    "en": "The water in this area has receded."}',
  '{"th": "กลับบ้านได้ในพื้นที่ {area} กลับอย่างระมัดระวัง ระวังถนนชำรุด ไฟฟ้ารั่ว และสัตว์มีพิษ อย่าเปิดไฟฟ้าในบ้านจนกว่าจะตรวจสอบแล้วว่าปลอดภัย",
    "ms": "Selamat pulang di {area}. Pulang dengan berhati-hati; awasi jalan rosak, kebocoran elektrik dan haiwan berbisa. Jangan hidupkan elektrik di rumah sehingga diperiksa selamat.",
    "en": "It is safe to return in {area}. Go back carefully and watch for damaged roads, live electricity and venomous animals. Do not switch the power on at home until it has been checked."}'
);

-------------------------------------------------------------------------------
-- 2. Drills, and what an alert was built from.
-------------------------------------------------------------------------------
alter table public.alerts
  add column is_drill boolean not null default false,
  add column template_id uuid references public.alert_templates (id);

-- Two policies rather than one "not is_drill or is_admin()": a visitor must never depend on
-- being allowed to call is_admin() to read the alerts in force.
drop policy "alerts: everyone reads" on public.alerts;
create policy "alerts: everyone reads real ones" on public.alerts
  for select to anon, authenticated using (not is_drill);
create policy "alerts: admins read drills too" on public.alerts
  for select to authenticated using (public.is_admin());

-- The tambons of an alert are readable exactly when the alert is.
drop policy "alert_tambons: everyone reads" on public.alert_tambons;
create policy "alert_tambons: readable with their alert" on public.alert_tambons
  for select to anon, authenticated
  using (exists (select 1 from public.alerts a where a.id = alert_id));

-------------------------------------------------------------------------------
-- 3. Building the words. Not callable by clients: the preview and the publish below use it,
--    so what an admin reviews is what is sent.
-------------------------------------------------------------------------------
create function public.alert_area_text(p_tambons text[], p_locale text) returns text
language sql stable set search_path = '' as $$
  with picked as (
    select t.code,
           case when p_locale = 'th' then 'ต.' || t.name_th
                else coalesce(nullif(t.name_en, ''), t.name_th) end as name
      from public.tambons t
     where t.code = any (coalesce(p_tambons, '{}'))
  ),
  n as (select count(*)::integer as c from picked),
  head as (
    select string_agg(f.name, ', ' order by f.code) as s
      from (select code, name from picked order by code limit 3) f
  )
  select case
           when n.c <= 3 then head.s
           when p_locale = 'th' then head.s || ' และอีก ' || (n.c - 3) || ' ตำบล'
           when p_locale = 'ms' then head.s || ' dan ' || (n.c - 3) || ' mukim lagi'
           else head.s || ' and ' || (n.c - 3) || ' more subdistricts'
         end
    from n, head
$$;
revoke execute on function public.alert_area_text(text[], text) from public, anon, authenticated;

create function public.alert_fill(p_template uuid, p_tambons text[], p_note text)
returns table (
  level public.alert_level, hazard_type public.hazard_type, reason text, messages jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  t public.alert_templates;
  note text := nullif(left(btrim(coalesce(p_note, '')), 400), '');
  built jsonb := '{}'::jsonb;
  loc text;
begin
  select x.* into t from public.alert_templates x where x.id = p_template and x.active;
  if not found then
    raise exception 'No such template, or it is switched off' using errcode = 'no_data_found';
  end if;
  foreach loc in array array['th', 'ms', 'en'] loop
    built := built || jsonb_build_object(
      loc, replace(t.messages ->> loc, '{area}', public.alert_area_text(p_tambons, loc)));
    -- The reason in the reader's language. The admin's note follows it as typed.
    if loc <> 'th' then
      built := built || jsonb_build_object('reason_' || loc, concat_ws(' ', t.reason ->> loc, note));
    end if;
  end loop;
  return query select t.level, t.hazard_type, concat_ws(' ', t.reason ->> 'th', note), built;
end $$;
revoke execute on function public.alert_fill(uuid, text[], text) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4. The review step: the words as they will be sent, who they would reach, and which of the
--    chosen tambons already have an alert in force. Counts only, so nothing to log.
-------------------------------------------------------------------------------
create function public.admin_alert_preview(
  p_template uuid, p_tambons text[], p_note text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  codes text[];
  f record;
  reach jsonb;
  quota jsonb;
  v_overlaps jsonb;
begin
  perform public.admin_only();
  select coalesce(array_agg(t.code order by t.code), '{}') into codes
    from public.tambons t where t.code = any (coalesce(p_tambons, '{}'));
  if array_length(codes, 1) is null then
    raise exception 'Choose at least one tambon' using errcode = 'check_violation';
  end if;
  select * into f from public.alert_fill(p_template, codes, p_note);

  with people as (
    select p.user_id, p.line_user_id from public.profiles p where p.home_tambon = any (codes)
    union
    select p.user_id, p.line_user_id
      from public.saved_places sp join public.profiles p on p.user_id = sp.user_id
     where sp.notify and sp.tambon = any (codes)
  )
  select jsonb_build_object(
    'homes', (select count(*) from public.profiles p where p.home_tambon = any (codes)),
    'watched', (select count(*) from public.saved_places sp
                 where sp.notify and sp.tambon = any (codes)),
    'people', (select count(*) from people),
    'push', (select count(distinct s.user_id) from public.push_subscriptions s
              where s.user_id in (select user_id from people)),
    'line', (select count(*) from people where line_user_id is not null))
    into reach;

  select jsonb_build_object('used', q.messages_used, 'limit', q.monthly_limit) into quota
    from public.line_quota_usage q
   where q.month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'level', a.level, 'drill', a.is_drill, 'shared', o.shared)
           order by a.issued_at desc), '[]'::jsonb)
    into v_overlaps
    from public.alerts a
    join lateral (select count(*)::integer as shared from public.alert_tambons at
                   where at.alert_id = a.id and at.tambon = any (codes)) o on o.shared > 0
   where a.superseded_by is null and a.cancelled_at is null;

  return jsonb_build_object(
    'level', f.level, 'reason', f.reason, 'messages', f.messages,
    'tambons', array_length(codes, 1), 'reach', reach, 'lineQuota', quota, 'overlaps', v_overlaps);
end $$;
revoke execute on function public.admin_alert_preview(uuid, text[], text) from public, anon;
grant execute on function public.admin_alert_preview(uuid, text[], text) to authenticated;

-------------------------------------------------------------------------------
-- 5. Publishing. The issuer is whoever is signed in; there is no argument for it.
-------------------------------------------------------------------------------
create function public.admin_publish_alert(
  p_template uuid,
  p_tambons text[],
  p_next_update_at timestamptz,
  p_note text default null,
  p_onset_from timestamptz default null,
  p_onset_to timestamptz default null,
  p_return_from timestamptz default null,
  p_return_to timestamptz default null,
  -- the alert this one replaces, if any
  p_supersedes uuid default null,
  p_drill boolean default false,
  -- Evacuate is refused without it (spec 6.2)
  p_confirm_evacuate boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  codes text[];
  f record;
  old public.alerts;
  v_alert uuid;
begin
  perform public.admin_only();

  select coalesce(array_agg(t.code order by t.code), '{}') into codes
    from public.tambons t where t.code = any (coalesce(p_tambons, '{}'));
  if array_length(codes, 1) is null then
    raise exception 'An alert needs at least one tambon' using errcode = 'check_violation';
  end if;
  -- A code that is not a tambon is a mistake to stop on, not to drop quietly: the admin would
  -- believe a place was warned that was not.
  if array_length(codes, 1) <> (select count(distinct c) from unnest(p_tambons) c) then
    raise exception 'One of the chosen areas is not a tambon Jaga covers'
      using errcode = 'check_violation';
  end if;

  if p_next_update_at is null
     or p_next_update_at <= now() + interval '5 minutes'
     or p_next_update_at > now() + interval '7 days' then
    raise exception 'The next update must be between five minutes and seven days from now'
      using errcode = 'check_violation';
  end if;
  if (p_onset_from is null) <> (p_onset_to is null)
     or (p_return_from is null) <> (p_return_to is null) then
    raise exception 'A time window needs both its ends' using errcode = 'check_violation';
  end if;
  if p_onset_from >= p_onset_to or p_return_from >= p_return_to then
    raise exception 'A time window must end after it starts' using errcode = 'check_violation';
  end if;

  select * into f from public.alert_fill(p_template, codes, p_note);
  if f.level = 'evacuate' and not coalesce(p_confirm_evacuate, false) then
    raise exception 'Evacuate needs its second confirmation' using errcode = 'check_violation';
  end if;

  if p_supersedes is not null then
    select a.* into old from public.alerts a where a.id = p_supersedes for update;
    if not found or old.superseded_by is not null or old.cancelled_at is not null then
      raise exception 'The alert to replace is not in force' using errcode = 'no_data_found';
    end if;
    -- A drill must never take a real alert off the map, and a real one does not "replace" a drill.
    if old.is_drill <> coalesce(p_drill, false) then
      raise exception 'A drill and a real alert cannot replace each other'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.alerts (hazard_type, level, reason, messages, issued_by, next_update_at,
                             expected_onset_window, expected_return_window, is_drill, template_id)
    values (f.hazard_type, f.level, f.reason, f.messages, (select auth.uid()), p_next_update_at,
            case when p_onset_from is not null then tstzrange(p_onset_from, p_onset_to) end,
            case when p_return_from is not null then tstzrange(p_return_from, p_return_to) end,
            coalesce(p_drill, false), p_template)
    returning id into v_alert;
  insert into public.alert_tambons (alert_id, tambon) select v_alert, c from unnest(codes) c;

  if p_supersedes is not null then
    update public.alerts set superseded_by = v_alert where id = p_supersedes;
    perform public.log_access('alert_superseded', 'alerts', p_supersedes::text,
                              jsonb_build_object('by', v_alert));
  end if;
  perform public.log_access('alert_published', 'alerts', v_alert::text, jsonb_build_object(
    'level', f.level, 'tambons', array_length(codes, 1), 'drill', coalesce(p_drill, false),
    'supersedes', p_supersedes, 'next_update_at', p_next_update_at));
  return v_alert;
end $$;
revoke execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_publish_alert(uuid, text[], timestamptz, text, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, boolean, boolean) to authenticated;

-------------------------------------------------------------------------------
-- 6. Extending: "nothing has changed, we will look again at ...". The level and the words stay;
--    only the next-update time moves, and the old one is kept in the log.
-------------------------------------------------------------------------------
create function public.admin_extend_alert(
  p_alert uuid, p_next_update_at timestamptz, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old timestamptz;
begin
  perform public.admin_only();
  if p_next_update_at is null
     or p_next_update_at <= now() + interval '5 minutes'
     or p_next_update_at > now() + interval '7 days' then
    raise exception 'The next update must be between five minutes and seven days from now'
      using errcode = 'check_violation';
  end if;
  select a.next_update_at into v_old from public.alerts a
   where a.id = p_alert and a.superseded_by is null and a.cancelled_at is null
     for update;
  if not found then
    raise exception 'That alert is not in force' using errcode = 'no_data_found';
  end if;
  update public.alerts set next_update_at = p_next_update_at where id = p_alert;
  perform public.log_access('alert_extended', 'alerts', p_alert::text, jsonb_build_object(
    'from', v_old, 'to', p_next_update_at,
    'note', nullif(left(btrim(coalesce(p_note, '')), 400), '')));
end $$;
revoke execute on function public.admin_extend_alert(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_extend_alert(uuid, timestamptz, text) to authenticated;

-------------------------------------------------------------------------------
-- 7. Cancelling. The same function the dam release notice uses (A12), written out again so
--    that this migration stands whichever of the two reaches a database first.
-------------------------------------------------------------------------------
create or replace function public.admin_cancel_alert(p_alert uuid, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  perform public.admin_only();
  update public.alerts set cancelled_at = now()
   where id = p_alert and cancelled_at is null and superseded_by is null
   returning cancelled_at into v_at;
  if v_at is null then
    raise exception 'that alert is not in force' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'alert_cancelled', 'alerts', p_alert,
            jsonb_build_object('note', p_note));
  return v_at;
end $$;
revoke execute on function public.admin_cancel_alert(uuid, text) from public, anon;
grant execute on function public.admin_cancel_alert(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 8. The console's list: every alert, in force or not, drill or not, with its history.
-------------------------------------------------------------------------------
create function public.admin_alerts(p_limit integer default 100)
returns table (
  alert_id uuid, hazard_type public.hazard_type, level public.alert_level, reason text,
  messages jsonb, issued_at timestamptz, next_update_at timestamptz,
  onset_from timestamptz, onset_to timestamptz, return_from timestamptz, return_to timestamptz,
  issued_by_name text, is_drill boolean, template_code text, kind text, tambons text[],
  superseded_by uuid, cancelled_at timestamptz, ended_at timestamptz, events jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select a.id, a.hazard_type, a.level, a.reason, a.messages, a.issued_at, a.next_update_at,
         lower(a.expected_onset_window), upper(a.expected_onset_window),
         lower(a.expected_return_window), upper(a.expected_return_window),
         p.display_name, a.is_drill, tpl.code, a.signals_snapshot ->> 'kind',
         coalesce((select array_agg(at.tambon order by at.tambon)
                     from public.alert_tambons at where at.alert_id = a.id), '{}'),
         a.superseded_by, a.cancelled_at,
         coalesce(a.cancelled_at,
                  (select s.issued_at from public.alerts s where s.id = a.superseded_by)),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'action', l.action, 'at', l.ts, 'by', lp.display_name,
                            'details', l.details) order by l.ts, l.id)
                     from public.audit_log l
                     left join public.profiles lp on lp.user_id = l.actor
                    where l.entity = 'alerts' and l.entity_id = a.id::text), '[]'::jsonb)
    from public.alerts a
    left join public.profiles p on p.user_id = a.issued_by
    left join public.alert_templates tpl on tpl.id = a.template_id
   order by (a.superseded_by is null and a.cancelled_at is null) desc, a.issued_at desc
   limit least(greatest(p_limit, 1), 500);
end $$;
revoke execute on function public.admin_alerts(integer) from public, anon;
grant execute on function public.admin_alerts(integer) to authenticated;
