# Phased prompts for Claude Code

## How to use
1. Set up the laptop and clone both repos as described in `SETUP.md` (`CLAUDE.md` is at the repo root, the other docs are in `docs/`).
2. Open the folder in VS Code and start Claude Code.
3. Paste one prompt at a time.
4. Let it propose a plan, approve or adjust, then let it build.
5. Before moving on, check the acceptance criteria yourself.

**Two tracks run in parallel:** S = science (`pipeline/`, Python), A = app (Next.js + Supabase).
Run **S1 today**. It protects data that is about to expire.

| Week | Science | App |
|---|---|---|
| 1 (28 Sep–4 Oct) | S1 (done 28 Sep; scheduled jobs keep it current) | A0, A1, A2 |
| 2 (5–11 Oct) | S2, S3 | A3, A4 |
| 3 (12–18 Oct) | S4, S5 | A5, A6, A7 |
| 4 (19–25 Oct) | S6 | A8, A9, A10 |
| After launch | – | A11 (donations, feature flag off until the legal and account setup is settled) |

---

## Science track

### S1: Archive ThaiWater gauge history (do first)
```text
Read CLAUDE.md and docs/science-plan.md (sections 2 and 5).

Goal: archive all available ThaiWater (HII) public-API gauge history for Pattani, Yala, Narathiwat and Songkhla before older data expires.

Build in pipeline/ingest_thaiwater/ (since moved to the public repo nafiscode/jaga-collectors):
1. A script that lists every ThaiWater station (water level and rainfall) inside the four provinces. Use a province bounding box plus the station's province field (tambon boundaries arrive in A1). Save station metadata to pipeline/data/stations.csv: code, agency, name, lat/lon, basin, bank-full/warning/critical levels if provided.
2. A downloader that fetches all available history per station and variable. Water level is limited to 365 days per request but older years are reachable: archive all years. Hourly rain has no history (last ~42 h only): collect it every 12 h from now on. Daily rain: from Oct 2023 now, backfilled to Oct 2017 by a time-boxed scheduled job. Save raw JSON under pipeline/data/raw/ and tidy Parquet under pipeline/data/tidy/.
3. Make it idempotent and resumable, with polite rate limiting, retries and logging.
4. A coverage report (markdown): per station, the first and last timestamp, gaps, and whether Nov–Dec 2025 is covered.

Use the public endpoints. The open projects github.com/bejranonda/flood2026 and github.com/gain9999/thaiwater are references for endpoints only; do not copy code unless the license allows it.

Separately, check the terms and robots.txt of Malaysia's publicinfobanjir for Kolok/Kelantan gauges. If scraping is allowed, add a similar downloader; if unclear, stop and tell me.

pipeline/data/ is a clone of the private repo nafiscode/jaga-data. After the first run, make a zipped snapshot and attach it to a jaga-data release. Scheduled GitHub Actions in nafiscode/jaga-collectors (weekly refresh, 12-hourly rain, daily backfill) push to jaga-data; fall back to Windows Task Scheduler if ThaiWater blocks GitHub's servers.

Acceptance: I can run one command to refresh the archive; the coverage report shows Nov–Dec 2025 for the available stations; the scheduled jobs push to jaga-data.
```

### S2: SAR flood extents (Google Earth Engine)
```text
Read docs/science-plan.md Module 1, steps 1-2.

Build pipeline/sar_floods/ using earthengine-api (Python). Also produce an equivalent GEE Code Editor JS script for visual checking.

Processing:
- Sentinel-1 GRD IW, VV and VH.
- Speckle filtering.
- Change detection against a dry-season reference composite per relative orbit.
- Threshold per tile (Otsu) with a fallback fixed backscatter-drop threshold. Log all parameters.
- Masks: JRC permanent water (occurrence > 80%), slope > 5°, MERIT Hydro HAND > 15 m, radar shadow/layover.

Events:
- Oct–Jan of every season 2017–2025.
- Priority: the Nov–Dec 2024 and Nov–Dec 2025 events.

Outputs (as COGs):
- per-scene extent
- per-event maximum extent
- flood frequency (flooded / valid observations) for the four provinces

Export to Drive or GCS, and include a download script.

Add a notebook comparing against GISTDA historical flood layers if they can be downloaded; if not, tell me which layers you couldn't access.

Acceptance: maximum-extent maps for both events plus the frequency map; a short methods note with parameters and known issues.
```

