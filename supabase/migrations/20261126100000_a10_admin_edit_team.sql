-------------------------------------------------------------------------------
-- An admin edits a registered team (owner, 26 Nov 2026).
--
-- Until now a team could say who it is once, at registration, and only while it was pending; an
-- admin could verify, reject or suspend it but never correct it. A wrong unit name, a mistyped
-- contact phone or an area that was ticked too wide had no remedy short of a new registration.
--
-- Three functions, one per part of a team, so each form on the admin's edit page saves on its own
-- and a slip in one cannot disturb the others:
--
--   admin_update_unit_details  unit name, and the organization it belongs to
--   admin_update_unit_contact  point-of-contact name and phone
--   admin_update_unit_scope    capabilities and coverage (together: both decide what the team
--                              may read, so they are one decision)
--
-- What each one guarantees:
--   * Admins only (42501 otherwise). Nobody edits through a table policy: the team itself still
--     can change nothing once it is verified.
--   * Any status. A pending, verified, rejected or suspended team can be corrected. The status is
--     never touched here; verifying, rejecting and suspending stay the functions that own that.
--   * Every change is in `audit_log` under the admin's own account, with the old and new value.
--     The contact is the exception on purpose: its name and phone are personal data (safety rule
--     5), so the log says which of them changed and never what they were.
--   * A change that changes nothing writes nothing.
--
-- The contact phone. A new number is not the number somebody confirmed. Its "confirmed" flags are
-- cleared, and on a team that is already verified the admin may only save it by saying they called
-- it (23514 otherwise), so a typo cannot sit on a verified team looking confirmed. On a team that
-- is not verified yet the flags are simply cleared: verifying it later asks for the call anyway.
--
-- The organization is shared by every unit registered under it, so renaming it renames it for all
-- of them. The admin's screen says how many.
--
-- Removing the 'dam' capability also unties the unit from its dams. A link kept without the
-- capability would come back to life the day somebody ticked 'dam' again, without any admin having
-- confirmed with the dam a second time; the one thing that grants a dam operator its power must
-- always be a deliberate tie.
--
-- Telling the team (owner, 26 Nov 2026: "let the admin tick if the team could get notices or not,
-- by default yes"). Each function takes `p_notify_team`, true unless the admin unticks it, and
-- writes it into the audit row. A ticked edit reaches the account that registered the unit the
-- way a verification does - the bell (`my_unit_edits()`) and LINE (a new branch in
-- `admin_decisions_since()`) - and says WHICH part changed, never what it was changed to: a
-- contact's name and phone are personal data and stay out of every message.
--
-- Open cases (owner, 26 Nov 2026: warn so the wrong coverage is not selected). What a team reads
-- follows its coverage and its capabilities (`covers_tambon()`, `my_unit_for_sos()`), also for a
-- case the team has already accepted. So a change that moves a tambon out of the area, or leaves
-- the unit with nothing but planning and dam work, would cut a team off from a rescue in progress.
-- `admin_update_unit_scope` therefore refuses (23514, "Open cases ...") when it would do that,
-- unless the admin passes `p_confirm_open_cases`: the edit page names the cases' tambons and asks
-- for a tick first. The database holds the line so no other caller can skip the question.
-------------------------------------------------------------------------------

create function public.admin_update_unit_details(
  p_unit uuid,
  p_unit_name text,
  p_org_name text,
  p_org_type public.org_type,
  p_official_phone text,
  p_public_contact_opt_in boolean,
  p_notify_team boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_old_unit text;
  v_old public.organizations;
  v_unit_name text := btrim(coalesce(p_unit_name, ''));
  v_org_name text := btrim(coalesce(p_org_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_official_phone, ''), '[\s().-]', '', 'g'), '');
  v_opt boolean := coalesce(p_public_contact_opt_in, false);
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.admin_only();
  select u.unit_name, u.org_id into v_old_unit, v_org
    from public.authority_units u where u.id = p_unit for update;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  if char_length(v_unit_name) not between 2 and 200
     or char_length(v_org_name) not between 2 and 200 then
    raise exception 'The names must be 2 to 200 characters' using errcode = 'check_violation';
  end if;
  if p_org_type is null then
    raise exception 'Choose the type of organization' using errcode = 'check_violation';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{3,15}$' then
    raise exception 'That office phone is not a phone number' using errcode = 'check_violation';
  end if;

  select * into v_old from public.organizations o where o.id = v_org for update;

  if v_old_unit is distinct from v_unit_name then
    v_changes := v_changes || jsonb_build_object(
      'unit_name', jsonb_build_object('from', v_old_unit, 'to', v_unit_name));
  end if;
  if v_old.name is distinct from v_org_name then
    v_changes := v_changes || jsonb_build_object(
      'org_name', jsonb_build_object('from', v_old.name, 'to', v_org_name));
  end if;
  if v_old.type is distinct from p_org_type then
    v_changes := v_changes || jsonb_build_object(
      'org_type', jsonb_build_object('from', v_old.type, 'to', p_org_type));
  end if;
  if v_old.public_contact_opt_in is distinct from v_opt then
    v_changes := v_changes || jsonb_build_object(
      'public_contact_opt_in', jsonb_build_object('from', v_old.public_contact_opt_in, 'to', v_opt));
  end if;
  -- An office number can be somebody's own mobile in a volunteer group: say that it changed, not
  -- what it was.
  if v_old.official_phone is distinct from v_phone then
    v_changes := v_changes || jsonb_build_object('official_phone_changed', true);
  end if;

  if v_changes = '{}'::jsonb then
    return;
  end if;

  update public.authority_units set unit_name = v_unit_name where id = p_unit;
  update public.organizations
     set name = v_org_name, type = p_org_type, official_phone = v_phone,
         public_contact_opt_in = v_opt
   where id = v_org;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), 'admin_edit_unit_details', 'authority_units', p_unit::text,
          jsonb_build_object(
            'changes', v_changes,
            'notify', coalesce(p_notify_team, true),
            'units_in_organization',
            (select count(*) from public.authority_units where org_id = v_org)));
