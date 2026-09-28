# Jaga (จากา): Claude Code project guide

## What this is
**Jaga** (Malay: "watch over, take care of"; Thai script จากา) is a non-profit flood early-warning and emergency-response web app for four provinces in southern Thailand: Pattani, Yala, Narathiwat and Songkhla.
This is life-safety software. Correctness, clarity and availability come before features.
Floods come first, but the design is hazard-agnostic: every alert, report, SOS and safe place carries a `hazard_type`. Other hazards (flash flood, landslide, fire, earthquake) appear only as "coming soon" placeholders until they are built (`docs/spec.md` section 13).

- Owner and super admin: Nafis, a GIS, remote-sensing and hydrology specialist who works in UTC+3. The service area runs on Asia/Bangkok time (UTC+7).
- Target go-live: 25 October 2026. Flood peak is November to December.
- Scope for 2026: the season-ready MVP defined in `docs/spec.md`. Alerts are issued by admins, not automatically.

## Reference docs
Read the relevant doc before starting a task. Don't load all of them every time.
- `docs/spec.md`: functional spec, roles, data model, privacy rules, workflows, alert levels, design direction
- `docs/science-plan.md`: hydrology and GIS methods, open data sources, the `pipeline/` modules
- `docs/prompts.md`: the phased build plan. The owner pastes one phase at a time.
- `docs/brand.md`: name, logo assets, color and alert tokens, typography, voice. Read it before any UI work.
- `docs/decisions.md`: decision log. Append an entry whenever a decision is made.

## Non-negotiable safety rules
1. Never block or delay an SOS.
   - No extra login wall, no verification step.
   - The only required field is location (GPS, or a manual pin/text if GPS fails).
   - Anonymous SOS is allowed. The phone number is optional but shown prominently, with the hint "Without a number, rescuers can't call you."
   - Never reject an SOS, even when rate-limited. While a case is open, a repeat SOS from the same device or phone merges into that case as an update. Above a threshold, new cases are flagged `suspected_spam` for admin review (admins can bulk-dismiss; authorities see the flag). They are still delivered.
   - When offline, queue the SOS and retry, and offer SMS and call fallbacks.
2. Only humans publish alerts. Code may compute signals and suggest a level. Code must never auto-publish a public alert in the MVP.
3. Every alert shows its level, area, issuer, issue time, reason, and next-update time. Once the next-update time has passed, the alert keeps its level badge and gets a grey "not updated since [time]" marker. Stale is a marker, not a level; never hide or downgrade the level.
4. Official hotlines are always one tap away, including offline: 1784 (DDPM, disaster prevention), 1669 (medical emergency), 191 (police), 199 (fire).
5. Access to sensitive data is enforced by Postgres RLS (row-level security), never by the frontend alone.
   - Covered data: exact locations of SOS requesters, households and reporters; every personal phone number; authority POC phones; vulnerable-household data.
   - Only verified authorities covering that tambon, and admins, can read it. Vulnerable-household data additionally needs rescue or coordination capability.
   - Personal phone numbers are never public. An organization's official phone is public only if the org opts in (`organizations.public_contact_opt_in`, default false).
   - Authorities may read other units' POC phones only within shared coverage.
   - Every reveal of a phone number (including POC phones) or vulnerable-household record is written to `audit_log`.
6. The public map shows only aggregated or moderated data. Never show exact SOS points, rescue-team positions, or reporter identities.
7. Degrade gracefully. These must work offline: app shell, the user's alert status, top-3 safe places, hotlines, SOS queue.
8. Never present a forecast as certain. Show ranges, data timestamps and sources.
9. Keep donations away from emergencies, and keep their scope clear.
   - Donations fund only the app's maintenance and operation. Every donation screen says the app does not collect money or goods for disaster-affected people and links to official relief channels.
   - The Transparency tab on the main dashboard shows the numbers only. It is never the default tab, never auto-opened, and has no badges.
   - Never show donation prompts in SOS, report or alert flows, in notifications, or on the home screen while the user's tambon is at `warning` or `evacuate`.
   - Payments happen only by PromptPay QR, scanned in the donor's own banking app. The app never handles card or bank credentials.
   - Stipend payees and amounts per admin are private. Only totals are public.
   - The donation feature stays behind a feature flag (default off) until the owner turns it on.
10. Placeholders never imply "no risk". A "coming soon" hazard shows no data layer and no all-clear colors. It says forecasts are not available yet, then points to SOS and the right hotline. The same applies to provinces Jaga doesn't cover yet: they are shown disabled with "Jaga doesn't cover this province yet. In an emergency call 1784 or 1669."

