# Jaga (จากา): functional specification, v0.2 (28 September 2026)

Status: MVP for the 2026 flood season. Target go-live is 25 October 2026.
Open items are listed in section 14. Claude Code must ask before resolving any of them on its own.

## 1. Purpose and scope

The app helps people in Pattani, Yala, Narathiwat and Songkhla:
- understand their flood risk before the season,
- receive timely alerts,
- evacuate early to the safest nearby place,
- report flooding,
- call for help.

It lets government and volunteer responders coordinate rescues without duplication. It lets a small admin team monitor conditions, issue alerts and escalate cases.

**Built for more hazards later.** Floods come first, but the data model and UI are hazard-agnostic from day one, so flash floods, landslides, fires and earthquakes can be added later (section 13). In the MVP, those hazards appear only as "coming soon" placeholders. SOS works for any emergency from day one.

**In the 2026 MVP:**
- hazard map
- safe-place ranking
- flood reports
- SOS
- authority coordination with hero score
- admin alert console
- signal (monitoring) dashboard
- web push and LINE notifications
- offline mode
- Thai UI, with Patani Malay on critical screens
- hazard-agnostic data model, with placeholders for non-flood hazards (section 13)
- donations for app maintenance and operation, with a public transparency tab (section 12, behind a feature flag)

**Out of scope until 2027:**
- automated alert publishing
- calibrated hydrodynamic models
- ML forecasting
- native mobile apps
- resource marketplace (boats, supplies)
- collecting, holding or distributing donations for people affected by disasters. The app's donations fund only the app itself (section 12). Relief fundraising would need a registered foundation and a separate legal review.
- forecasts or alerts for hazards other than river/coastal flooding (placeholders only, section 13)
- live GPS tracking of rescue teams

## 2. Coverage and warning zones

- **Admin hierarchy:** province (changwat) → district (amphoe) → subdistrict (tambon), identified by DOPA codes.
- **Provinces:** all 77 are seeded. Pattani, Yala, Narathiwat and Songkhla are `active`; the rest are `coming_soon`. The province selector shows coming-soon provinces disabled, with "Jaga doesn't cover this province yet. In an emergency call 1784 or 1669." It never shows them as safe (same rule as placeholder hazards, section 13).
- **Alerts** are issued per tambon.
- **Warning zones** are groups of tambons along a river reach, used for the signal dashboard and thresholds. The first priority zones are:
  - Pattani River: Bang Lang Dam → Yala city → Pattani
  - Kolok River: Sungai Kolok → Tak Bai
  - U-Taphao canal: Hat Yai → Songkhla Lake
  - Sai Buri, Bang Nara and Thepha follow when data allows.
- **Areas outside the priority zones** still get the hazard map, safe places, reports, SOS and manual alerts.

## 3. Roles

| Role | How to join | Sign-in | Summary |
|---|---|---|---|
| Visitor | No account | None | View map, alerts, safe places, hotlines. Can send SOS; the phone number is optional. |
| User | Self sign-up | LINE Login or phone OTP (equal options) | Everything a visitor can do, plus home and saved places, household profile, reports, SOS with status, alert notifications. |
| Authority | Self-registration, then admin verification | Phone OTP (LINE Login as fallback, see below) | Case board for their coverage area, claim and rescue workflow, contact requesters, hero score. |
| Admin | Invitation by super admin | Email magic link or phone OTP | Monitor, issue alerts, verify authorities, escalate and assign SOS, moderate, export. |
| Super admin | The owner | Email magic link | Everything an admin can do, plus manage admins and system settings. |