end $$;
revoke all on function public.admin_update_unit_details(
  uuid, text, text, public.org_type, text, boolean, boolean) from public, anon;
grant execute on function public.admin_update_unit_details(
  uuid, text, text, public.org_type, text, boolean, boolean) to authenticated;

-------------------------------------------------------------------------------

create function public.admin_update_unit_contact(
  p_unit uuid,
  p_poc_name text,
  p_poc_phone text,
  p_phone_confirmed_by_call boolean default false,
  p_notify_team boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.authority_status;
  v_old_name text;
  v_old_phone text;
  v_name text := btrim(coalesce(p_poc_name, ''));
  v_phone text := btrim(coalesce(p_poc_phone, ''));
  v_called boolean := coalesce(p_phone_confirmed_by_call, false);
  v_name_changed boolean;
  v_phone_changed boolean;
begin
  perform public.admin_only();
  select u.status into v_status from public.authority_units u where u.id = p_unit for update;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  select c.poc_name, c.poc_phone into v_old_name, v_old_phone
    from public.authority_unit_contacts c where c.unit_id = p_unit for update;
  if not found then
    raise exception 'This unit has no contact on record' using errcode = 'no_data_found';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'The contact name must be 2 to 120 characters' using errcode = 'check_violation';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'That contact phone is not a phone number' using errcode = 'check_violation';
  end if;

  v_name_changed := v_old_name is distinct from v_name;
  v_phone_changed := v_old_phone is distinct from v_phone;
  if not v_name_changed and not v_phone_changed then
    return;
  end if;
  if v_phone_changed and v_status = 'verified' and not v_called then
    raise exception 'Call the new number and confirm it before saving it'
      using errcode = 'check_violation';
  end if;

  update public.authority_unit_contacts
     set poc_name = v_name
   where unit_id = p_unit;
  if v_phone_changed then
    update public.authority_unit_contacts
       set poc_phone = v_phone,
           poc_phone_verified = false,
           poc_phone_verified_by_call = v_called
     where unit_id = p_unit;
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), 'admin_edit_unit_contact', 'authority_units', p_unit::text,
          jsonb_build_object(
            'name_changed', v_name_changed,
            'phone_changed', v_phone_changed,
            'phone_confirmed_by_call', v_phone_changed and v_called,
            'notify', coalesce(p_notify_team, true)));
end $$;
revoke all on function public.admin_update_unit_contact(uuid, text, text, boolean, boolean)
  from public, anon;
grant execute on function public.admin_update_unit_contact(uuid, text, text, boolean, boolean)
  to authenticated;

-------------------------------------------------------------------------------