## Stack
- **Web app:** Next.js (App Router, TypeScript strict), Tailwind CSS.
- **PWA:** Serwist (`@serwist/next`) for the service worker, offline cache and web push.
- **Backend:** Supabase: Postgres + PostGIS, Auth, RLS, Realtime, Storage, Edge Functions, Cron. Development runs against a free Supabase cloud project (`jaga-dev`) through the Supabase CLI (`npx supabase`); no Docker or local Supabase stack. Free projects pause after ~7 days without activity: restore from Dashboard → `jaga-dev` → **Restore project** (a few minutes). After 90 days paused a project can only be downloaded as a backup, so the migrations and seed must always rebuild it from scratch.
- **Maps:**
  - MapLibre GL JS with the OpenFreeMap basemap (no API key).
  - PMTiles for static layers (hazard, flood extents, stage-to-extent), hosted on Cloudflare R2 and read in MapLibre through the `pmtiles://` protocol from `NEXT_PUBLIC_TILES_BASE_URL`.
- **Large-file storage (Cloudflare R2):**
  - `jaga-tiles` (public: `hazard/`, `extents/`, `stage/`, `assets/`, `manifest.json`) and `jaga-rasters` (private: `dem/`, `sar/`, source COGs). R2 makes a whole bucket public or private, hence two buckets.
  - Science outputs only, never user data. SOS and report media stay in Supabase Storage behind RLS.
  - Keys are write-once and versioned (`hazard/<layer>/<YYYY-MM-DD>.pmtiles`); `manifest.json` names the current file per layer. Upload with `pipeline/r2sync`, which refuses to overwrite.
  - r2.dev URL for development only; `tiles.<domain>` (custom domain on Cloudflare) before launch.
  - Plain R2 storage only. No Workers or other paid Cloudflare products without asking.
  - Never add paid map tiles.
- **i18n:** next-intl with locales `th` (default), `ms` (Patani Malay, critical screens first) and `en` (fallback, dev and admin). Layouts must be RTL-safe in case Jawi script is chosen (use logical CSS properties).
- **Notifications:**
  - Primary: Web Push (VAPID, `web-push`).
  - Secondary: LINE Messaging API, sending multicast only to users in the affected tambons.
- **Auth:**
  - Normal users: LINE Login and phone OTP as equal options.
  - Authorities: phone OTP. Fallback if the SMS provider isn't ready by launch: LINE Login, with the admin verifying the POC phone by calling it during verification.
  - Admins: invite-only, by email magic link or phone OTP.
- **SMS:** Supabase Send SMS Hook calling a provider adapter. The provider is not chosen yet, so keep the interface generic and ship a dev/console adapter.
- **Science pipeline:** Python 3.11+ in `pipeline/` (earthengine-api, rasterio, geopandas, xarray, pysheds or WhiteboxTools, osmnx). Outputs are COG/PMTiles files (uploaded to R2 with `pipeline/r2sync`) plus tables loaded into Supabase.
- **Hosting:** Vercel for the web app (Hobby during development, Pro before launch), Supabase Pro for the database.
- **Attribution:** show Open-Meteo attribution wherever its data appears (free non-commercial use; owner confirming for a non-profit).

## Budget guardrails
- Budget is about $45/month off-season (Supabase Pro + Vercel Pro) and at most $150/month from October to December.
- Ask before adding any dependency or service that costs money, bills per request, or needs a new account.
- Compress images on the client before upload: longest side 1600 px or less, JPEG/WebP quality about 0.7. Keep voice notes to 60 s or less.
- R2 stays inside its free tier (10 GB stored, 1M writes and 10M reads a month; downloads free). Tile reads go through the custom domain's cache before launch. Warn the owner if storage passes ~7 GB.
- Track LINE push-message usage against the monthly quota in the database. Warn admins at 70% and 90%.
- Users poll alert status (every 5 min, or on push/app open). Realtime subscriptions are only for the authority and admin consoles.

