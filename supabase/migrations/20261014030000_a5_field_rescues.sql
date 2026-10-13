-- Rescues a team found by itself (the owner, 13-14 Oct 2026).
--
-- A team in a boat helps people who never pressed SOS - who have no phone, no signal, or have
-- never heard of Jaga. Those rescues are real work and until now left no record. This lets a
-- verified team record one, at the place and at the moment, and be credited for it.
--
-- There is nobody on the other side to say "yes, I was rescued", so the rules are the owner's:
--   * three things are required, all of them: the phone's own position taken there and then, a
--     phone number for the rescued person (theirs or a relative's), and a photo;
--   * it is worth HALF the points of a rescue asked for through the app, never as much;
--   * it counts at once only when the place gives reason to expect a flood - an alert in force
--     there, a flood report or a request for help nearby, or a tambon the hazard map calls
--     flood-prone - and nothing about it looks repeated;
--   * otherwise it is held for an admin to approve or refuse, and an admin can also take back
--     one that was counted.
--
-- Privacy (safety rule 5): the rescued people did not choose to be in an app. There is no name.
-- The exact position and the photo are readable by the recording team and admins only; the
-- phone number by nobody directly - an admin asks for it, and that look is logged. Nothing of a
-- field rescue is ever on the public map.

create type public.field_rescue_status as enum ('counted', 'pending', 'approved', 'rejected');

create table public.field_rescues (
  -- Chosen by the phone before the photos are uploaded, so they can be filed under it.
  id uuid primary key,
  unit_id uuid not null references public.authority_units (id),
  recorded_by uuid not null references public.profiles (user_id),
  point extensions.geometry(Point, 4326) not null,
  accuracy_m real,
  tambon text not null references public.tambons (code),
  people_count smallint not null check (people_count between 1 and 200),
  vulnerable_flags jsonb not null default '{}'::jsonb,
  note text check (char_length(note) <= 500),
  photos text[] not null check (cardinality(photos) between 1 and 3),
  status public.field_rescue_status not null,
  -- Why it was counted or held: {"evidence": [...], "holds": [...]}.
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500)
);
create index field_rescues_unit_idx on public.field_rescues (unit_id, created_at desc);
create index field_rescues_point_idx on public.field_rescues using gist (point);
create index field_rescues_pending_idx on public.field_rescues (created_at)
  where status = 'pending';

-- The number, apart from the record and readable by no client (as with an SOS).
create table public.field_rescue_contacts (
  rescue_id uuid primary key references public.field_rescues (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+?[0-9]{8,15}$')
);
create index field_rescue_contacts_phone_idx on public.field_rescue_contacts (contact_phone);

alter table public.field_rescues enable row level security;
alter table public.field_rescue_contacts enable row level security;
revoke all on public.field_rescues, public.field_rescue_contacts from anon;
revoke insert, update, delete, truncate on public.field_rescues from authenticated;
revoke all on public.field_rescue_contacts from authenticated;

create policy "field_rescues: the recording team and admins read" on public.field_rescues
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.authority_units u
                where u.id = unit_id and u.user_id = (select auth.uid()))
  );

-- The points ledger learns where an award came from.
alter table public.hero_points
  add column field_rescue_id uuid references public.field_rescues (id) on delete set null;
create unique index hero_points_one_field_award_idx
  on public.hero_points (field_rescue_id)
  where revoked_at is null and field_rescue_id is not null;

insert into public.system_settings (key, value) values
  ('field_rescues', jsonb_build_object(
     'points_percent', 50,      -- of what the same rescue would earn through an SOS
     'report_m', 2000,          -- a standing flood report this near is evidence
     'sos_m', 1000,             -- so is a request for help, in the last three days
     'flood_prone_pct', 20,     -- or a tambon this much High + Medium + Low on the hazard map
     'repeat_m', 200,           -- the same team, this near ...
     'repeat_hours', 24,        -- ... and this recently, is held as a possible repeat
     'daily_cap', 10,           -- more than this in a day is held
     'max_accuracy_m', 200,     -- a vaguer position than this is held
     'match_sos_m', 300,        -- an open request this near should be finished as that request
     'max_age_minutes', 15      -- "at the moment": the position may be this old, no older
   ))
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- Photos: a private bucket, filed as <unit>/<rescue>/<file>. A verified team writes under its
-- own unit; the team and admins read.
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('field-media', 'field-media', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create function public.field_media_writable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.authority_units u
     where u.id::text = split_part(p_path, '/', 1)
       and u.user_id = (select auth.uid())
       and u.status = 'verified'
  )
