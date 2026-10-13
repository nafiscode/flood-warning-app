-- A6: an alert keeps its template's words beside the filled-in ones.
--
-- The filled-in message names the alert's whole area ("ต.บ่อยาง, ต.เขารูปช้าง, ต.เกาะแต้ว และอีก
-- 374 ตำบล"). That is right for the admins and for the record, and wrong for the one person
-- reading it: a list of other people's tambons says nothing about their own (the owner, 14 Oct).
-- So the reviewed template travels with the alert, with its "{area}" still in it, as
-- `template_th`, `template_ms`, `template_en` in `messages` - beside `reason_ms` and `reason_en`,
-- which already live there. A screen puts the reader's own tambon or watched place in that
-- spot; nothing else of the reviewed text can change. `messages.th|ms|en` stay as they were.

create or replace function public.alert_fill(p_template uuid, p_tambons text[], p_note text)
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
    -- The template's own words, for a screen that names the reader's place instead.
    if t.messages ->> loc like '%{area}%' then
      built := built || jsonb_build_object('template_' || loc, t.messages ->> loc);
    end if;
    -- The reason in the reader's language. The admin's note follows it as typed.
    if loc <> 'th' then
      built := built || jsonb_build_object('reason_' || loc, concat_ws(' ', t.reason ->> loc, note));
    end if;
  end loop;
  return query select t.level, t.hazard_type, concat_ws(' ', t.reason ->> 'th', note), built;
end $$;

-- Alerts already published from a template get the same three entries.
update public.alerts a
   set messages = a.messages || (
         select coalesce(jsonb_object_agg('template_' || e.key, e.value), '{}'::jsonb)
           from jsonb_each_text(t.messages) e
          where e.key in ('th', 'ms', 'en') and e.value like '%{area}%')
  from public.alert_templates t
 where t.id = a.template_id and not a.messages ? 'template_th';
