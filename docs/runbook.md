# Jaga runbook

For admins on shift and for the owner. What to do when something Jaga depends on stops working, and
how to hand a shift over. Written for the 2026 season (A10); update it whenever a step here turns out
wrong.

**The first rule of every section:** people in danger must still reach help. Hotlines 1784 (DDPM),
1669 (medical), 191 (police) and 199 (fire) are on every screen and work offline. Nothing in this
runbook ever asks anyone to wait for Jaga.

Times below are Thailand time (UTC+7). The owner works in UTC+3.

## Who does what

| Role | Can do |
| --- | --- |
| Admin on shift | Watch `/admin/signals`, `/admin/war-room` and `/admin/alerts`; issue, extend and cancel alerts; answer the automated alarm; post announcements; write the handover note. |
| Owner (super admin) | Everything above, plus Vercel, Supabase, Cloudflare, LINE Official Account Manager and GitHub. The only person who can change settings outside the app. |

Keep the owner's phone number and a second contact in the admins' own group chat, not in this file
(the repo is public).

## Where to look first

- **`/admin/signals`**: every feed's last reading and its age. A grey "no recent data" means the feed
  is late, not that the river is low.
- **`/admin/alerts`**: alerts in force, the automated alarm log (`#auto-alarms`) and the LINE quota
  bar (warns at 70% and 90%).
- **`/admin/log`**: the audit log, for "who did that?".
- Scheduled jobs (owner only): Supabase dashboard → the live project → Integrations → Cron → Jobs.
  Six jobs: `jaga-gauge-readings` (every 15 min), `jaga-dam-readings` (hourly at :07),
  `jaga-signal-forecasts` (hourly at :11), `jaga-auto-alarm` (every 5 min), `jaga-push-tick`
  (every minute: sends pushes and LINE messages for requests for help), `jaga-usage-rollup` (nightly).

## A data source is down

Jaga keeps showing the last good reading with its time. Nothing on screen turns "normal" because a
feed stopped, and the automated alarm never fires on old readings (it needs two recent ones).