### S3: HAND and hazard baseline
```text
Read docs/science-plan.md Module 1, steps 3-7.

In pipeline/hazard/:

1. HAND at 30 m from FABDEM, clipped to the four provinces plus upstream catchments, including the Malaysian side of the Kolok basin.
   - Condition the DEM (breach/fill), then flow direction and accumulation.
   - Choose the stream threshold by comparing the stream network with OSM waterways and JRC water.
   - Use pysheds or WhiteboxTools.
2. Hazard class per cell using the rules in the plan. Keep the rules configurable in YAML.
3. Aggregate per tambon and per village cluster (Open Buildings clusters): share of buildings in each class. Write to a CSV for a hazard_by_tambon table.
4. Export a PMTiles vector layer of the hazard classes, simplified for the web, under about 50 MB.

Acceptance: PMTiles loads in MapLibre; the tambon table is ready for import; the validation notes list CSI against held-out SAR scenes.
```

### S4: Safe-place candidates and ranking
```text
Read docs/science-plan.md Module 2.

In pipeline/safe_places/:

1. Candidates:
   - OSM schools, mosques, temples and government buildings.
   - The official-shelter CSV template (create it for me to fill).
   - High-ground parking candidates: terrain highs near roads with HAND > 8 m (configurable).
2. Features:
   - FABDEM elevation.
   - Local max flood water surface elevation, FwDET-style, from the 2024/2025 extent boundaries.
   - Freeboard and flood frequency at the site.
3. Dry-route analysis: osmnx road graph with edges intersecting the max extent removed (buffered); reachability and travel time from village centroids.
4. Score and exclusions exactly as in the plan. Keep the weights in YAML.
5. Output:
   - a CSV matching the safe_places table, including score_components
   - a prioritized field-verification sheet (CSV plus Google Maps links), ordered by population served, with the questions volunteers must answer

Acceptance: every populated tambon has at least 3 candidates with scores; the field sheet is ready to share.
```

### S5: Threshold hindcast
```text
Read docs/science-plan.md Module 3.

Build notebooks/threshold_hindcast.ipynb and supporting code in pipeline/thresholds/.

1. Create pipeline/data/event_timeline.csv as a template for me to fill: zone, district, flood_onset, peak, receded, source_link, confidence.
2. For each priority zone, compute these signals at T−72, −48, −24, −12 and −6 h before onset (gauges from the S1 archive, which covers both 2024 and 2025 where stations reported):
   - GSMaP basin-average rainfall over 24 h and 72 h
   - gauge level and rate of rise
   - GloFAS discharge (Open-Meteo historical)
   Use SAR scene times and gauge exceedances to refine onset times.
3. Propose provisional Watch/Warning/Evacuate thresholds and typical lead times.
4. Run them across every Oct–Jan from 2017 to 2025 to estimate false alarms. Report POD, FAR and median lead time.
5. Export thresholds.yaml (provisional: true) matching the thresholds table.

Acceptance: a report with a table and plots per zone, clearly marked as provisional, with limitations stated.
```

### S6: Stage-to-extent library
```text
Read docs/science-plan.md Module 4.

For each key gauge in the priority zones:
1. Pair SAR extents with the gauge stage at acquisition time.
2. Build HAND-based synthetic extents in 0.25 m stage steps within the reach catchment. Calibrate the HAND offset to maximize CSI against SAR.
3. Export per-step extent/depth PMTiles plus a lookup table (station_code, stage_m, layer_url).
4. Report CSI per gauge and where the method fails (for example backwater from Songkhla Lake or tide).

Acceptance: layers and a lookup table the app can use; honest notes on reliability per reach.
```

---

## App track