**User profile:**
- Required: display name.
- Optional:
  - phone number (verified if they signed in with OTP; typed and unverified if they used LINE Login)
  - home location, which sets the home tambon
  - up to 3 saved places (work, parents' house)
  - preferred language

**Authority registration fields:**
- Organization type: government, private, non-profit, or volunteer team.
- Organization or department name.
- Unit or office name.
- Official phone.
- Point-of-contact name and phone. The POC phone is OTP-verified.
- **Coverage:** multi-select at any level. Selecting a province means all its districts and tambons; selecting a district means all its tambons. Store both what was selected and the expanded tambon list.
- **Capabilities** (multi-select): coordination, rescue, planning, support.
- **Same team, different areas:** register separately under the same organization name with a different POC phone.
- **Status:** `pending` → `verified` → `suspended`. Unverified authorities cannot see personal data.
- **Sign-in fallback:** if the SMS provider is not ready by launch, authorities can also sign in with LINE Login. The admin then verifies the POC phone by calling it during verification.
- **Public contact:** the organization's official phone is shown publicly only if the organization opts in (`public_contact_opt_in`, default off).

## 4. User features

### 4.1 Home screen (villager view)
The home screen is the most important screen. It must be fully usable without loading the map.

**Hero area:**
- The alert level for the home tambon.
- An action checklist for that level (section 7).
- Issue time and next-update time, with a stale warning if overdue.

**Also on the home screen:**
- Status of the user's saved places.
- Top-3 safe places (4.3).
- Large SOS button and "Report flooding" button.
- Hotlines: 1784 (DDPM), 1669 (medical), 191 (police), 199 (fire), plus the project SOS line (see open items).
- Language switch (th / ms / en).

### 4.2 Map dashboard (main public page)
This is the main page, served on MapLibre with the OpenFreeMap basemap.

**Tabs:**
- **Map** (default, always opens first).
- **Transparency** (ความโปร่งใส): donations and running costs (section 12). Shown only when the donation feature flag is on. Always a secondary tab: never the default, never auto-opened, no badges or notifications.

**Hazard switcher (on the Map tab):**
- Flood (river and coastal): active.
- Flash flood, landslide, fire, earthquake: "coming soon" placeholders (section 13).
- A placeholder never looks like "no risk". It states that forecasts for this hazard aren't available yet and that this does not mean there is no risk, then points to SOS and the right hotline.

**Province selector:** the four active provinces are selectable; the other 73 are listed disabled as "coming soon" (section 2).

**Layers:**
- tambon alert status
- hazard (pre-season risk)
- live flood extent (when available)
- safe places with status
- aggregated reports (hex bins) plus moderated photos
- river gauges with status (normal / above watch / above warning), last reading time, and a small chart

**Modes:**
- Pre-season: the risk view (hazard + safe places) is the default.
- During an event: the live view (alerts, reports, flood extent, gauges) is the default.

### 4.3 Safe places
- Show the top 3 ranked from the user's location or a chosen point. The ranking comes from the science pipeline (science-plan Module 2); a PostGIS function combines the stored score with distance.
- **Each place shows:**
  - name and type: official shelter, school, mosque, temple, government building, or high ground for parking cars
  - distance and rough travel time
  - elevation margin above the highest recent flood
  - whether it flooded in 2024 or 2025
  - verification status
  - live status (open / full / closed) and capacity
  - facilities and current needs
- **Navigation:** a "Navigate" button opens the device's maps app with the coordinates. Free, no routing API.
- **Car parking:** high-ground parking spots are listed separately with the same fields.

### 4.4 Evacuation timing and return
- Timing guidance comes from the alert level plus the optional windows admins attach to an alert:
  - expected flooding window, for example "likely from tomorrow evening to Friday morning"
  - expected return window
- These are always shown as ranges with an "estimate" label.
- "Safe to return" is its own alert level (section 7).

### 4.5 Flood report (stored as a generic report with `hazard_type = flood`)
- **Location:** GPS, or a pin placed by the user.
- **Water depth by body reference:**
  - dry
  - ankle
  - knee
  - waist
  - chest
  - above head
  - roof
- **Trend:** rising / steady / falling.
- **Road access:** passable by car / motorbike only / not passable.
- **Media and notes:** up to 3 photos (compressed on the client), an optional voice note (60 s or less), optional text.
- **Offline:** reports queue offline and upload when back online.
- **Visibility:** reports appear publicly only as hex-bin counts. Photos appear publicly only after admin moderation, without the reporter's identity and with the location snapped to the hex.

### 4.6 SOS
**Sending:**
- SOS button → one confirmation screen → sent. That is two taps at most from home.
- Location is sent immediately. It is the only required field.
- Anonymous visitors see a prominent, optional phone field on the confirmation screen, with the hint "Without a number, rescuers can't call you." Sending never waits for it.

**Optional details** (after sending, not before):
- what's happening: flood, flash flood, landslide, fire, earthquake/building damage, other, or not sure. Never pre-selected and never required. Defaults to "not sure".
- number of people
- vulnerable people: elderly, bedridden, infant/child, pregnant, disability, needs medicine, oxygen or dialysis
- water depth (body reference)
- injuries
- voice note, photo, free text

**Automatic data:**
- Battery level, where the browser supports it.
- Location updates every 5 minutes while the SOS is open and the app is open.

**Requester view:**
- Status timeline: received → assigned to [unit] → on the way → rescued.
- Buttons: "I'm safe now" (cancel) and "Confirm I was rescued".

**Offline fallback:**
- Queue the SOS and retry automatically.
- Show an "SMS instead" button that pre-fills a message with coordinates to the project SOS line.
- Show one-tap calls to 1784 and 1669.

**System handling:**
- **Never rejected.** Rate limits never block or delay an SOS.
- **Repeat SOS:** while a case is open, a new SOS from the same device or phone is merged into that case as an update (new location, details, timeline entry), not a new case.
- **Duplicates:** same phone, or within 300 m and 2 hours, gets flagged as a possible duplicate. Admins merge. Never auto-drop.
- **Suspected spam:** above a threshold (per device and per phone, configurable), new cases are still created and delivered but flagged `suspected_spam`. Authorities see the flag; admins review and can bulk-dismiss.
- **Priority score:** computed from vulnerable flags, water depth, number of people, and time waiting.

### 4.7 Household and vulnerability pre-registration (optional)
- **Explicit PDPA consent** for sensitive (health) data, including the purpose: helping authorities plan early evacuation.
- **Fields:**
  - household size
  - counts per vulnerable category
  - mobility notes
  - home location
  - contact phone
- **User control:** the user can view, edit and delete it at any time.
- **Access:** visible only to verified authorities with rescue or coordination capability covering that tambon, and to admins. Every view is logged.

### 4.8 Notifications
- **Web push:** opt-in. On iOS, first show a guide to "Add to Home Screen", which iOS 16.4 or later requires for web push.
- **LINE:** "Add the LINE Official Account" link. LINE Login prompts the user to add the account as a friend.
- **Users receive:**
  - alerts for their home tambon and saved places
  - status updates on their own SOS
  - rescue-confirmation requests

## 5. Authority features

### 5.1 Case board
- Shows the SOS cases in the authority's coverage area, as a list and a map. Sorted by priority, then waiting time.
- Filters: status, tambon, vulnerable flags, suspected spam.
- Cases flagged as suspected spam show the flag; they are never hidden from authorities.
- Shows which unit has claimed each case.
- Updates in real time.

### 5.2 Claim workflow
- **A unit must claim a case before it can update it.**
  - Claiming is atomic: only one active claim per case, enforced by a database constraint.
  - The claim is visible to all authorities and admins.
- **Releasing a claim** requires a reason.
- **Statuses:**
  - Main path: `new` → `claimed` → `en_route` → `on_site` → `rescued_pending_confirmation` → `closed`.
  - Side exits: `cancelled_by_requester`, `duplicate`, `unable_to_reach`, `transferred`.

### 5.3 Contacting the requester
- A "Show phone" button reveals the number and writes to the audit log. A tap-to-call link follows.
- Authorities can also reveal other units' POC phones within shared coverage, for coordination. Each reveal is logged.
- LINE users can also be messaged through the Official Account.

### 5.4 Completion and confirmation
- The authority marks the case "rescued" and must attach at least 1 photo.
- The requester confirms in the app, or through a LINE button, and the case closes.
- **Fallback:** if there is no confirmation within 12 hours (configurable), a second verified authority or an admin can confirm, with photo evidence and a note.

### 5.5 Hero score
- Points are awarded only when a case closes with confirmation. There are no points for claiming alone.
- **Default rule:** 10 points per case, plus 2 per person rescued, plus 3 if vulnerable people were involved. All values are configurable.
- Points are stored as a ledger, so admins can revoke them.
- The leaderboard per province is visible to authorities and admins. Public visibility is an open item.

### 5.6 Responsibility map
- Coverage per unit and capability, shown to authorities and admins.
- Highlights gaps: tambons with no verified rescue-capable unit.

### 5.7 Other views
- Reports feed for the coverage area.
- Vulnerable-household list (with the restrictions in 4.7).

## 6. Admin features

### 6.1 Accounts
- **Invitations:** the super admin invites by email or phone and assigns the role (admin / super_admin).
- **Authority verification queue:** check the details, call the official phone, then verify, reject or suspend.

### 6.2 Alert console
**Choosing the area:** tambons on the map, from a list, by district or province, or by warning zone.

**Alert content:**
- Level (section 7).
- Reason, from a template plus free text.
- Messages in `th` (required) and `ms`, built from pre-approved templates with placeholders.
- `next_update_at` (required).
- Optional expected flooding window and expected return window.

**Before publishing:**
- Preview the number of recipients per channel and the estimated LINE quota use.
- Evacuate alerts need a second confirmation step.

**After publishing:**
- The alert goes out by web push and LINE, and the map updates within 1 minute.
- Admins can supersede, extend or cancel it. Full history is kept.

### 6.3 Signal dashboard (advisory only)
For each warning zone:
- gauges against thresholds, with rate of rise
- observed and forecast basin rainfall
- GloFAS discharge
- tide and sea level
- a *suggested* level with the reasons behind it

Admins decide. The system never auto-publishes. Every data source shows its last-update time and a stale flag.

### 6.4 SOS monitor
- Shows all cases. A case unclaimed for more than 15 minutes (configurable) is highlighted.
- Admins can assign or escalate a case to a unit, which notifies that unit by push and LINE.
- Admins can merge duplicates and see the full case history.
- Admins review cases flagged as suspected spam and can bulk-dismiss them (logged, reversible).

### 6.5 Other admin tools
- **Moderation:** approve or hide report photos for public view.
- **Safe places:** create, edit and verify them; update status (open / full / closed) and needs.
- **Exports:** CSV/GeoJSON of reports, SOS (with an anonymized option) and alerts.
- **Audit log viewer.**
- **Handover notes:** a short shift log for volunteers across time zones.

## 7. Alert levels

| Code | Thai | English | Color / icon | What the user should do |
|---|---|---|---|---|
| `normal` | ปกติ | Normal | green / check | Nothing now. Know your safe places. |
| `watch` | เฝ้าระวัง | Watch | yellow / backpack | Charge phones, pack documents and medicine, plan your route, and check on vulnerable neighbours. |
| `warning` | เตือนภัย | Warning | orange / triangle | Flooding is likely here within about 24–48 h. Move vulnerable people and cars to safe places now. |
| `evacuate` | อพยพ | Evacuate | red / running person | Flooding is imminent or has started. Go to your safe place now. Use SOS if you are trapped. |
| `return` | กลับบ้านได้ | Safe to return | blue / house | Water has receded in this area. Return carefully and watch for damaged roads and electrical hazards. |

- The Malay (`ms`) labels and actions come from the owner (open item). The action checklists live in `messages/*.json`.
- The five levels are shared across hazards. Every alert carries a `hazard_type`, and action checklists are written per hazard and level. In the MVP only flood checklists exist and only flood alerts can be issued.
- A tambon with no active alert shows `normal`.
- An alert past `next_update_at` keeps its level badge and gets a grey "not updated since [time]" marker. Stale is a marker, not a level: five levels + stale marker. The alert is not hidden and not auto-downgraded.
- No eye icons anywhere in the UI except the logo.

## 8. Data model (initial)

### Hazards (multi-hazard readiness)
- `hazard_type` enum: `flood` (river/coastal), `flash_flood`, `landslide`, `fire`, `earthquake`, `other`, `unknown`.
- `hazards` config table:
  - `code`, `name` and `description` per locale
  - `status`: `active` / `coming_soon` / `disabled`
  - `capability`: `forecast` / `nowcast` / `detect` / `sos_only`
  - `hotline`, placeholder text per locale, display order
  - In the MVP only `flood` is `active`.

### Geography
- `provinces`, `districts`, `tambons`: DOPA code, Thai name, English name, geometry (with a simplified web version).
  - `provinces.status`: `active` / `coming_soon` (all 77 seeded; 4 active). Districts and tambons are seeded for the active provinces.
- `warning_zones`: name, basin, `hazard_type`, geometry.
- `warning_zone_tambons`: links zones to tambons.

### People
- `profiles`:
  - `user_id`, `role`, `display_name`
  - `phone`, `phone_verified`, `line_user_id`
  - `preferred_locale`
  - `home_point`, `home_tambon`
  - consent flags, timestamps
- `saved_places`: `user_id`, `label`, `point`, `tambon`.
- `households`:
  - `owner_id`, `point`, `tambon`, `size`
  - `vulnerable` (jsonb counts by category)
  - `mobility_notes`, `contact_phone`
  - `consent_at`, `updated_at`

### Authorities
- `organizations`: `name`, `type`, `official_phone`, `public_contact_opt_in` (default false).
- `authority_units`:
  - `org_id`, `unit_name`, `poc_name`, `poc_phone`, `user_id`
  - `capabilities` (enum array)
  - `status`, `verified_by`, `verified_at`
- `authority_coverage`: `unit_id`, `tambon`, `selected_level`, `selected_code`.

### Places and reports
- `safe_places`:
  - `name`, `type`, `point`, `tambon`
  - `elevation_m`, `freeboard_m`, `flood_freq`
  - `flooded_2024`, `flooded_2025`
  - `score`, `score_components` (jsonb)
  - `capacity`, `facilities`, `parking`
  - `verification_status`, `verified_by`, `status`, `needs`, `updated_at`
  - `suitable_for` (`hazard_type[]`, default `{flood}`). A flood shelter on high ground may be unsafe in an earthquake or fire.
- `reports` (generic; the flood form is the first report type):
  - `reporter_id` (nullable), `hazard_type`, `point`, `tambon`
  - flood fields: `depth_ref`, `trend`, `road_access`
  - `details` (jsonb, for future hazard-specific fields)
  - `photos[]`, `voice_url`, `text`
  - `moderation_status`, `created_at`

### SOS
- `sos_requests`:
  - `requester_id` (nullable), `contact_phone`, `point`, `tambon`
  - `hazard_type` (default `unknown`)
  - `people_count`, `vulnerable_flags`, `depth_ref`, `injuries`
  - `voice_url`, `photos[]`, `text`, `battery_pct`
  - `status`, `priority_score`, `duplicate_of`
  - `device_id`, `suspected_spam` (default false), `spam_dismissed_by`, `spam_dismissed_at`
  - `created_at`, `last_location_at`
- `sos_locations`: location history.
- `sos_claims`: `sos_id`, `unit_id`, `claimed_at`, `released_at`, `release_reason`. Unique active claim per SOS.
- `sos_events`: every status change, actor, note, photos.
- `rescue_confirmations`: `sos_id`, `method` (`requester` / `second_authority` / `admin`), `confirmed_by`, `photos[]`, `note`.
- `hero_points`: ledger with `unit_id`, `sos_id`, `points`, `reason`, `revoked_at`.

### Alerts and notifications
- `alerts`:
  - `hazard_type`, `level`, `reason`, `messages` (jsonb per locale)
  - `issued_by`, `issued_at`, `next_update_at`
  - `expected_onset_window`, `expected_return_window`
  - `superseded_by`, `cancelled_at`
  - `signals_snapshot` (jsonb)
- `alert_tambons`: links alerts to tambons.
- `alert_deliveries`: `alert_id`, `channel`, `recipients`, `line_messages_used`, `status`, `sent_at`.
- `push_subscriptions`: `user_id`, `endpoint`, `keys`, `created_at`.
- `line_quota_usage`: month, messages used, limit.

### Monitoring and admin
- `stations`: `source`, `code`, `name`, `point`, `basin`, `zone_id`, `bankfull_m`, `watch_m`, `warning_m`, `critical_m`.
- `observations`: `station_id`, `ts`, `variable`, `value`.
- `forecasts`: `source`, `target` (zone or point), `issued_at`, `valid_at`, `variable`, `value`, `member`.
- `thresholds`: per zone and signal, the values for each level, with a `provisional` flag and `set_by`.
- `admin_invitations`: `email_or_phone`, `role`, `invited_by`, `status`.
- `audit_log`: `actor`, `action`, `entity`, `entity_id`, `ts`, `details`.
- `handover_notes`: shift log entries.

### Donations, transparency and admin stipends
These tables are created in phase A11 only, not with the initial schema.
- `donation_settings`: single row.
  - `enabled` (feature flag)
  - `receiving_entity_type` (`personal` for now; `foundation` later)
  - `account_holder_display` (the name donors will see in their banking app), `promptpay_id`
  - `tax_receipt_available` (false for now) and text
  - relief links for flood victims
  - stipend policy fields (see section 12)
  - Switching to a foundation later is a settings change, not a code change.
- `donations`:
  - `donor_user_id` (nullable), `display_name`, `anonymous`
  - `amount_thb`, `method` (`promptpay` only for now; keep the column so more methods can be added later)
  - `received_at`, `message`, `show_on_wall`
  - `slip_url` (private), `status` (`submitted` / `verified` / `rejected`)
  - `verified_by`, `verified_at`
- `expenses`:
  - `category`, `amount_thb`, `spent_at`, `description`, `receipt_url`
  - `payee_admin_id` (nullable, stipends only, private)
  - `entered_by`, `approved_by`, `approved_at`
- `expense_categories`: hosting, messaging (LINE/SMS), domain, admin stipends, field verification, improvements. Editable by super admin.
- `admin_shifts`: `admin_id`, `started_at`, `ended_at`, `note`. Check-in/check-out from the admin console, used for stipend eligibility.
- `monthly_finance` (view): donations in, expenses by category, running balance. Only verified donations and approved expenses count.

## 9. Privacy and access matrix (enforced by RLS)

| Data | Visitor | User (own) | Verified authority (coverage area) | Admin |
|---|---|---|---|---|
| Alerts, safe places, hazard layer, gauges | read | read | read | read/write |
| Report counts (hex) and moderated photos | read | read | read | read |
| Exact report location and reporter | none | own | read | read |
| SOS exact location, details, phone | none | own | read (phone reveal logged) | read (logged) |
| SOS suspected-spam flag | none | none | read | read/write (bulk dismiss, logged) |
| Households and vulnerable data | none | own (read/write/delete) | read only with rescue or coordination capability (logged) | read (logged) |
| Authority POC phones | none | none | read within shared coverage (each reveal logged) | read (logged) |
| Authority org name and official phone | read only if `public_contact_opt_in` | same | read | read |
| Any personal phone number | never | own | as above, logged | as above, logged |
| Coverage / responsibility map | none | none | read | read |
| Audit log | none | none | none | read |
| Monthly finance summary, opted-in donor wall | read | read | read | read |
| Donation records (amount, name, message) | none | own | none | read/write if finance permission |
| Transfer slips | none | own (upload) | none | read if finance permission; deleted 30 days after verification |
| Expenses | summary only | summary only | summary only | write if finance permission; super admin approves |
| Stipend payees (which admin, how much) | total and number of admins paid only | same | same | finance admins and super admin only |
| Admin shifts | none | none | none | own shifts; finance admins and super admin read all |

**PDPA:**
- Record consent with its purpose and timestamp.
- Let users delete their account and data.

**Proposed retention (open item, owner to confirm):**
- Personal fields of closed SOS cases (phone, exact location history) are masked 180 days after closure. Aggregates are kept for research.
- Reports are anonymized after 12 months.

## 10. Non-functional requirements

- **Performance:** the home screen loads in under 3 s on throttled 3G. The map is lazy-loaded.
- **Load:** survive a burst of about 5,000 users opening the app within 10 minutes of an alert push. Cache public alert status at the edge for 60 s.
- **Availability:** each data source can fail without breaking pages. Show last-update times.
- **Security:**
  - RLS on every table.
  - Rate limits on OTP, reports and SOS.
  - Audit logging.
  - No secrets in the client.
- **Browsers:**
  - Android Chrome, recent versions.
  - iOS Safari 16.4 or later for push.
  - The core functions work without push.
- **Attribution:** show Open-Meteo attribution wherever its data appears.
- **Offline:** app shell, the last-known alert status of home and saved tambons, top-3 safe places, hotlines, the SOS and report queue, and basemap tiles around home (small, bounded area).

## 11. Design direction

- **Audience:**
  - villagers of all ages, including elderly people and people with low literacy
  - low-end Android phones
  - bright outdoor light
  - high stress
- **Primary job:** "What is my risk, what should I do right now, and how do I get help?"
- **Principles:**
  - One primary action per screen.
  - The alert status is the hero of the home screen.
  - Every primary action has an icon plus a short label.
  - Large type, high contrast.
  - The map is secondary for villagers and primary for authorities and admins.
- **Brand:** the app is Jaga. `docs/brand.md` is the source of truth for the logo, color tokens, the alert palette, typography (IBM Plex Sans Thai) and voice.
- **Colors:** the brand slate and teal stay calm and never signal status. The alert palette (green / yellow / orange / red, plus blue for return and grey for stale) follows common Thai disaster conventions and carries all of the meaning.
- **Tone:** care, not surveillance. The eye in the logo means looking out for each other; the copy never talks about watching people.
- **Process:** before building screens, show component-level details and ASCII wireframes (home, SOS flow, alert console, Transparency tab) built on the brand tokens, for owner approval.

## 12. Donations, transparency and admin stipends (support the app)

**Purpose.** Let people fund the maintenance and operation of the app itself: running costs, improvements and small stipends for active admins. Show them clearly where the money goes.

**Scope, stated on every donation screen:** "Donations support the maintenance and operation of this app only. We do not collect or distribute money or goods for people affected by floods or other disasters. To help affected people, please use these official channels: [relief links]." The relief links are configurable in `donation_settings`. Organizing relief donations may be considered in the future, only after a foundation is registered and a separate legal review.

**Feature flag.** The whole feature is off by default. The super admin turns it on only after the legal check (open item 9) and the account setup are done.

**Receiving account (for now).**
- A dedicated Thai bank account in the founder's name, used only for this app and never mixed with other money, with its own PromptPay ID.
- When scanned, Thai banking apps show the account holder's name. The page therefore states it plainly, for example: "Account name: [owner's name], founder of this app. An account used only for this project until a foundation is registered."
- No tax receipts are issued, and the page says so.
- Moving to a foundation later changes only the settings and the page text.