| Source | What breaks | What the admin does |
| --- | --- | --- |
| ThaiWater gauges (`jaga-gauge-readings`) | Gauge figures go grey ("no recent data"); the automated alarm stays quiet for those gauges. RID's gauges are often 6–9 h behind on a normal day; that alone is not an outage. | Check thaiwater.net in a browser. If gauges in your zone are stale during rain, watch the river by other means (RID and DDPM provincial pages, the local network) and issue alerts by hand. Post an announcement only if people are asking. Tell the owner if it lasts over 2 h. |
| Bang Lang dam feed (`jaga-dam-readings`) | The dam card shows its last reading and its age; past 12 h it is marked stale. | Ask EGAT / the dam directly if a release is suspected. A release notice can still be sent from `/admin/dam-release` with figures typed in. |
| Open-Meteo (rain forecast, GloFAS, tide) | The signal dashboard's forecast boxes go stale; weather pages and the sea card say the data is old. | Use TMD (tmd.go.th, 1182) for rain and sea. Forecasts are advice only; nothing is auto-published from them. |
| GISTDA satellite flood layer | The satellite switch on the map says the layer is not available. | Nothing urgent. Tell the owner if it lasts a day. |
| Map tiles (OpenFreeMap, Esri, Jaga's own tiles) | The map's background or flood-risk colours do not draw. The home screen, alerts, safe places and SOS do not need the map. | Nothing for the admin. The owner checks tiles.jagaapp.org and Cloudflare. Esri falls back to the free satellite by itself. |

## Supabase is down (the database, sign-in and storage)

What still works without it: the app shell, each phone's last saved alert status, its top-3 safe
places, the hotlines and the SOS queue (requests wait on the phone and are sent when the database
answers). What stops: new alerts, the console, the war room, sign-in, sending queued requests,
web push and LINE messages for requests.

1. **Confirm it:** status.supabase.com, and whether `/admin/alerts` loads. If only one feature fails,
   it is probably not Supabase.
2. **Tell people through LINE directly** (owner, or an admin with access to LINE Official Account
   Manager): manager.line.biz → Jaga → Broadcast. Write in Thai first, Malay second. Say what is down,
   that requests for help on the phone are being kept and will be sent, and to call 1784 or 1669 in an
   emergency. **Never** put an alert level in this broadcast; levels come only from the reviewed
   templates once Jaga is back. A broadcast counts against the monthly LINE quota (one message per
   friend).
3. **Status page:** the owner edits the status note on GitHub (see "Static status page" below); the
   site redeploys in about 2 minutes, and the note shows on the status page without the database.
4. **Rescue teams** keep working from the case they already have open on their phone and by
   telephone. Admins call the teams they know are on duty.
5. **When it is back:** queued requests arrive by themselves within a minute or two. In the war room,
   check for requests that arrived late and give them priority. Send one LINE broadcast saying Jaga is
   back. Write the times into the handover note and tell the owner, who adds an entry to
   `docs/decisions.md` if anything should change.

### Static status page

`/status` (to be built in A10) reads a small file in the repo, not the database, so it works while
Supabase is down. The owner updates it from github.com: `public/status/notice.json` → edit → commit to
`main`. Leave the file empty (`{}`) when there is nothing to say.

## Vercel is down (the website)

Installed apps keep showing their saved status, safe places and hotlines, and keep requests in the
queue. Nobody new can open the site. Use the LINE broadcast as above. Check vercel-status.com; there
is nothing to fix on Jaga's side.

## Vercel's free plan limit is reached

Jaga is on Vercel Hobby for the 2026 launch (decision of 24 Oct 2026). Hobby cannot bill past its
limits, so it stops instead: 100 GB transfer, 1,000,000 CDN requests, 1,000,000 function calls and
4 CPU-hours a month. New visitors then see `503 DEPLOYMENT_PAUSED`. Installed apps keep their saved
status, safe places and hotlines, and an SOS sent meanwhile waits in the phone's queue with the SMS and
call buttons offered, because it goes through the site (`/api/sos`).

**Upgrade to Pro before that happens.** The owner does it: vercel.com → team → Settings → Billing →
Upgrade to Pro (about 2 minutes, $20 a month, can be undone later). Upgrade when any of these is true:

- Active CPU on Vercel → Usage is past 3 hours (75% of 4), or any other meter is at 50%. On 24 Oct, before launch, the
  meters read: transfer 3.6 GB (3.6%), CDN requests 192k (19%), function calls 94k (9%), active CPU 1h 52m
  (47%). CPU is the tight one: look at it twice a day around launch and on any day with an alert.
- Before the season's first Warning or Evacuate for a wide area, or when heavy rain is forecast.
- Before the donation feature is switched on or any admin stipend is paid: Vercel counts payment for
  producing or hosting the site as commercial use (asking for donations alone is not).
- At once, if visitors see `503 DEPLOYMENT_PAUSED`. Vercel's guide says upgrading resolves the pause; it
  does not say whether it is instant, so also post a notice in `public/status/notice.json` and send the
  LINE broadcast while it clears.

Afterwards, record it in `docs/decisions.md` and set the Vercel spend notification to notify only,
with no automatic action (a budget action can pause the deployment).

## Supabase's free plan: a paused project, size, and no backups

Jaga launches on the free Supabase project `jaga-dev` (decision of 24 Oct 2026). From Supabase's own
pages: free projects "may" be paused after a week of low activity; daily backups exist only on Pro and
free projects are told to export their own data; the limits are 500 MB of database and 5 GB of
egress a month, counted per billing cycle (the owner's runs 28th to 28th; it resets, it is not a deadline). On 24 Oct
Supabase showed the database at 71 MB (14%), egress 1.24 GB (25%) and log ingestion 0.4 of 1 GB (40%, a limit it
marks as upcoming).

- **If the project is paused:** the alerts, requests for help and the consoles stop. Restore it from
  Dashboard → `jaga-dev` → Restore project (a few minutes), post a notice in
  `public/status/notice.json` and send the LINE broadcast meanwhile. Installed phones keep their saved
  status and hotlines and queue an SOS.
- **Backups:** `npm run db:dump` writes a dump to `../jaga-backups/`, outside the repo (it holds phone numbers
  and request locations, so it stays off GitHub, shared drives and chat). Take one before every migration
  and each week; the first was taken on 24 Oct (4.4 MB, 116 tables). A restore into a scratch project
  has not been tested yet.
- **Upgrade to Pro** ($25 a month, Dashboard → organisation → Billing): when the database passes 300 MB
  or egress passes half the month's 5 GB; before the season's first wide Warning or Evacuate; the day a
  sponsor's credit arrives; and at once after any pause. Pro also lets the refresh-token revocation be
  turned off (admins on the iPhone home-screen app stop being signed out) and gives daily backups.
  A separate paid `jaga-live` project is optional then (tracker walkthrough 7 keeps the steps).
- **Never run `npm run db:reset`, the full e2e suite or the RLS suite against `jaga-dev` after launch**
  without asking: it is the live database now.

## The SMS provider fails

Jaga does not send SMS in 2026: phone sign-in stays off until a provider is chosen after launch, and
no request for help depends on SMS. If phone sign-in is later live and fails: people sign in with LINE,
admins with the email link, and teams waiting for verification are verified by a phone call. When
`NEXT_PUBLIC_PROJECT_LINE` is set, the SOS screen's "SMS instead" button goes to that number on the
person's own phone and does not depend on any provider.

## The LINE quota runs out

LINE's free plan allows 500 messages a month, and a message to 300 people counts as 300. The bar on
`/admin/alerts` warns at 70% and 90%.

- **At 70%:** tell the owner. Only the owner can change the LINE plan (it costs money).
- **At 90% or full:** alerts still go out by web push, and the app and its bell show them; only the
  LINE copy fails. Requests for help do not use LINE to reach teams' consoles, but the LINE offer and
  the "were you rescued?" question stop. Teams keep the console open.
- Do not send LINE broadcasts for anything but an outage while the quota is low.
- After a top-up or a plan change, nothing needs restarting; the next send uses it.

## The automated alarm rings

Every admin's phone rings with a draft alert when a ticked gauge's two latest readings reach its
zone's threshold. Within 20 minutes (`system_settings.auto_alarm`):

1. Open the draft from the notification or `/admin/alerts#auto-alarms`.
2. Check the gauge on `/admin/signals`: is the reading plausible (no sudden jump of metres, the gauges
   upstream agree)?
3. **Send** it (edit the next-update time if needed) or **dismiss** it with a reason. If nobody does
   either, Jaga publishes it itself from the reviewed template, marked "not reviewed", and writes it to
   the audit log. Whether that is a drill or a real alert is the switch on `/admin/alerts`; keep it on
   drill until launch day.
4. A dismissed alarm is logged. That zone then stays quiet for 12 hours (`quiet_hours`) at that level or
   lower; a higher level rings again at once.

## An alert went out wrong

Never delete. Open it on `/admin/alerts` and either **replace** it (the new alert supersedes the old,
and people see the change) or **cancel** it with a reason. Then post an announcement if the wrong
alert reached many people. Write it into the handover note.

## Spam requests for help

Requests are never refused (safety rule 1). Repeats from one phone merge into its open case; above the
threshold new cases are flagged `suspected_spam`, but teams still see them with the flag. Admins
review them in the war room and can dismiss them in bulk. Never turn anything off to stop spam.

## Shift handover

At the end of every shift, the admin going off writes a note on `/admin/handover`:

1. Alerts in force, and when each one's next update is due.
2. Open requests for help nobody has taken, and any case that needs a call.
3. Feeds that are stale or down, and since when.
4. The automated alarm: rung and answered, dismissed, or published by itself.
5. LINE quota used this month.
6. Anything promised to someone (a call back, a team, a correction).

The admin coming on reads the last note, opens `/admin/alerts` and `/admin/war-room`, and writes a
one-line note of their own ("taken over, read the note of 06:00"). During Warning or Evacuate somewhere, there must always be one admin awake; arrange
the order in the admins' group chat before the season.

## After any incident

Within a day: what happened, when, who noticed, what was done, what to change. A short entry in
`docs/decisions.md` if something changes; this runbook updated if a step was wrong.