$$;
create function public.field_media_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.authority_units u
     where u.id::text = split_part(p_path, '/', 1)
       and u.user_id = (select auth.uid())
  )
$$;
revoke execute on function public.field_media_writable(text) from public, anon;
revoke execute on function public.field_media_readable(text) from public, anon;
grant execute on function public.field_media_writable(text) to authenticated;
grant execute on function public.field_media_readable(text) to authenticated;

create policy "field-media: a verified team uploads under its own unit" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'field-media' and public.field_media_writable(name));
create policy "field-media: the team and admins read" on storage.objects
  for select to authenticated
  using (bucket_id = 'field-media' and public.field_media_readable(name));

-------------------------------------------------------------------------------
-- Points: half of what the same rescue would earn through an SOS, rounded down, once.
-------------------------------------------------------------------------------
create function public.award_field_points(p_rescue uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.field_rescues;
  people integer;
  full_points integer;
  pts integer;
begin
  select f.* into r from public.field_rescues f where f.id = p_rescue;
  if not found or r.status not in ('counted', 'approved') then
    return 0;
  end if;
  people := least(r.people_count, public.setting_int('hero_points', 'max_people', 20));
  full_points := public.setting_int('hero_points', 'per_case', 10)
    + public.setting_int('hero_points', 'per_person', 2) * people
    + case when exists (select 1 from jsonb_each_text(r.vulnerable_flags) v where v.value = 'true')
           then public.setting_int('hero_points', 'vulnerable_bonus', 3) else 0 end;
  -- Never as much as a rescue asked for through the app, whatever the setting is turned to.
  pts := floor(full_points * least(public.setting_int('field_rescues', 'points_percent', 50), 99)
               / 100.0);
  insert into public.hero_points (unit_id, field_rescue_id, points, reason)
  values (r.unit_id, r.id, pts, 'field rescue: ' || r.status)
  on conflict do nothing;
  return pts;
end $$;
revoke execute on function public.award_field_points(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Recording one.
-------------------------------------------------------------------------------
create function public.authority_record_field_rescue(
  p_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_accuracy_m real,
  -- When the phone took the position. "At the moment" is checked against the server's clock.
  p_located_at timestamptz,
  p_people integer,
  p_vulnerable jsonb,
  p_phone text,
  p_photos text[],
  p_note text default null
) returns table (status public.field_rescue_status, holds text[], evidence text[], points integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  cfg jsonb := coalesce((select s.value from public.system_settings s where s.key = 'field_rescues'),
                        '{}'::jsonb);
  n_report_m integer := coalesce((cfg ->> 'report_m')::integer, 2000);
  n_sos_m integer := coalesce((cfg ->> 'sos_m')::integer, 1000);
  n_prone numeric := coalesce((cfg ->> 'flood_prone_pct')::numeric, 20);
  n_repeat_m integer := coalesce((cfg ->> 'repeat_m')::integer, 200);
  n_repeat_h integer := coalesce((cfg ->> 'repeat_hours')::integer, 24);
  n_cap integer := coalesce((cfg ->> 'daily_cap')::integer, 10);
  n_acc real := coalesce((cfg ->> 'max_accuracy_m')::real, 200);
  n_match integer := coalesce((cfg ->> 'match_sos_m')::integer, 300);
  n_age integer := coalesce((cfg ->> 'max_age_minutes')::integer, 15);
  v_point extensions.geometry;
  v_tambon text;
  v_unit uuid;
  v_covers boolean;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_photos text[];
  v_evidence text[] := '{}';
  v_holds text[] := '{}';
  v_status public.field_rescue_status;
  v_points integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'The position of the rescue is required' using errcode = 'check_violation';
  end if;
  if p_located_at is null or p_located_at < now() - make_interval(mins => n_age)
     or p_located_at > now() + interval '2 minutes' then
    raise exception 'The position must be taken now, at the place of the rescue'
      using errcode = 'check_violation';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'A phone number for the rescued person is required'
      using errcode = 'check_violation';
  end if;
  if p_people is null or p_people not between 1 and 200 then
    raise exception 'Say how many people were rescued' using errcode = 'check_violation';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  select t.code into v_tambon from public.tambons t
   where extensions.st_contains(t.geom, v_point) limit 1;
  if v_tambon is null then
    raise exception 'That position is outside the area Jaga covers' using errcode = 'check_violation';
  end if;

  -- The caller's verified team. Someone with several teams records for the one the photo was
  -- filed under (photos are kept as <unit>/<rescue>/<file>).
  select u.id, exists (select 1 from public.authority_coverage c
                        where c.unit_id = u.id and c.tambon = v_tambon)
    into v_unit, v_covers
    from public.authority_units u
   where u.user_id = uid and u.status = 'verified'
     and u.id::text = split_part(coalesce(p_photos[1], ''), '/', 1)
   limit 1;
  if v_unit is null then
    raise exception 'Only a verified team can record a rescue' using errcode = 'insufficient_privilege';
  end if;

  -- A photo that was never uploaded is not evidence of anything.
  select coalesce(array_agg(o.name order by o.name), '{}') into v_photos
    from (select o.name from storage.objects o
           where o.bucket_id = 'field-media'
             and o.name = any (coalesce(p_photos, '{}'))
             and o.name like v_unit::text || '/' || p_id::text || '/%'
           order by o.name limit 3) o;
  if cardinality(v_photos) = 0 then
    raise exception 'A photo of the rescue is required' using errcode = 'check_violation';
  end if;

  -- Reasons to expect a flood here.
  if exists (select 1 from public.alerts a join public.alert_tambons at on at.alert_id = a.id
              where at.tambon = v_tambon and not a.is_drill
                and a.superseded_by is null and a.cancelled_at is null
                and a.level in ('watch', 'warning', 'evacuate')) then
    v_evidence := array_append(v_evidence, 'alert_in_force');
  end if;
  if exists (select 1 from public.standing_flood_reports() r
              where extensions.st_dwithin(r.point::extensions.geography,
                                          v_point::extensions.geography, n_report_m)) then
    v_evidence := array_append(v_evidence, 'flood_report_near');
  end if;
  if exists (select 1 from public.sos_requests s
              where s.created_at > now() - interval '72 hours'
                and extensions.st_dwithin(s.point::extensions.geography,
                                          v_point::extensions.geography, n_sos_m)) then
    v_evidence := array_append(v_evidence, 'sos_near');
  end if;
  if exists (select 1 from public.hazard_by_tambon h
              where h.tambon_code = v_tambon
                and coalesce(h.high_pct, 0) + coalesce(h.medium_pct, 0) + coalesce(h.low_pct, 0)
                    >= n_prone) then
    v_evidence := array_append(v_evidence, 'flood_prone_area');
  end if;

  -- Reasons to have a person look first.
  if cardinality(v_evidence) = 0 then
    v_holds := array_append(v_holds, 'no_flood_evidence');
  end if;
  if not v_covers then
    v_holds := array_append(v_holds, 'outside_coverage');
  end if;
  if p_accuracy_m is null or p_accuracy_m > n_acc then
    v_holds := array_append(v_holds, 'vague_position');
  end if;
  if exists (select 1 from public.field_rescues f
              where f.unit_id = v_unit and f.status <> 'rejected'
                and f.created_at > now() - make_interval(hours => n_repeat_h)
                and extensions.st_dwithin(f.point::extensions.geography,
                                          v_point::extensions.geography, n_repeat_m)) then
    v_holds := array_append(v_holds, 'repeat_nearby');
  end if;
  if (select count(*) from public.field_rescues f
       where f.unit_id = v_unit and f.created_at > now() - interval '24 hours') >= n_cap then
    v_holds := array_append(v_holds, 'many_today');
  end if;
  if exists (select 1 from public.field_rescue_contacts c
               join public.field_rescues f on f.id = c.rescue_id
              where c.contact_phone = v_phone and f.status <> 'rejected'
                and f.created_at > now() - interval '30 days') then
    v_holds := array_append(v_holds, 'phone_used_before');
  end if;
  -- Someone here did ask through the app: that request is where this rescue belongs.
  if exists (select 1 from public.sos_requests s
              where s.closed_at is null and s.status in ('received', 'assigned', 'en_route', 'on_site')
                and extensions.st_dwithin(s.point::extensions.geography,
                                          v_point::extensions.geography, n_match)) then
    v_holds := array_append(v_holds, 'open_request_here');
  end if;

  v_status := case when cardinality(v_holds) = 0 then 'counted' else 'pending' end;
  insert into public.field_rescues (id, unit_id, recorded_by, point, accuracy_m, tambon,
                                    people_count, vulnerable_flags, note, photos, status, checks)
  values (p_id, v_unit, uid, v_point, p_accuracy_m, v_tambon, p_people,
          coalesce(p_vulnerable, '{}'::jsonb), nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          v_photos, v_status,
          jsonb_build_object('evidence', to_jsonb(v_evidence), 'holds', to_jsonb(v_holds)));
  insert into public.field_rescue_contacts (rescue_id, contact_phone) values (p_id, v_phone);
  if v_status = 'counted' then
    v_points := public.award_field_points(p_id);
  end if;
  perform public.log_access('field_rescue_recorded', 'field_rescues', p_id::text,
    jsonb_build_object('unit', v_unit, 'status', v_status, 'holds', to_jsonb(v_holds),
                       'evidence', to_jsonb(v_evidence), 'people', p_people));
  return query select v_status, v_holds, v_evidence, v_points;
end $$;
revoke execute on function public.authority_record_field_rescue(uuid, double precision,
  double precision, real, timestamptz, integer, jsonb, text, text[], text) from public, anon;
grant execute on function public.authority_record_field_rescue(uuid, double precision,
  double precision, real, timestamptz, integer, jsonb, text, text[], text) to authenticated;

-- A team's own records and where each stands. No phone number.
create function public.my_field_rescues()
returns table (
  rescue_id uuid, created_at timestamptz, status public.field_rescue_status,
  tambon_th text, tambon_en text, people_count integer, holds jsonb,
  points integer, reviewed_at timestamptz, review_note text
)
language sql stable security definer set search_path = '' as $$
  select f.id, f.created_at, f.status, t.name_th, t.name_en, f.people_count::integer,
         coalesce(f.checks -> 'holds', '[]'::jsonb),
         coalesce((select sum(h.points)::integer from public.hero_points h
                    where h.field_rescue_id = f.id and h.revoked_at is null), 0),
         f.reviewed_at, f.review_note
    from public.field_rescues f
    join public.authority_units u on u.id = f.unit_id
    join public.tambons t on t.code = f.tambon
   where u.user_id = (select auth.uid())
     and f.created_at > now() - interval '60 days'
   order by f.created_at desc
   limit 50
$$;
revoke execute on function public.my_field_rescues() from public, anon;
grant execute on function public.my_field_rescues() to authenticated;

-------------------------------------------------------------------------------
-- The admins' side: what is held, what was counted, approve, refuse, take back.
-------------------------------------------------------------------------------
create function public.admin_field_rescues(p_status public.field_rescue_status default 'pending')
returns table (
  rescue_id uuid, created_at timestamptz, status public.field_rescue_status,
  unit_id uuid, unit_name text, org_name text, recorded_by_name text,
  tambon text, tambon_th text, tambon_en text, lat double precision, lon double precision,
  accuracy_m real, people_count integer, vulnerable jsonb, note text, photos text[],
  checks jsonb, points integer, unit_last_7_days integer,
  reviewed_at timestamptz, review_note text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_only();
  return query
  select f.id, f.created_at, f.status, u.id, u.unit_name, o.name, p.display_name,
         f.tambon, t.name_th, t.name_en,
         extensions.st_y(f.point)::double precision, extensions.st_x(f.point)::double precision,
         f.accuracy_m, f.people_count::integer, f.vulnerable_flags, f.note, f.photos, f.checks,
         coalesce((select sum(h.points)::integer from public.hero_points h
                    where h.field_rescue_id = f.id and h.revoked_at is null), 0),
         (select count(*)::integer from public.field_rescues x
           where x.unit_id = f.unit_id and x.created_at > now() - interval '7 days'),
         f.reviewed_at, f.review_note
    from public.field_rescues f
    join public.authority_units u on u.id = f.unit_id
    join public.organizations o on o.id = u.org_id
    join public.tambons t on t.code = f.tambon
    left join public.profiles p on p.user_id = f.recorded_by
   where f.status = p_status
   order by f.created_at desc
   limit 200;
end $$;
revoke execute on function public.admin_field_rescues(public.field_rescue_status) from public, anon;
grant execute on function public.admin_field_rescues(public.field_rescue_status) to authenticated;

-- Approve a held one (points are awarded), or refuse one - held or already counted - with a
-- reason; refusing takes back any points it had earned.
create function public.admin_review_field_rescue(p_rescue uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.field_rescue_status;
  why text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform public.admin_only();
  select f.status into st from public.field_rescues f where f.id = p_rescue for update;
  if not found then
    raise exception 'No such record' using errcode = 'no_data_found';
  end if;
  if p_approve then
    if st <> 'pending' then
      raise exception 'Only a held record can be approved' using errcode = 'check_violation';
    end if;
    update public.field_rescues
       set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(),
           review_note = why
     where id = p_rescue;
    perform public.award_field_points(p_rescue);
  else
    if st = 'rejected' then
      raise exception 'That record was already refused' using errcode = 'check_violation';
    end if;
    if why is null then
      raise exception 'Refusing a record needs a reason' using errcode = 'check_violation';
    end if;
    update public.field_rescues
       set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(),
           review_note = why
     where id = p_rescue;
    update public.hero_points
       set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = why
     where field_rescue_id = p_rescue and revoked_at is null;
  end if;
  perform public.log_access('field_rescue_reviewed', 'field_rescues', p_rescue::text,
    jsonb_build_object('approved', p_approve, 'was', st, 'note', why));
end $$;
revoke execute on function public.admin_review_field_rescue(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_field_rescue(uuid, boolean, text) to authenticated;

-- The rescued person's number, for an admin who needs to call and check. Logged.
create function public.reveal_field_rescue_phone(p_rescue uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  phone text;
begin
  perform public.admin_only();
  select c.contact_phone into phone from public.field_rescue_contacts c where c.rescue_id = p_rescue;
  perform public.log_access('reveal_phone', 'field_rescues', p_rescue::text,
                            jsonb_build_object('had_phone', phone is not null));
  return phone;
end $$;
revoke execute on function public.reveal_field_rescue_phone(uuid) from public, anon;
grant execute on function public.reveal_field_rescue_phone(uuid) to authenticated;

-------------------------------------------------------------------------------
-- The board of thanks counts them too: by the province of the rescue, whichever kind it was.
-- Same signature as A5's; only where the province and the count come from changes.
-------------------------------------------------------------------------------
create or replace function public.hero_leaderboard(p_province text default null)
returns table (province_code text, unit_id uuid, unit_name text, org_name text,
               points integer, cases integer, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if not (public.is_verified_authority() or public.is_admin()) then
    raise exception 'Verified authorities and admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select left(coalesce(s.tambon, f.tambon), 2), u.id, u.unit_name, o.name,
         sum(h.points)::integer,
         count(distinct coalesce(h.sos_id, h.field_rescue_id))::integer, u.user_id = uid
    from public.hero_points h
    join public.authority_units u on u.id = h.unit_id
    join public.organizations o on o.id = u.org_id
    left join public.sos_requests s on s.id = h.sos_id
    left join public.field_rescues f on f.id = h.field_rescue_id
   where h.revoked_at is null
     and coalesce(s.tambon, f.tambon) is not null
     and (p_province is null or left(coalesce(s.tambon, f.tambon), 2) = p_province)
   group by left(coalesce(s.tambon, f.tambon), 2), u.id, u.unit_name, o.name, u.user_id
   order by 1, 5 desc, u.unit_name;
end $$;