## Repo layout
```
app/                 Next.js routes: (public), (user), authority/, admin/
components/          UI components
lib/                 supabase clients, geo helpers, i18n, notifications, offline queue
messages/            th.json, ms.json, en.json (all UI text lives here)
public/brand/        Jaga logo SVGs (see docs/brand.md)
public/icons/        PWA, iOS and favicon PNGs
supabase/migrations  SQL migrations (never edit an applied migration)
supabase/functions   Edge Functions (ingestion, notifications, LINE webhook, SMS hook)
supabase/seed        seed data (admin boundaries, hotlines, templates)
pipeline/            Python science pipeline (see docs/science-plan.md)
pipeline/data/       gitignored here; a clone of the private repo nafiscode/jaga-data (see SETUP.md)
tests/               unit, e2e (Playwright), rls (SQL policy tests)
docs/                spec, science plan, prompts, decisions, runbook
SETUP.md             setting up a fresh Windows laptop
```
Scripts and config never use absolute paths or drive letters; everything is relative to the repo. (The owner's personal laptop keeps the repo on `D:\jaga` because C: is nearly full; tool caches live in `D:\cache`, see SETUP.md.)

## Conventions
- **Database changes:** always via SQL migrations. Enable RLS on every table. Write policy tests in `tests/rls/` for every role.
- **Geography:**
  - Store geometry as EPSG:4326; use `geography` for distance queries.
  - Identify admin areas by official DOPA codes: province 2 digits, district 4 digits, tambon 6 digits.
- **Time:**
  - Store as `timestamptz` in UTC.
  - Display in Asia/Bangkok for users and authorities.
  - The admin console shows Bangkok time plus the viewer's local time.
- **UI text:**
  - No hardcoded strings. Everything lives in `messages/*.json`.
  - Thai is the source of truth for copy.
  - Never machine-translate safety messages at runtime. Alert text comes only from reviewed templates.
- **Brand:** use only the tokens in `docs/brand.md`, via CSS variables and the Tailwind theme. Brand slate and teal never show a status; only the alert palette does. Never recolor the logo.
- **Accessibility:**
  - Alert levels are never shown by color alone: always icon + text + color.
  - No eye icons anywhere in the UI except the logo. Watch uses a backpack icon (get your go-bag ready).
  - Tap targets are at least 48 px. Thai body text is at least 18 px.
- **Mobile-first:**
  - Design and test at 360×640 on low-end Android.
  - Budget for slow 3G: the home screen must be usable without loading the map.
- **Security:**
  - Secrets live only in `.env.local` and Supabase secrets. Keep `.env.example` current.
  - Rate-limit OTP and report endpoints per device and per phone. SOS is never rejected: over the limit it merges or is flagged `suspected_spam` (safety rule 1).
  - Never put a CAPTCHA in front of SOS.
- **Definition of done:** lint, typecheck and tests pass. Briefly report what changed, how it was tested, and anything left open.
- **Commits:** keep them small and reviewable, one logical change each. Commit with the owner's GitHub noreply address, never a personal email. The code repo is public (the data repo is private): no secrets, personal data or employer details in any commit.
- **Contact:** the project email comes from `CONTACT_EMAIL` (`.env.example` / `.env.local`); never hardcode it.
- **GitHub Actions:** default `permissions: contents: read`; jobs using secrets run only in `nafiscode/flood-warning-app`; never use `pull_request_target`; pin third-party actions to a commit SHA.

## Working with the owner
- For each phase, read the phase prompt and the docs it names, then propose a short plan and wait for approval before large changes.
- Keep explanations short and plain. The owner is an expert in GIS and hydrology, so explain app-architecture choices briefly when they matter.
- When something in the spec is ambiguous or conflicts with a safety rule, stop and ask. Don't guess.
- Record each decision in `docs/decisions.md` with the date, the decision, and a one-line reason.

## Commands (keep updated)
- `npm run dev`: web app
- `npx supabase link --project-ref <SUPABASE_PROJECT_REF>`: connect the repo to `jaga-dev` (once per machine; asks for the database password)
- `npx supabase db push`: apply new migrations to `jaga-dev`
- `npx supabase db reset --linked`: wipe `jaga-dev` and rebuild it from migrations and seed (dev project only, never the live one)
- `npm run lint` / `npm run typecheck` / `npm test` / `npm run test:e2e`
- `npm run test:rls`: SQL policy tests
- `cd pipeline && uv run <script>`: science pipeline; `uv run pytest` for its tests
- `cd pipeline && uv run python -m ingest_thaiwater refresh`: refresh the ThaiWater archive in `pipeline/data/` (also `waterlevel`, `rain-daily`, `rain-hourly`, `backfill`, `coverage`, `snapshot`)
- `cd pipeline && uv run python -m r2sync check`: test the R2 connection; also `push`, `ls`, `manifest` (see `pipeline/README.md`)
