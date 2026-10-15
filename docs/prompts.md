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

Build in pipeline/ingest_thaiwater/:
1. A script that lists every ThaiWater station (water level and rainfall) inside the four provinces. Use a province bounding box plus the station's province field (tambon boundaries arrive in A1). Save station metadata to pipeline/data/stations.csv: code, agency, name, lat/lon, basin, bank-full/warning/critical levels if provided.
2. A downloader that fetches all available history per station and variable. Water level is limited to 365 days per request but older years are reachable: archive all years. Hourly rain has no history (last ~42 h only): collect it every 12 h from now on. Daily rain: from Oct 2023 now, backfilled to Oct 2017 by a time-boxed scheduled job. Save raw JSON under pipeline/data/raw/ and tidy Parquet under pipeline/data/tidy/.
3. Make it idempotent and resumable, with polite rate limiting, retries and logging.
4. A coverage report (markdown): per station, the first and last timestamp, gaps, and whether Nov–Dec 2025 is covered.

Use the public endpoints. The open projects github.com/bejranonda/flood2026 and github.com/gain9999/thaiwater are references for endpoints only; do not copy code unless the license allows it.

Separately, check the terms and robots.txt of Malaysia's publicinfobanjir for Kolok/Kelantan gauges. If scraping is allowed, add a similar downloader; if unclear, stop and tell me.

pipeline/data/ is a clone of the private repo nafiscode/jaga-data. After the first run, make a zipped snapshot and attach it to a jaga-data release. Scheduled GitHub Actions (weekly refresh, 12-hourly rain, daily backfill, keepalive) push to jaga-data; fall back to Windows Task Scheduler if ThaiWater blocks GitHub's servers.

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

**S5 first pass done** (14 Oct): `pipeline/thresholds` (`basins`, `rain`, `glofas`, `hindcast`), report and
`thresholds.yaml` beside the code, all provisional. The event timeline was filled from news and the
irrigation department's flood summaries instead of by the owner (decision 14 Oct). Not done: the
notebook and the plots (the report is tables only), forecast rain, tide, and the false-alarm check
for 2017 to 2019 beyond counting the alarms (no gauge record then).

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

### S7: Dam release (Bang Lang)

Added 9 Oct 2026. Read `docs/science-plan.md` Module 7 and the decision of 2026-10-09.

Before launch:
1. Add the dam to the ThaiWater collector: hourly and daily series for Bang Lang, backfilled as far as the API goes, then on the same schedule as the gauges. Tests offline.
2. List the past releases and measure the travel time to each gauge along the Pattani River; write the method and its limits into a methods note.
3. The downstream zone and the arrival ranges per tambon, as a table the app can load.
4. Show the result to the owner before it is used anywhere.

Acceptance: the collector fills the archive without gaps it does not report; every arrival time is a range with the events behind it; a place the analysis cannot speak for says so.

**All four steps done** (9 to 13 Oct): the collector, the travel times and arrival ranges
(`dam_arrivals`), the interim path from OpenStreetMap and, on 13 Oct, the zone from the elevation
model anchored on the gauges' highest levels (`dam_release zone`; METHODS.md "The zone"). Open:
the owner's choice between the path and the zone, and the question of unrecorded releases
(METHODS.md "The outside check"), which S5's rainfall will help settle.

### S8: Seasonal outlook

```text
Read docs/science-plan.md Module 9 and pipeline/seasonal_outlook/METHODS.md.

Steps 1 to 4 below were done on 14 Oct 2026 (METHODS.md has the results; the outlook for season
2026 is "no reliable lean"). Each season: rerun `models` and `outlook` when the October NMME files
appear, score the past season in February. The original steps:
1. A second rainfall record for the same seasons (ERA5-Land; ThaiWater and TMD gauges where they
   reach back). Compare totals, wettest five and fifteen days, and the trend with CHIRPS. Say plainly
   which findings survive.
2. Seasonal forecast models, free sources only (ask before anything that needs a new account):
   fetch the hindcasts for the box around the four provinces and score each model's lean
   (drier, normal, wetter) against what happened, season by season. Report the score beside
   "always say normal" and "ENSO alone".
3. Only if a source beats those: build the outlook as odds for the three thirds with its past
   hit rate, as a small table the admin signal dashboard (A8) can read. No public screen.
4. Propose, do not build, the wording and place of a public version, for the owner to decide.

Rules: an outlook is a range with its skill and its date, never "there will be floods" or "there will
be none" (safety rule 8). A dry-leaning outlook changes nothing in readiness and is never shown as an
all-clear (safety rule 10). No alert is ever issued from it (safety rule 2).
```

