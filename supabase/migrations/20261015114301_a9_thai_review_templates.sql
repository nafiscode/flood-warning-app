-- Thai copy review (decision 15 Oct 2026): the Evacuate template says ฝ่าน้ำ (wade or drive into
-- the water), the same verb as the Evacuate checklist, instead of ผ่านน้ำ. Meaning unchanged.
-- A row whose Thai an admin has changed since is left alone. Alerts already issued keep their words.

update public.alert_templates
   set messages = jsonb_set(messages, '{th}', to_jsonb($th$อพยพทันทีในพื้นที่ {area} ไปยังที่ปลอดภัยเดี๋ยวนี้ อย่าเดินหรือขับรถฝ่าน้ำที่ไหลเชี่ยว หากติดอยู่ให้กด SOS ในแอป หรือโทร 1784 หรือ 1669$th$::text)),
       updated_at = now()
 where code = 'flood_evacuate'
   and messages ->> 'th' = $th$อพยพทันทีในพื้นที่ {area} ไปยังที่ปลอดภัยเดี๋ยวนี้ อย่าเดินหรือขับรถผ่านน้ำที่ไหลเชี่ยว หากติดอยู่ให้กด SOS ในแอป หรือโทร 1784 หรือ 1669$th$;