### A0: Scaffold and Jaga brand setup
```text
Read CLAUDE.md, docs/brand.md and docs/spec.md sections 10-11.

Set up the repository:
- Next.js App Router, TypeScript strict, Tailwind, ESLint/Prettier.
- Tests: Vitest and Playwright.
- Supabase CLI local project with PostGIS enabled.
- next-intl with th (default), ms and en message files and RTL-safe layout (logical CSS properties).
- Serwist PWA and an offline app shell. Manifest per docs/brand.md: name, short_name "Jaga", theme_color #1D3B53, background_color #F0F2EE. Icons from public/icons/ (192 and 512 with purpose any; maskable-512 with purpose maskable), plus apple-touch-icon and favicon.svg/favicon-32.png in the page head.
- .env.example (extend the existing one).
- GitHub Actions CI: lint, typecheck, unit tests (alongside the existing ThaiWater workflows).
- Vercel Hobby for development previews; the move to Pro happens before launch (A10).
- Open-Meteo attribution component (used wherever Open-Meteo data appears).
- Folder structure as in CLAUDE.md, plus docs/decisions.md if missing.

Brand setup (docs/brand.md is the source of truth; do not invent a different look):
- Color and alert tokens as CSS variables plus a Tailwind theme. Check every text/background pair for 4.5:1 (3:1 for 24 px and up); if an alert color fails, adjust its lightness and keep the hue.
- IBM Plex Sans Thai 400/500/700 via next/font, with the type scale from docs/brand.md.
- A Logo component: the mark SVG plus the "Jaga" wordmark and "จากา", with horizontal and stacked variants and light/reverse versions. It switches automatically to the small mark below 64 px.
- An AlertBadge component for the five alert levels (icon + label + color) plus the grey "not updated since [time]" stale marker, which sits beside the level badge and never replaces it. Watch uses a backpack icon; no eye icons anywhere except the logo. Also an SOS button component.
- A /dev/brand page showing the logo variants, the tokens and every alert state at 360 px, for my review.

Then, before building real screens, show me ASCII wireframes of home, the SOS flow, the admin alert console and the Transparency tab using these components, and wait for my approval.

Acceptance: npm run dev shows the Jaga-branded Thai home placeholder at 360 px; /dev/brand renders every variant; the contrast check passes; supabase start works; CI is green; the app installs as a PWA with the Jaga icon.
```

### A1: Database schema, RLS and geography seed
```text
Read docs/spec.md sections 3, 8 and 9.

1. Implement the data model in section 8 as SQL migrations, with sensible indexes (GiST on geometries; status and time indexes). Do not create the donation tables; they come in A11.
   Include organizations.public_contact_opt_in (default false), provinces.status, and the SOS fields device_id and suspected_spam (+ spam_dismissed_by/at).
   Include the hazard_type enum and the hazards config table (spec section 8, "Hazards"). Seed flood as active and flash_flood, landslide, fire and earthquake as coming_soon, with th/ms/en placeholder texts and hotlines.
2. Seed admin boundaries from HDX COD-AB Thailand: all 77 provinces (DOPA codes, Thai and English names, simplified geometry), with Pattani, Yala, Narathiwat and Songkhla active and the rest coming_soon; districts and tambons (full geometry plus a simplified web version) for the four active provinces. Put the download/transform script in supabase/seed or pipeline/.
3. Helper SQL functions:
   - tambon_for_point(point)
   - expand_coverage(level, code) → tambon codes
   - unit_covers(unit_id, tambon)
   - rank_safe_places(point, limit) (for now, distance plus the stored score)
   - sos_priority(sos_id)
   - flag_possible_duplicate(sos_id)
4. Enable RLS on every table and implement the access matrix in section 9 exactly.
   - Phone numbers (including authority POC phones) and exact locations are exposed only through security-definer functions that write to audit_log.
   - An org's official phone is public only when public_contact_opt_in is true. Household data needs rescue or coordination capability.
5. RLS tests in tests/rls/ for visitor, user, pending authority, verified authority (in and out of coverage) and admin.

Acceptance: all tests pass, including:
- anonymous users cannot read phones or exact SOS points
- a Yala authority cannot read a Songkhla SOS
- a pending authority sees no personal data
- a user cannot change their own role
- an authority cannot read a POC phone outside shared coverage, and each reveal inside it is logged
- an authority without rescue or coordination capability cannot read households
```

### A2: Authentication and registration
```text
Read docs/spec.md section 3 and CLAUDE.md (Auth).

1. Phone OTP through Supabase phone auth, using the Send SMS Hook and an SmsProvider interface. Implement:
   - a dev adapter that logs to the console
   - an adapter for the Thai SMS provider I choose this week (a stub if not chosen yet)
   Add rate limits per phone and per IP.
   Fallback if the SMS provider isn't ready by launch: authorities can also sign in with LINE Login, and the verification queue gets a "POC phone verified by call" step that the admin completes after calling the POC.
2. LINE Login:
   - First check the current Supabase docs for native or custom OIDC/OAuth provider support that works with LINE.
   - If there isn't any, build a server-side bridge: verify the LINE ID token with LINE's verify endpoint, find or create the user, and create a Supabase session.
   - The LINE Login channel and the Messaging API channel must be under the same LINE provider so user IDs match.
   - Use bot_prompt to offer adding the Official Account as a friend. Store line_user_id.
   - Explain the options and trade-offs to me before implementing.
3. Admin invitations: the super admin invites by email (magic link) or phone (OTP); only invited identities can become admins.
4. Authority registration:
   - Form with all fields in section 3.
   - Coverage selection by province/district/tambon, from both a list and a map, expanded to tambons.
   - Capabilities multi-select.
   - POC phone verified by OTP.
   - Status stays pending until an admin verifies.
5. Minimal user onboarding: display name, optional phone, home location (GPS or map pin), preferred language.

Acceptance: all flows work locally; e2e tests cover them; no client path can set role or status.
```