**Where it appears:**
- A "Support the app" (สนับสนุนแอป) page, reached from the menu or About page.
- Never on the home screen while the user's tambon is at `warning` or `evacuate`.
- Never in SOS, report or alert flows. Never in push or LINE notifications.
- One optional, dismissible thank-you card after a user's SOS case closes, shown no earlier than 7 days later. Owner to confirm.

**Giving method: Thai PromptPay QR only.**
- The QR is generated on the device from the configured PromptPay ID (standard EMVCo payload), with an optional amount field.
- No payment gateway and no fees. Any Thai banking app can scan it.
- A "Save QR image" button lets users pay from the same phone.
- Bank-transfer text and international links are not in the MVP. The data model allows adding them later.

**"I donated" form (optional):**
- Fields: amount, date, display name (or anonymous), short message, "show on donor wall" opt-in, optional transfer slip photo.
- Finance admins verify submissions against the bank statement. Only verified donations count in the totals.
- Slips are private and deleted 30 days after verification.

**Transparency tab on the main dashboard (public):**
- The second tab on the main dashboard (section 4.2), also linked from the "Support the app" page.
- **This month:**
  - verified donations and number of donors
  - expenses by category
  - running balance
- **Since launch:** cumulative donations in and money spent.
- **History:** a monthly bar chart with a table beneath it.
- "Last updated" date, and a note that only verified donations and approved expenses are counted.
- A plain "How to support the app" link to the QR page. No pop-ups, banners or pressure.