-- p_coverage: [{"level": "province" | "district" | "tambon", "code": "<DOPA code>"}, ...], the
-- same shape register_authority_unit() takes. It replaces the whole coverage, expanded to tambons
-- exactly as registration does it.
create function public.admin_update_unit_scope(
  p_unit uuid,
  p_capabilities public.authority_capability[],
  p_coverage jsonb,
  p_confirm_open_cases boolean default false,
  p_notify_team boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cut integer;
  v_old_caps public.authority_capability[];
  v_old_sorted public.authority_capability[];
  v_new_caps public.authority_capability[];
  v_old_tambons text[];
  v_new_tambons text[];
  v_old_selection jsonb;
  v_new_selection jsonb;
  v_item jsonb;
  v_level public.admin_level;
  v_untied text[] := '{}';
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.admin_only();
  select u.capabilities into v_old_caps
    from public.authority_units u where u.id = p_unit for update;
  if not found then
    raise exception 'No such unit' using errcode = 'no_data_found';
  end if;
  if coalesce(array_length(p_capabilities, 1), 0) = 0 then
    raise exception 'Choose at least one capability' using errcode = 'check_violation';
  end if;
  if p_coverage is null or jsonb_typeof(p_coverage) <> 'array'
     or jsonb_array_length(p_coverage) = 0 then
    raise exception 'Choose at least one area' using errcode = 'check_violation';
  end if;

  select array_agg(distinct c order by c) into v_new_caps from unnest(p_capabilities) c;
  -- Compared sorted, so a team stored in another order does not log a change that is not one.
  select array_agg(distinct c order by c) into v_old_sorted from unnest(v_old_caps) c;
  select coalesce(array_agg(tambon order by tambon), '{}') into v_old_tambons
    from public.authority_coverage where unit_id = p_unit;
  select coalesce(jsonb_agg(jsonb_build_object('level', selected_level, 'code', selected_code)
                            order by selected_level, selected_code), '[]'::jsonb)
    into v_old_selection
    from (select distinct selected_level, selected_code
            from public.authority_coverage where unit_id = p_unit) s;

  -- Replace the coverage in one go. Widest selections first, so a tambon inside a selected
  -- province is recorded under the province, as at registration. Raising below undoes the delete.
  delete from public.authority_coverage where unit_id = p_unit;
  for v_item in
    select value from jsonb_array_elements(p_coverage)
    order by array_position(array['province', 'district', 'tambon'], value ->> 'level')
  loop
    v_level := (v_item ->> 'level')::public.admin_level;
    insert into public.authority_coverage (unit_id, tambon, selected_level, selected_code)
    select p_unit, t, v_level, v_item ->> 'code'
      from public.expand_coverage(v_level, v_item ->> 'code') t
    on conflict (unit_id, tambon) do nothing;
  end loop;
  select coalesce(array_agg(tambon order by tambon), '{}') into v_new_tambons
    from public.authority_coverage where unit_id = p_unit;
  if coalesce(array_length(v_new_tambons, 1), 0) = 0 then
    raise exception 'The selected area is outside the provinces Jaga covers'
      using errcode = 'check_violation';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('level', selected_level, 'code', selected_code)
                            order by selected_level, selected_code), '[]'::jsonb)
    into v_new_selection
    from (select distinct selected_level, selected_code
            from public.authority_coverage where unit_id = p_unit) s;

  -- Cases the team has accepted, is still working, can read now, and could not read afterwards
  -- (see the header). Raising here undoes the coverage replacement above.
  select count(*) into v_cut
    from public.sos_claims c
    join public.sos_requests s on s.id = c.sos_id
   where c.unit_id = p_unit
     and c.released_at is null
     and s.status in ('received', 'assigned', 'en_route', 'on_site')
     and s.tambon is not null
     and not public.unit_is_office_only(v_old_caps)
     and s.tambon = any (v_old_tambons)
     and (public.unit_is_office_only(v_new_caps) or not (s.tambon = any (v_new_tambons)));
  if v_cut > 0 and not coalesce(p_confirm_open_cases, false) then
    raise exception 'Open cases would be cut off: %', v_cut using errcode = 'check_violation';
  end if;

  if v_old_sorted is distinct from v_new_caps then
    update public.authority_units set capabilities = v_new_caps where id = p_unit;
    v_changes := v_changes || jsonb_build_object(
      'capabilities', jsonb_build_object('from', v_old_caps, 'to', v_new_caps));
    -- No 'dam' any more: no tie to a dam either (see the header).
    if 'dam' = any (v_old_caps) and not ('dam' = any (v_new_caps)) then
      with gone as (
        delete from public.dam_operator_units where unit_id = p_unit returning dam_code)
      select coalesce(array_agg(dam_code order by dam_code), '{}') into v_untied from gone;
      if array_length(v_untied, 1) > 0 then
        insert into public.audit_log (actor, action, entity, entity_id, details)
        values ((select auth.uid()), 'dam_operator_unlinked', 'authority_units', p_unit::text,
                jsonb_build_object('dams', to_jsonb(v_untied),
                                   'because', 'dam capability removed'));
      end if;
    end if;
  end if;
  if v_old_tambons is distinct from v_new_tambons then
    v_changes := v_changes || jsonb_build_object(
      'coverage', jsonb_build_object(
        'from', v_old_selection, 'to', v_new_selection,
        'tambons_from', cardinality(v_old_tambons), 'tambons_to', cardinality(v_new_tambons)));
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values ((select auth.uid()), 'admin_edit_unit_scope', 'authority_units', p_unit::text,
            jsonb_build_object('changes', v_changes,
                               'open_cases_cut_off', v_cut,
                               'notify', coalesce(p_notify_team, true)));
  end if;