### A3: Home screen and public map dashboard
```text
Read docs/spec.md sections 4.1-4.4, 7 and 11, and docs/brand.md. Use the brand components from A0 (Logo, AlertBadge, SOS button).

1. Home (villager view), fully usable without loading the map:
   - home-tambon alert as the hero, with the action checklist for the level
   - issue time, next update, stale state
   - saved places' status
   - top-3 safe places from rank_safe_places, with a Navigate button that opens the device's maps app
   - big SOS and Report buttons
   - hotlines (1784, 1669, 191, 199, project line from config)
2. Map dashboard (main public page), MapLibre with OpenFreeMap. Layers:
   - tambon alert status
   - hazard PMTiles (placeholder until S3 delivers)
   - safe places with status
   - report hex bins (server-side aggregation, e.g. PostGIS ST_HexagonGrid) plus moderated photos
   - gauge stations with status and last reading
   Default to the risk view when there are no active alerts, and the live view when there are.
3. Public alert status comes through a cached endpoint (60 s) so push-driven traffic spikes don't hit the database directly.
4. Dashboard tabs per spec section 4.2: Map (default) plus an empty Transparency tab slot. The slot stays hidden until A11 and the donation flag.
5. Province selector driven by provinces.status: the four active provinces are selectable; the other 73 are shown disabled with "Jaga doesn't cover this province yet. In an emergency call 1784 or 1669." Same no-implied-safety rule as placeholder hazards (never a normal/green state).
6. Hazard switcher on the Map tab, driven by the hazards table: Flood active; flash flood, landslide, fire and earthquake as "coming soon" placeholders exactly as in spec section 13. No layers, no all-clear colors, SOS and hotline shown.

Acceptance:
- 360 px layout
- Lighthouse on throttled 3G: home usable in under 3 s
- no exact reports or SOS data in any public response (write a test that checks this)
- a placeholder hazard never renders a map layer or a normal/green state (test)
- a coming-soon province never renders a normal/green state (test)
- a stale alert keeps its level badge and shows the "not updated since" marker (test)
```

### A4: Flood reports and SOS
```text
Read docs/spec.md sections 4.5-4.6 and CLAUDE.md safety rules 1, 4 and 7.

1. Offline queue in IndexedDB for reports and SOS. Retry on reconnect and on app open (Background Sync where supported, manual retry otherwise).
2. Flood report form exactly as specified:
   - client-side image compression
   - voice note via MediaRecorder, handling the different audio formats of Safari and Chrome
3. SOS:
   - two taps from home; location sent immediately
   - anonymous SOS: the phone field is prominent but optional, with the hint "Without a number, rescuers can't call you"
   - never rejected: over the rate limit, a repeat SOS from the same device or phone merges into the open case; otherwise new cases are flagged suspected_spam and still delivered
   - optional details after sending
   - battery level where supported
   - location updates every 5 min while open
   - status timeline for the requester
   - "I'm safe now" and "Confirm I was rescued"
4. Offline fallback: an "SMS instead" button with pre-filled coordinates to the configured project line, plus tel: links for 1784 and 1669.
5. Duplicate flagging and priority scoring via the SQL functions from A1.
6. SOS optional detail "what's happening" (hazard_type: flood, flash flood, landslide, fire, earthquake/building damage, other, not sure). It appears after sending, is never pre-selected, and defaults to unknown. Reports use the generic reports table with hazard_type = flood.

Acceptance:
- an e2e test in offline mode shows the SOS queued, then delivered once back online
- SOS is reachable in 2 taps
- the requester sees status changes
- an SOS over the rate limit is still accepted (merged or flagged), never rejected (test)
```