**Also on the Transparency tab:**
- Plain-language notes on what was funded, for example "LINE Pro plan for November" or "stipends for 5 active admins during the November event".
- Stipends are shown as a monthly total plus the number of admins paid. No names, unless an admin consents.
- Opted-in donor wall: names or "Anonymous", amount bands rather than exact amounts (owner to confirm), messages after moderation.
- The receiving-account disclosure and the "no tax receipt" line.

**Admin stipends policy (defaults; owner sets the numbers):**
- **Funding order each month:** running costs first (hosting, LINE, SMS, domain). Stipends come only from the surplus, capped at a set share of that month's verified donations.
- **Eligibility:** active admins with logged shifts (`admin_shifts`). The rate is per shift of a minimum length, with a monthly cap per admin.
- **Approval:** the super admin approves every stipend payment. Each one is recorded as an expense in the "admin stipends" category, with the payee kept private.
- **No debt:** stipends are never paid in advance, and never promised when donations don't cover them.
- **Conflict of interest:** because the receiving account belongs to the owner, the owner's own stipend (if any) is decided in open item 10 and disclosed publicly.

**Admin tools:**
- A `finance` permission flag for selected admins. The super admin approves expenses and stipends before they appear publicly.
- Shift check-in/check-out in the admin console, and a monthly stipend worksheet: eligible shifts per admin, amounts, cap applied, surplus available.
- CSV export for bookkeeping.
- Every action is audit-logged.

