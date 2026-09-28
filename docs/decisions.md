# Decision log

Newest entries at the bottom. Format: date — decision — reason.

- 2026-09-28 — The 2026 scope is a season-ready MVP with alerts issued by admins (human in the loop). — A calibrated forecast can't be validated before November, and wrong automated alerts would cost lives and trust.
- 2026-09-28 — Use open and global data only for now (ThaiWater public API, Sentinel-1, FABDEM, GSMaP/IMERG, Open-Meteo/GloFAS, OSM). — No agency data agreements are in place yet.
- 2026-09-28 — Approved additions: LINE OA plus offline and SMS fallback; Patani Malay plus voice reporting; vulnerable-household pre-registration; restricted location visibility plus authority verification. — These fit local language, connectivity and security realities.
- 2026-09-28 — Stack: Next.js PWA, Supabase (Postgres/PostGIS, Auth, RLS, Realtime), MapLibre with OpenFreeMap and PMTiles, Python pipeline with Google Earth Engine, hosted on Vercel. — Spatial queries and RLS are central to the app; no per-map-load fees; low cost.
- 2026-09-28 — Sign-in: LINE Login and phone OTP are equal options for users; phone OTP for authorities; email magic link for admins (invite-only). — LINE is free and near-universal in Thailand; OTP is the fallback and verifies authorities.
- 2026-09-28 — Budget: about $30/month off-season, up to $150/month from October to December. — Non-profit running costs.
- 2026-09-28 — Notifications: web push is primary (free); LINE multicast goes only to users in affected tambons; the LINE plan is upgraded only for October to December. — LINE bills per recipient.
- 2026-09-28 — Alert levels: normal, watch, warning, evacuate, return (ปกติ, เฝ้าระวัง, เตือนภัย, อพยพ, กลับบ้านได้), issued per tambon. — Simple, familiar colors, and they include the return signal.
- 2026-09-28 — Priority warning zones: Pattani River, Kolok, U-Taphao. — Best gauge coverage and the most people exposed.
- 2026-09-28 — Add donations to support the app (running costs, improvements, admin/volunteer support), with a public transparency page. The feature stays behind a flag until the receiving entity and legal check are settled. — Sustainability and donor trust; keeps fundraising separate from emergency flows.
- 2026-09-28 — Donations go to a dedicated Thai bank account in the founder's name for now (used only for the app), disclosed on the page, with no tax receipts. This moves to a foundation once one is registered. — Fastest path; the switch later is a settings change.
- 2026-09-28 — Giving method: Thai PromptPay QR only. — Zero fees and universal among Thai donors; simplest to reconcile.
- 2026-09-28 — Admin support means small stipends for active admins, paid only from the surplus after running costs, capped, based on logged shifts, and approved by the super admin. Only totals are public. — Rewards volunteer time while keeping the finances sustainable and transparent.
- 2026-09-28 — Donation numbers appear in a Transparency tab on the main dashboard (secondary tab, never the default, no badges), behind the donation flag. — Public accountability without pressuring people during emergencies.
- 2026-09-28 — Donations fund only the app's maintenance and operation. The app does not collect or distribute relief for affected people for now; every donation screen says so and links to official relief channels. — Clear scope, legal safety, donor trust.
- 2026-09-28 — The design is hazard-agnostic from day one (hazard_type on alerts, reports, SOS, safe places; a hazards config table). Only flood is active; flash flood, landslide, fire and earthquake show "coming soon" placeholders; SOS works for any emergency. — Cheap now, expensive to retrofit; many hazards can't be forecast, but SOS still helps.
- 2026-09-28 — App name: Jaga (Thai จากา), Malay for "watch over, take care of". Logo: an eye drawn with terrain contour lines. Taglines: ดูแลกันและกัน / Jaga diri, jaga jiran / Watch over each other. Brand: slate #1D3B53, teal #2F9C95, IBM Plex Sans Thai. Details in docs/brand.md. — Not flood-specific (fits multi-hazard), short, easy to say in Thai and Malay, and speaks to community care. The eye mark is to be tested locally for surveillance connotations.