### A5: Authority console
```text
Read docs/spec.md section 5.

Build:
1. Case board (list and map) for the unit's coverage area, sorted by priority and waiting time, with realtime updates. Suspected-spam cases show their flag and are never hidden.
2. Atomic claim: a unique active claim per SOS, enforced by the database. Release requires a reason.
3. Status workflow exactly as in section 5.2.
4. "Show phone" through the logged function, plus a tap-to-call link.
5. Completion with required photo upload; requester confirmation in the app and through a LINE postback button (the LINE part lands in A7).
6. 12 h fallback confirmation by a second authority or an admin, with photo and note.
7. Hero points ledger with configurable rules, and a leaderboard per province.
8. Responsibility map with gap highlighting (tambons with no verified rescue-capable unit).
9. Reports feed and vulnerable-household list, restricted and logged as specified.

Acceptance: race-condition test on claiming; points only after confirmation; all phone reveals appear in audit_log.
```

### A6: Admin console
```text
Read docs/spec.md sections 6 and 7.

Build:
1. Invitations and admin management (super admin only).
2. Authority verification queue.
3. Alert console:
   - select tambons by map, list, district/province or warning zone
   - level, reason template plus free text, th/ms messages from pre-approved templates
   - next_update_at (required), optional onset and return windows
   - preview of recipients and estimated LINE quota use
   - extra confirmation step for Evacuate
   - publish, supersede, extend, cancel; full history
4. SOS monitor: highlight cases unclaimed for more than 15 min (configurable); assign or escalate to a unit (the notification lands in A7); merge duplicates; review and bulk-dismiss suspected spam (logged, reversible).
5. Report photo moderation.
6. Safe-place management and status updates.
7. Exports (CSV/GeoJSON; anonymized SOS option).
8. Audit log viewer.
9. Handover notes.
10. Times shown in Bangkok time plus the viewer's local time.

Acceptance: a published alert shows on the public map within 1 minute; every admin action is audit-logged; e2e tests for the alert lifecycle.
```

### A7: Notifications (web push and LINE)
```text
Read docs/spec.md sections 4.8 and 6.2, and CLAUDE.md budget guardrails.

1. Web push:
   - VAPID keys and a subscription flow, with the iOS Add-to-Home-Screen guide
   - sends on alert publish (users whose home or saved places are in the affected tambons)
   - sends on SOS status changes (to the requester) and on assignment (to the unit)
2. LINE Messaging API (Edge Functions):
   - webhook for follow/unfollow and postbacks (rescue confirmation)
   - multicast in batches (at most 500 IDs per call) only to affected users
   - one send per alert, with bubbles bundled
   - Flex message templates per level in th/ms
   - rich menu: "My area status" answered by the Reply API (free), "Safe places" and "SOS" open the app
3. Record line_quota_usage and alert_deliveries. Warn admins at 70% and 90% of the monthly quota.
4. Retries with backoff; failures visible in the admin console.

Acceptance: a test alert reaches web-push and LINE test accounts in the affected tambon and none outside it; the quota counter updates.
```

### A8: Data ingestion and signal dashboard
```text
Read docs/science-plan.md Module 3 and docs/spec.md section 6.3.

1. Scheduled Edge Functions (Supabase Cron) for:
   - ThaiWater observations for the four provinces every 15-30 min
   - Open-Meteo rain forecasts (ECMWF/GFS), aggregated to basin averages per warning zone
   - Open-Meteo Flood API (GloFAS) at zone outlets
   - tide/sea level: evaluate ThaiWater's tide and storm-surge data first, with Open-Meteo Marine as the backup; record the choice in docs/decisions.md
   Write to stations, observations and forecasts.
2. Load thresholds.yaml from S5 into the thresholds table, editable by admins with a provisional flag.
3. Signal dashboard per zone: charts, threshold lines, rate of rise, data age, stale flags, and an advisory "suggested level + reasons". Never auto-publish.
4. Gauge status on the public map.
5. When a source goes down, pages must not break; show the last update time.

Acceptance: live data for the priority zones; a simulated source outage handled gracefully; suggested levels shown with their reasons.
```

### A9: Offline and language hardening
```text
Read CLAUDE.md safety rule 7 and docs/spec.md sections 4.1, 7 and 10.

1. Offline cache: app shell, last-known alert status for home and saved tambons, top-3 safe places, hotlines, SOS and report queue, and basemap tiles in a small bounded area around home (check OpenFreeMap's usage terms).
2. Patani Malay for the critical screens (home alert, action checklists, SOS, safe places, hotlines) from the translations I provide. Check RTL if Jawi is chosen.
3. Low-literacy pass: icons on every primary action, Thai body text at least 18 px, contrast AA or better, test in bright-screen conditions.
4. Load stale-state handling for every cached item ("last updated [time]").

Acceptance: airplane-mode walkthrough of home → safe places → SOS works; the Malay screens are complete for the critical flows.
```