**Budget:** zero fees for PromptPay. Stipends are paid only from donations, never from the $30–150/month running budget.

## 13. Multi-hazard readiness

**Principle:** design for several hazards now, because it is cheap in the schema and UI and expensive to retrofit. Build only flood for 2026.

| Hazard | Forecastable? | Likely approach later | MVP |
|---|---|---|---|
| Flood (river/coastal) | Yes, hours to days | Current science plan | Active |
| Flash flood | Partly, minutes to hours | Rainfall-threshold nowcasts for steep catchments; existing Thai agency flash-flood risk products if accessible | Placeholder |
| Landslide | Partly | Rainfall intensity–duration thresholds plus slope and susceptibility maps | Placeholder |
| Fire (forest/peat) | Partly | Satellite hotspot detection (NASA FIRMS) plus fire-danger weather; the peat swamp forest in Narathiwat is a known dry-season risk | Placeholder |
| Fire (house/urban) | No | SOS and reports only | SOS works |
| Earthquake | No | Post-event only: official quake reports, SOS, damage reports, safe open spaces | Placeholder |

**Placeholder behaviour:**
- Hazard switcher chip labeled "Coming soon" (เร็วๆ นี้).
- Tapping it shows a short card: what the feature will do, "Forecasts for this hazard aren't available yet. This does not mean there is no risk.", then the SOS button and the right hotline (for example 199 for fire).
- No fake data, no empty map layers, no "all clear" colors.