## App track

### A0: Scaffold and Jaga brand setup
```text
Read CLAUDE.md, docs/brand.md and docs/spec.md sections 10-11.

Set up the repository:
- Next.js App Router, TypeScript strict, Tailwind, ESLint/Prettier.
- Tests: Vitest and Playwright.
- Supabase CLI project (npx supabase) for the free cloud dev project jaga-dev, reached through SUPABASE_DB_URL (npm run db:*); PostGIS enabled by the first migration. No Docker.
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
- An AlertBadge component for the five alert levels (icon + label + color) plus the grey "not updated since [time]" stale marker, which sits beside the level badge and never replaces it. Watch uses a backpack icon; no eye icons anywhere, and no umbrella icons except the logo. Also an SOS button component.
- A /dev/brand page showing the logo variants, the tokens and every alert state at 360 px, for my review.

Then, before building real screens, show me ASCII wireframes of home, the SOS flow, the admin alert console and the Transparency tab using these components, and wait for my approval.

Acceptance: npm run dev shows the Jaga-branded Thai home placeholder at 360 px; /dev/brand renders every variant; the contrast check passes; migrations apply to jaga-dev with npm run db:push; CI is green; the app installs as a PWA with the Jaga icon.
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
2. Active dispatch exactly as in section 5.2: `sos_offers`, the relay through rescue units, then coordination units, then the admins' monitor; windows from `system_settings` (60 s and 90 s defaults); the countdown; decline with a reason; the on-duty switch per unit. Who holds the offer is computed from elapsed time on every read, so there is no server timer to fail; a one-minute cron only fires the notifications. The case stays on every covering unit's board throughout, and any of them can accept at any second.
3. Atomic claim: accepting takes the unique active claim, enforced by the database. Release requires a reason and returns the case to the relay. Status workflow and dispatch state exactly as in section 5.2.
4. Arrival estimate: asked straight after accepting, never before, in the bands of 5.2; the card keeps asking until it is given; changeable at any time; shown to the requester as a band with the time it was given.
5. "Show phone" through the logged function, plus a tap-to-call link. The requester's screen shows the accepting unit's POC phone under the rules of 5.3 (the unit's tick, on by default; logged; masked on close). "Navigate" opens Google Maps with the case as destination, with the warning that road directions do not know which roads are flooded.
6. Sounds and vibration as in 4.8, synthesized in the app with no audio files: the looping offer alarm in the console (with a one-tap arm, since browsers block audio until then), the accept chime and the rescued resolve on the requester's screen. Silent for Watch and Normal; every sound paired with a vibration pattern and with words on screen.
7. Completion with required photo upload; requester confirmation in the app and through a LINE postback button (the LINE part lands in A7).
8. 12 h fallback confirmation by a second authority or an admin, with photo and note.
9. Hero points ledger with configurable rules, and a leaderboard per province.
10. Responsibility map with gap highlighting (tambons with no verified rescue-capable unit).
11. Reports feed and vulnerable-household list, restricted and logged as specified.

Acceptance: race-condition test on claiming; a case offered to a unit that does not answer reaches the next unit and finally the admins' monitor, and is never removed from a covering unit's board; points only after confirmation; all phone reveals appear in audit_log, including the requester seeing the accepting unit's POC phone.
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
   - sends the dispatch offer of A5 to the unit being asked, so the alarm reaches a phone with the console closed; the push carries the time the offer expires, and the system notification sound (a web push cannot carry its own)
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
3. Signal dashboard per zone: charts, threshold lines, rate of rise, data age, stale flags, and an advisory "suggested level + reasons". Never auto-publish, except the automated alarm for ticked gauges (owner, 14 Oct 2026; safety rule 2).
4. Gauge status on the public map.
5. When a source goes down, pages must not break; show the last update time.

Acceptance: live data for the priority zones; a simulated source outage handled gracefully; suggested levels shown with their reasons.
```