end $$;
revoke all on function public.admin_update_unit_scope(
  uuid, public.authority_capability[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.admin_update_unit_scope(
  uuid, public.authority_capability[], jsonb, boolean, boolean) to authenticated;

-------------------------------------------------------------------------------
-- The team hears of it. Two readers of the same audit rows, exactly as for a verification:
--
--   admin_decisions_since()  the LINE side: `line_decisions_due()` hands each row out once.
--                            Rebuilt from the live definition (checked against the 16 Oct
--                            migration on 26 Nov: identical) with one branch added.
--   my_unit_edits()          the bell: the caller's own units, the last fourteen days.
--
-- Only an edit the admin left ticked ("tell the team") is read. The row says which part changed
-- ('details', 'contact', 'scope') and the unit's name, and nothing else.
-------------------------------------------------------------------------------
create or replace function public.admin_decisions_since(p_since timestamptz)
returns table (
  audit_id bigint, kind text, user_id uuid, ref text, data jsonb, decided_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id,
         case a.action
           when 'verify_authority' then 'unit_verified'
           when 'reject_authority' then 'unit_rejected'
           else 'unit_suspended'
         end,
         u.user_id, u.id::text,
         jsonb_strip_nulls(jsonb_build_object(
           'unit', u.unit_name,
           'reason', case when a.action = 'reject_authority' then a.details ->> 'reason' end)),
         a.ts
    from public.audit_log a
    join public.authority_units u on u.id::text = a.entity_id
   where a.entity = 'authority_units'
     and a.action in ('verify_authority', 'suspend_authority', 'reject_authority')
     and a.ts > p_since
  union all
  select a.id,
         'unit_edited',
         u.user_id, u.id::text,
         jsonb_build_object(
           'unit', u.unit_name,
           'part', substr(a.action, length('admin_edit_unit_') + 1)),
         a.ts
    from public.audit_log a
    join public.authority_units u on u.id::text = a.entity_id
   where a.entity = 'authority_units'
     and a.action in ('admin_edit_unit_details', 'admin_edit_unit_contact', 'admin_edit_unit_scope')
     and a.details ->> 'notify' = 'true'
     and a.ts > p_since
  union all
  select a.id,
         case when coalesce((a.details ->> 'approved')::boolean, false)
              then 'field_approved' else 'field_rejected' end,
         u.user_id, f.id::text,
         jsonb_build_object('unit', u.unit_name, 'tambon_th', t.name_th, 'tambon_en', t.name_en),
         a.ts
    from public.audit_log a
    join public.field_rescues f on f.id::text = a.entity_id
    join public.authority_units u on u.id = f.unit_id
    left join public.tambons t on t.code = f.tambon
   where a.entity = 'field_rescues'
     and a.action = 'field_rescue_reviewed'
     and a.ts > p_since
  union all
  select a.id,
         case a.details ->> 'to' when 'approved' then 'report_approved' else 'report_hidden' end,
         r.reporter_id, r.id::text,
         jsonb_build_object('tambon_th', t.name_th, 'tambon_en', t.name_en),
         a.ts
    from public.audit_log a
    join public.reports r on r.id::text = a.entity_id
    left join public.tambons t on t.code = r.tambon
   where a.entity = 'reports'
     and a.action = 'report_moderated'
     and a.details ->> 'to' in ('approved', 'hidden')
     and r.reporter_id is not null
     and a.ts > p_since
$$;
revoke execute on function public.admin_decisions_since(timestamptz) from public, anon, authenticated;

create function public.my_unit_edits()
returns table (audit_id bigint, unit_id uuid, unit_name text, part text, edited_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, u.id, u.unit_name, substr(a.action, length('admin_edit_unit_') + 1), a.ts
    from public.audit_log a
    join public.authority_units u on u.id::text = a.entity_id
   where a.entity = 'authority_units'
     and a.action in ('admin_edit_unit_details', 'admin_edit_unit_contact', 'admin_edit_unit_scope')
     and a.details ->> 'notify' = 'true'
     and u.user_id = (select auth.uid())
     and a.ts > now() - interval '14 days'
   order by a.ts desc
   limit 20
$$;
revoke execute on function public.my_unit_edits() from public, anon;
grant execute on function public.my_unit_edits() to authenticated;