### A10: Launch readiness and dry run
```text
Read all docs.

1. Security review: try to escalate privileges and read personal data as each role; check rate limits and secrets. Fix and document.
   Move Vercel to the Pro plan before launch.
2. Load test (k6): 5,000 users opening home within 10 minutes after an alert push; confirm Supabase plan limits and caching hold.
3. Backup and restore test.
4. Staging dry run: replay the observed Nov 2025 data through the signal dashboard while admins issue alerts and test authorities work fake SOS cases. Record issues.
5. docs/runbook.md: what admins do when a data source is down, Supabase is down (fallback: a LINE OA broadcast from LINE's own manager and a static status page), the SMS provider fails, or LINE quota runs out. Include admin shift handover.
6. Launch checklist and go/no-go criteria.

Acceptance: I receive the runbook, the load-test results, the security findings (with fixes) and the dry-run report.
```

### A11: Donations, transparency and admin stipends (behind a feature flag)
```text
Read docs/spec.md section 12, the donation and stipend rows in sections 8 and 9, and CLAUDE.md safety rule 9.

Build, keeping the whole feature behind donation_settings.enabled (default false):
1. Migrations for donation_settings, donations, expenses (with private payee_admin_id), expense_categories, admin_shifts and the monthly_finance view, with RLS exactly as in the section 9 matrix. Add a finance permission flag for admins. Only the super admin approves expenses and stipends.
2. "Support the app" page:
   - the scope statement from spec section 12 (funds only the app's maintenance and operation; no relief collection) plus the configured relief links
   - PromptPay QR generated on the device from the configured PromptPay ID (EMVCo payload), with an optional amount and a "Save QR image" button
   - receiving-account disclosure (the account holder's name as donors will see it in their banking app, and that it is used only for this project until a foundation is registered)
   - "no tax receipt" text from settings
   No bank-transfer text and no external payment links in this version.
3. Optional "I donated" form. The slip goes to a private storage bucket, and a scheduled job deletes slips 30 days after verification.
4. Transparency tab on the main dashboard (fill the slot from A3, shown only when the flag is on; never the default tab, no badges):
   - this month: verified donations, number of donors, expenses by category, running balance
   - since launch: cumulative in and out
   - monthly bar chart with a table beneath it
   - last-updated date and counting rules
   - spending notes
   - stipends shown only as a monthly total plus the number of admins paid
   - opted-in donor wall (amount bands if configured) with moderated messages
5. Admin stipends:
   - shift check-in/check-out in the admin console (admin_shifts)
   - monthly stipend worksheet: eligible shifts per admin (minimum shift length from settings), rate, per-admin cap, overall cap as a share of that month's verified donations, and the surplus left after running costs
   - never propose amounts beyond the available surplus
   - the super admin approves; approved stipends become private-payee expenses in the "admin stipends" category
6. Finance tools: verify or reject donations, enter expenses with receipts, approvals, and CSV export for bookkeeping. Every action is audit-logged.
7. Placement rules from CLAUDE.md rule 9. Write tests proving no donation UI renders in SOS, report or alert flows, in notifications, or on home while the user's tambon is at warning or evacuate.

Do not integrate any payment gateway, and do not store card or bank credentials. Ask me before adding any paid service.

Acceptance:
- with the flag off, nothing donation-related is visible or reachable
- with it on, a test donation can go submit → verify → appear in totals
- a test month with logged shifts produces a stipend worksheet capped by the surplus, and after approval the transparency page shows only totals
- the placement and privacy tests pass (no stipend payee visible to non-finance roles)
```

---

## Later (2027+): template for activating a new hazard
```text
Read docs/spec.md section 13 and docs/science-plan.md section 6.

Goal: activate the [HAZARD] module (currently "coming soon").

1. Propose the data sources and method for [HAZARD] (forecast, nowcast, detection, or SOS only), with honest lead-time and reliability limits. Wait for my approval.
2. Add hazard-specific report fields (in reports.details), th/ms action checklists per alert level, and safe-place suitability rules.
3. Build ingestion or detection jobs. Any automated signal is advisory only; admins issue alerts.
4. Add map layers and a signal-dashboard panel.
5. Flip the hazards row to active only after a dry run with admins.

Acceptance: placeholder replaced; tests show no automated public alerts; the hazard works end to end on staging.
```