**A8 built** (14 Oct): `gauges_fetch()` every 15 minutes and `signals_fetch()` every hour (migrations
`a8_gauges_live`, `a8_signals`), zones, gauges, thresholds and the feed setting from the generated seed
`46_zones_gauges_thresholds.sql`, the dashboard at `/admin/signals` (`lib/signals.ts`,
`components/admin/Signals.tsx`, example at `/dev/signals`) and `admin_set_threshold`; later the same day
the automated alarm, per-gauge levels, gauges on the public map, the zones' tambons, ThaiWater's tide
evaluated (it has none; Open-Meteo Marine stays, decisions 14 Oct), the page reading itself every
5 minutes, and an outage test (`tests/rls/feed-outage.test.ts`). Open: live rain is a model's while the
thresholds were set on satellite rain.

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
   Move Vercel to the Pro plan before launch. Remove JAGA_DEV_PAGES from the Vercel production environment, so /dev/* pages return 404 in production.
2. Load test (k6): 5,000 users opening home within 10 minutes after an alert push; confirm Supabase plan limits and caching hold.
3. Backup and restore test.
4. Staging dry run: replay the observed Nov 2025 data through the signal dashboard while admins issue alerts and test authorities work fake SOS cases. Record issues.
5. docs/runbook.md: what admins do when a data source is down, Supabase is down (fallback: a LINE OA broadcast from LINE's own manager and a static status page), the SMS provider fails, or LINE quota runs out. Include admin shift handover.
6. Launch checklist and go/no-go criteria. The checklist includes setting JAGA_IN_SERVICE=1 in Vercel on launch day (until then a tambon without an alert shows "not in service yet", never Normal), and updating the start date in the "not in service" text if launch moves.

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

### A12: Dam release notice

Added 9 Oct 2026. Read `docs/spec.md` section 15 and the decision of 2026-10-09. Two parts.

Part 1, before launch (with A6 and A8): a "dam release" alert template that admins send, with the affected tambons and the arrival ranges from S7 filled in, and the dam's state on the admin signal dashboard.

**Built 10 Oct 2026** (the owner asked for it with the map work): the dam, its reservoir and the
release path on the public map; the hourly feed and the grading (`dam_fetch`, `dam_signal`); the
quiet notice on the home screen and the map for people on the path; and the review row on the war
room.

**Part 1 finished 13 Oct 2026**: the arrival ranges from S7 on the dam notice and both cards, and
the template with the screen that sends it (`/admin/dam-release`, `admin_send_dam_release`,
`admin_cancel_alert`). **Still not built:** the sound, which waits for web push (A7) - a notice
today makes none, because nothing is pushed.

Both parts send the **dam release sound** of spec 4.8 and docs/brand.md: its own repeating sound, used for nothing else, to everyone in the zone — the tambons along the river below the dam and the lower reaches of the streams joining it.

Part 2, after someone at the dam has agreed to use it: the dam operator role and its one screen (spec section 15). RLS tests for the role: it can send a dam release notice to the fixed zone and nothing else.

### A13: Impact record and public transparency (after launch)
```text
Read docs/spec.md sections 16 and 9, and CLAUDE.md safety rules 5, 6 and 9.

Build on the first season's real data. An empty page showing zeros is honest; invented figures are not.

1. Nightly aggregation (Edge Function on Cron): fill impact_daily (per province per day) and impact_unit_totals from sos_requests, sos_offers, sos_claims, rescue_confirmations, alerts, alert_deliveries, reports and the usage counters. Idempotent: running it twice for the same day changes nothing. Drop the raw usage_events rows for a day once it is counted.
2. Usage counting in Jaga's own code, never a third-party analytics service. The device hash is salted per day, so the same phone cannot be linked across days. Count app openings, alerts delivered, SOS sent, reports and safe-place lookups.
3. Waiting times per province: median and spread for sent to first offer, to accepted, to on site, to confirmed. Never per case or per unit in public.
4. /impact, public, no account, prerendered and cached like the other public pages: what Jaga carried, what the teams confirmed, and the failures beside them (cases no team accepted, cases that reached the admins, longest waits, cases closed unconfirmed). Every unit listed by province and name with the volume of its help; no ranking anywhere; no person named. The sentence that Jaga carried requests and the teams did the rescues. The sentence that most help in a flood happens outside the app.
5. Suppression: province and day are the finest grain published, and a figure that could point at one household is not published. A test asserts it.
6. CSV and JSON export of exactly the published aggregates.
7. Links from About and the footer only. Nothing from the home screen, the dashboard, SOS, report or alert screens; no notification, no badge.
8. Charts: load the dataviz skill before writing any of them.

Acceptance: no published figure identifies a person or a household (test); re-running the nightly job changes nothing; /impact loads without an account and appears nowhere in the SOS, report or alert flows (test); the exports match the page.
```

### A14: Requests for food, water and essentials (built 13 October 2026)

Spec 4.10. A second kind of request beside the rescue SOS, for people who are safe and cut off, and a `supplies` capability for the teams that deliver. Built on the SOS record and the A5 relay. Still to do when A7 lands: the push notification for a supply offer uses the phone's ordinary notification sound, never the alarm channel.

### A15: Experience rating and feedback (after launch)

Added 15 Oct 2026 (owner's request).
```text
Read docs/spec.md sections 17 and 9, and CLAUDE.md safety rules 1, 5 and 9.

1. Migration: the feedback table of spec section 8 with RLS. Anyone (anon included) sends through a function that rate-limits per phone and per account and never raises for anything the sender can get wrong; a signed-in sender reads and deletes their own; admins read and triage. The contact is shown only through a function that writes to audit_log.
2. The form: rating 1-5 as faces with a word under each (icon + word, never colour alone), an optional topic and comment, an optional "you may contact me" tick with its contact field and recorded consent. Thai first, then Malay and English. Tap targets 48 px, works at 360 px, queued offline like a report.
3. Where it appears: Account, About and the footer always. The quiet asks after a closed and confirmed request, an ended report, and a team's finished case; once per phone per 30 days. Never in SOS, food-and-water, report or alert screens, never in a notification, never on home while the person's area or a watched place is at Warning or Evacuate (test this).
4. Context captured automatically: screen, language, app version, kind of phone, role, chosen district (never tambon, never GPS), and for a post-request rating the case id (admins only).
5. LINE: a rich-menu entry and a reply that store into the same table.
6. Admin page /admin/feedback (add it to ADMIN_ITEMS in the review group): list with filters, triage statuses (new, read, planned, done, won't do, hidden), a note, and a link to the decision or commit; trend charts per month, screen and language (load the dataviz skill first); CSV export without contacts.
7. Retention: comments anonymised after 12 months and contacts cleared on close, by a nightly job; ratings kept as figures.
8. A season review checklist in docs/runbook.md (new file): lowest-rated screens, most frequent problems, what changed, whether the rating moved; summary into docs/decisions.md.

Acceptance: an anonymous visitor can send a rating offline and it arrives later; no feedback prompt appears in any SOS, report or alert flow or during Warning/Evacuate (test); a visitor cannot read anyone's feedback and a contact reveal is logged (RLS tests); the admin page shows the trends and every item can be traced to its outcome.
```

### A16: Guided tours for every role (before launch)

Added 15 Oct 2026 (owner's request): a short guided tour of each page and feature, for each role, shown on a person's first two visits.
```text
Read docs/spec.md sections 3 and 4, docs/brand.md, and CLAUDE.md safety rules 1, 4, 7 and 9.

1. One tour per page and role: visitor and resident (home, the Flood Risk Map and its features, safe places, watched places, reports, food and water, My requests, the bell, notifications, install, account), response team (the console, an offer and its alarm, accepting, arrival band, finishing with a photo, field rescues, coverage map, points), team waiting for verification, and admin (the menu groups, alerts and drills, signals and the automated alarm, war room, moderation, safe places, dam release, usage, previews). A tour is a few steps that point at the real control on the page and say in one or two plain sentences what it is for.
2. Shown automatically on the first two visits to that page in that role on this phone (kept on the phone; synced to the account when signed in), never again after "Skip" or "Don't show again", and always available again from a "Show me around" link on the page and in Account.
3. Never in the way of help: no tour on SOS, food-and-water, report sending or any alert screen; never while the person's area or a watched place is at Warning or Evacuate; never over the hotline bar; a tour never blocks a tap on SOS (it closes when SOS is pressed).
4. Accessible: every step reachable by keyboard and screen reader, focus returns where it was, 48 px targets, Thai body text 18 px, works at 360 px and in the dark theme, no motion under reduced motion, and works offline for the pages that work offline.
5. Words in messages/*.json (Thai first, Malay, English); short, plain and low-literacy friendly. Roles previewed through /admin/preview show their tour too, so admins can check them.
6. Tests: each page's tour points only at elements that exist (a test fails if a target is missing), the first-two-visits rule, skip and replay, and the never-on-SOS / never-at-Warning rules.

Acceptance: a new visitor, a new team and a new admin each see their tours on the first two visits and not on the third; nothing appears on SOS or during Warning/Evacuate; every tour can be replayed; the owner has read the Thai.
```

### A17: "What Jaga can do" page (built 16 October 2026, `/features`)

Added 15 Oct 2026 (owner's request): one page that shows, for each role, what Jaga lets them do. Not a manual: short, visual, and enough to show what the app is capable of.
```text
Read docs/spec.md sections 3 and 4, docs/brand.md, and CLAUDE.md safety rules 1, 4 and 9.

1. One public page, open without an account, linked from About, the footer, Account and the guided tours (A16). Sections per role: resident and visitor, response team, food-and-water team, admin (and the dam operator once it exists). Each section: a few capabilities, each one line with an icon and a picture or short animation of the real screen, and a button that opens that feature.
2. Honest: says what Jaga is (a carrier of alerts and requests, never the rescuer), shows "coming soon" hazards as placeholders only (safety rule 10), and puts the hotlines and the SOS button where they always are.
3. Light: usable at 360 px on slow 3G, pictures lazy-loaded, no motion under reduced motion, works in both themes; words in messages/*.json, Thai first.
4. No donation prompt on it (safety rule 9).

Acceptance: a person in each role can find, in under a minute, what they can do and open it; the owner has read the Thai.
```

### A18: "How Jaga works" knowledge pages (before launch, or soon after if time is short)

Added 15 Oct 2026 (owner's request): for academics and partners who want to understand the science and the system. Conceptual, not a recipe.
```text
Read docs/science-plan.md, the pipeline METHODS.md files, docs/spec.md and docs/attributions.md.

1. The science page: what each part of the map is and why (flood history from satellite radar, the flood-prone classes and how they were checked against real floods, the dam release zone and travel times, gauge thresholds and the automated alarm, safe places, the seasonal outlook, the sea), the concept and logic of each in plain terms, the open data sources with their credits and licences, what each part can and cannot tell, and how it was validated. No parameter values, thresholds, code paths or step-by-step methods: enough to understand and judge it, not enough to replicate it.
2. The system page: how the app works as a concept, in general terms only (a web app that works offline, a database that enforces who may see what, scheduled jobs that read river gauges and the dam, a notification service for phones and LINE, file storage for map layers). Never a vendor or product name. Covers privacy by design (what is never shown, what is logged), how a request for help travels to a team, how alerts are issued and why only people publish them (with the one automated alarm), and how it keeps working when parts fail.
3. Public, open without an account, linked from About and the footer only; never from SOS, report or alert screens. Same light-page rules as A17. Words in messages/*.json; English may lead for this page, Thai and Malay follow.
4. A contact line for researchers who want to collaborate (CONTACT_EMAIL), not the methods themselves.

Acceptance: an academic reader understands what each layer means, where its data come from and how far to trust it, without being given a method to copy; no vendor name appears on the system page (a test checks the words); the owner has approved both pages.
```

### A19: Highway paths in the authority console (after launch)

Added 16 Oct 2026 (owner's choice): Module 8 part 2 is built (`pipeline/highway_paths`, 15 Oct) but its lists only sit on the laptop. The offices get them as a page of their own in the authority console, not as a document pack and never in the public app.
```text
Read docs/science-plan.md Module 8, pipeline/highway_paths/METHODS.md, docs/spec.md sections 3, 5 and 8, and CLAUDE.md safety rules 5, 6, 8 and 10.

1. Migration: `highway_sections` (one row per 500 m section: geometry, the stretch id, road kind and number, name, province/district/tambon codes, class, score, the reasons as structured fields, the largest crossing's catchment and the nearest mapped opening, the radar run id and the run date) and `highway_stretches` (the joined neighbours, told by their best section). RLS: readable by admins and by verified authorities with the `planning` capability whose coverage falls in that province; never anon, never a resident, never a rescue-only unit. Province scope, not tambon: an office works on a whole road. Nothing in it is personal data, so no reveal logging is needed, but the page view is written to `audit_log` like the other authority views.
2. A loader beside the pipeline (`python -m highway_paths load`, or a generated seed): reads `out/highway_paths/sections.geojson` and the per-province CSVs, replaces the rows of the previous run in one transaction, keeps any note an office left (step 5).
3. The page `/authority/highway-paths` (add it to the console's other views, spec 5.7, and to the authority menu): the stretches of the unit's own province, "look here first" before "worth a look", each with its reasons in plain words, the tambon and district, a map link, and the figures behind it. A map layer of the sections over the flood-history layer, coloured by class (not alert colours: these are not alert levels - see docs/brand.md). Downloads for their own GIS: CSV and GeoJSON of their province only.
4. Wording, in messages/*.json, Thai first: never "this road blocks the flood". It says where the radar record looks as if water stood on one side, that it is to be checked on imagery and on the ground, that the radar sees extent and not depth, that a wetter side can be a paddy or a natural low, and that most culverts are not in OpenStreetMap, so "no mapped opening" usually means "not mapped" (safety rule 8: never present it as certain). It feeds no alert level, no suggestion and no notification.
5. One note per stretch from the office that owns it (free text plus a status: not looked at, checked on imagery, checked on the ground, an opening exists, work planned, done), visible to that province's `planning` units and to admins. It is their working record, never public, and it survives a reload of the pipeline's rows.
6. Who may see it: a provincial highway office (แขวงทางหลวง) or irrigation project office (โครงการชลประทาน) registers as an authority with the `planning` capability and province-wide coverage. Check and state in the spec that `planning` alone opens no SOS, no household data and no phone reveal (safety rule 5); if it does today, close that first.
7. Tests: RLS for anon, a resident, a rescue-only unit, a `planning` unit in another province, a `planning` unit in its own province and an admin; a unit test that the page shows no alert colours and no words claiming the road blocks the flood; the download carries only the unit's own province.
8. Docs: a decision entry, the science plan's Module 8 marked as delivered this way, and a line in docs/runbook.md on reloading the rows after each season's radar rerun.

Acceptance: a verified planning unit in Pattani signs in and sees the 32 flagged stretches of Pattani with their reasons, a map and a download, and nothing of the other three provinces; a rescue team and a resident cannot reach the page or the rows at all (RLS tests); nothing of it appears in the public app; the owner has read the Thai.
```

### A20: About page (before launch)

Added 16 Oct 2026 (owner's request): one short public page that says what Jaga is, who runs it and how to reach it, and that holds the links to the other "about Jaga" pages.
```text
Read docs/spec.md sections 1, 9 and 16, docs/brand.md, docs/attributions.md, NOTICE and README.md, and CLAUDE.md safety rules 4, 9 and 10.

1. One public page, `/about`, open without an account: what Jaga is in a few lines (a non-profit flood early-warning and help app for Pattani, Yala, Narathiwat and Songkhla; the name means "watch over, take care of"); what it is not (it carries alerts and requests, the teams rescue; it does not replace 1784 or 1669); who runs it (a small group of volunteer admins, by role, never a personal phone or address); the areas it covers and the ones it does not yet ("Jaga doesn't cover this province yet. In an emergency call 1784 or 1669").
2. Links to the other pages: What Jaga can do (A17), How Jaga works (A18, once built), the data credits and licences (from docs/attributions.md, Open-Meteo attribution included), a plain privacy summary (what is never public, what is logged, how to ask for data to be removed), and the source code (Apache-2.0; the Jaga name and logo are not covered, as NOTICE says).
3. Contact: the project email from CONTACT_EMAIL, never hardcoded; a line for agencies and rescue teams on how to register.
4. Donations: none while the feature flag is off; when it is on, at most one plain link to the Transparency tab, never a prompt (safety rule 9).
5. Reachable from the end of every page (beside "What Jaga can do"), from Account, and from the guided tours (A16); never from SOS, report or alert screens. Same light-page rules as A17: 360 px, slow 3G, both themes, words in messages/*.json, Thai first.

Acceptance: a visitor learns in a minute what Jaga is, who runs it, what it covers and how to reach it; every link on it opens; no personal detail and no donation prompt appears; the owner has read the Thai.
```

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
