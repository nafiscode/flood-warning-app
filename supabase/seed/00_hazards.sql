-- Hazards (spec section 13). Only flood is active in 2026; the others are "coming soon" and
-- never look like "no risk" (safety rule 10). Malay (ms) text is an unreviewed draft.

insert into public.hazards (code, status, capability, name, description, placeholder, hotline, display_order) values
  ('flood', 'active', 'forecast',
   '{"th": "น้ำท่วม", "ms": "Banjir", "en": "Flood"}',
   '{"th": "น้ำท่วมจากแม่น้ำและชายฝั่ง", "ms": "Banjir sungai dan pantai", "en": "River and coastal flooding"}',
   '{}', '1784', 10),
  ('flash_flood', 'coming_soon', 'nowcast',
   '{"th": "น้ำป่าไหลหลาก", "ms": "Banjir kilat", "en": "Flash flood"}',
   '{"th": "เตือนน้ำป่าในพื้นที่ลาดชัน จากปริมาณฝนตกหนัก", "ms": "Amaran banjir kilat di kawasan curam berdasarkan hujan lebat", "en": "Flash-flood warnings for steep catchments from heavy rainfall"}',
   '{"th": "ยังไม่มีการพยากรณ์ภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 1784", "ms": "Ramalan untuk bencana ini belum tersedia. Ini tidak bermakna tiada risiko. Jika berlaku, tekan SOS atau telefon 1784.", "en": "Forecasts for this hazard aren''t available yet. This does not mean there is no risk. In an emergency, press SOS or call 1784."}',
   '1784', 20),
  ('landslide', 'coming_soon', 'nowcast',
   '{"th": "ดินถล่ม", "ms": "Tanah runtuh", "en": "Landslide"}',
   '{"th": "เตือนดินถล่มจากฝนตกหนักและความลาดชัน", "ms": "Amaran tanah runtuh berdasarkan hujan lebat dan kecerunan", "en": "Landslide warnings from heavy rainfall and slope"}',
   '{"th": "ยังไม่มีการพยากรณ์ภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 1784", "ms": "Ramalan untuk bencana ini belum tersedia. Ini tidak bermakna tiada risiko. Jika berlaku, tekan SOS atau telefon 1784.", "en": "Forecasts for this hazard aren''t available yet. This does not mean there is no risk. In an emergency, press SOS or call 1784."}',
   '1784', 30),
  ('fire', 'coming_soon', 'detect',
   '{"th": "ไฟไหม้", "ms": "Kebakaran", "en": "Fire"}',
   '{"th": "จุดความร้อนจากดาวเทียมและไฟป่าพรุ", "ms": "Titik panas satelit dan kebakaran hutan paya gambut", "en": "Satellite hotspots and peat-swamp fires"}',
   '{"th": "ยังไม่มีการเตือนภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 199", "ms": "Amaran untuk bencana ini belum tersedia. Ini tidak bermakna tiada risiko. Jika berlaku, tekan SOS atau telefon 199.", "en": "Warnings for this hazard aren''t available yet. This does not mean there is no risk. In an emergency, press SOS or call 199."}',
   '199', 40),
  ('earthquake', 'coming_soon', 'sos_only',
   '{"th": "แผ่นดินไหว", "ms": "Gempa bumi", "en": "Earthquake"}',
   '{"th": "รายงานหลังเกิดเหตุ ความเสียหาย และที่โล่งปลอดภัย", "ms": "Laporan selepas kejadian, kerosakan dan kawasan lapang yang selamat", "en": "After-event reports, damage and safe open spaces"}',
   '{"th": "แผ่นดินไหวพยากรณ์ล่วงหน้าไม่ได้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 1784", "ms": "Gempa bumi tidak boleh diramal. Ini tidak bermakna tiada risiko. Jika berlaku, tekan SOS atau telefon 1784.", "en": "Earthquakes can''t be forecast. This does not mean there is no risk. In an emergency, press SOS or call 1784."}',
   '1784', 50)
on conflict (code) do update set
  status = excluded.status, capability = excluded.capability, name = excluded.name,
  description = excluded.description, placeholder = excluded.placeholder,
  hotline = excluded.hotline, display_order = excluded.display_order;