**What works for every hazard from day one:**
- SOS (with the optional "what's happening" field), the case workflow for authorities, admin escalation and hotlines.

**Adding a hazard later:**
- Set its row in `hazards` to `active`.
- Add its report fields, alert checklists (th/ms), safe-place suitability, and data sources or models.
- Any automated signals remain advisory; admins issue alerts.

## 14. Open items (owner to decide)

1. Script for Patani Malay: Rumi (Latin), Jawi (Arabic script, RTL), or Thai-script Malay.
2. The project SOS phone line for SMS and call fallback, and who staffs it.
3. SMS provider (a Thai local provider is preferred for cost). The owner chooses this week. Decided fallback: LINE Login for authorities, with the POC phone verified by an admin call.
4. Hero score weights, and whether the leaderboard is public.
5. Retention periods (section 9).
6. Decided: the app is named Jaga (จากา). Still open: confirm the Thai spelling, the trademark and app-store search, and the domain (see docs/brand.md).
7. Whether to require a second admin for Evacuate alerts, beyond the confirmation step.
8. Decided: donations go to a dedicated account in the founder's name for now, moving to a foundation once registered. Still open: set up a separate account and PromptPay ID used only for the app.
9. Legal check. Public fundraising in Thailand falls under the Fundraising Control Act B.E. 2487 (1944). Confirm with a Thai lawyer or the district office whether a permit is needed for this setup, or whether a partner foundation covers it.
10. Stipend numbers: rate per shift, minimum shift length, monthly cap per admin, cap as a share of monthly donations, and whether the owner takes a stipend (recommended: no, while the account is in the founder's name). Also: amount bands vs exact amounts on the donor wall, and whether to show the post-rescue thank-you card.
11. Test the Jaga eye mark with residents from both communities, including elderly people. If it reads as surveillance, apply the softening in docs/brand.md.
12. Which hazard to add after flood, and when (a 2027 decision).
13. Whether the Transparency tab should appear before donations are switched on, showing only running costs paid by the founder.

Decided on 28 September 2026 (details in docs/decisions.md): SOS phone optional; SOS never rejected (merge + suspected-spam flag); phone privacy and org opt-in; household access by capability; stale marker; no eye icons; 77 provinces seeded; tide source chosen in A8; budget about $45/month off-season.
