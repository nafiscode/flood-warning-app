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
| Bang Lang dam feed (`jaga-dam-readings`) | The dam card shows its last reading and its age; past 12 h it is marked stale. | Ask EGAT / the dam directly if a release is suspected. A release notice can still be sent from `/admin/dam-release` with figures typed in, and the dam's own operator can send it from `/authority/dam` without the feed at all. |
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

## The automated alarm has sent an alert

**Since 9 Nov 2026 the alarm does not wait for you.** When a ticked gauge's two latest readings
reach its threshold, Jaga publishes the alert in that tick and *then* tells every admin: the bell,
and a notification that shakes the way that level shakes. The alert is already in force when your
phone buzzes. The threshold is the gauge's own **Warning** level, the same one the public map
grades it on (`/admin/signals` shows all three); a zone's key gauge can also reach Evacuate, any
other gauge never says more than Warning on its own.

What to do when one arrives:

1. Open it from the notification or `/admin/alerts#auto-alarms`.
2. Check the gauge on `/admin/signals`: do the gauges upstream agree, and is the rise real?
3. If it is right, leave it and set the next-update time as you would for your own alert. If it is
   wrong, **cancel** it with a reason, or **replace** it with the right level - never delete it.
4. That zone then stays quiet for 12 hours (`quiet_hours`) at that level or lower; a higher level
   publishes again at once.

### A draft that is waiting for you

One case still waits, and only this one: the reading moved faster than a river can
(`system_settings.auto_alarm.sanity`, 2 m an hour by default). Then nothing is published, every
admin's phone rings with a deadline, and the gauge is marked **"Reading looks wrong"** on
`/admin/signals`. Within the grace time (20 minutes):

1. Open the draft from the notification or `/admin/signals`.
2. Decide whether the gauge is broken or the river really did that.
3. **Send** it or **dismiss** it with a reason. If nobody does either, Jaga publishes it anyway at
   the end of the grace time - a broken sensor delays an alert, it never cancels one. If the river
   has gone back below by then, nothing is published.
4. Clear the suspect mark on `/admin/signals` once you trust the gauge again ("Believe this gauge
   again"). Until you do, every crossing on that gauge waits the grace time instead of going out
   at once.

## A dam operator has sent a release notice

The dam's own people can send the release notice themselves since 9 Nov 2026 (A12 part 2,
spec 15). It is **already published** when you hear about it - there is nothing to approve.

What you get: a line in the bell (`A dam operator has sent a release notice`) and one
notification per notice. Both take you to `/admin/alerts`.

What to do:

1. Read it. The notice names the dam, the release in m3/s, the time the gates opened and the
   expected arrival window, and its last line names the dam as the issuer, not you.
2. Decide whether it is enough. You can **extend** it (a new next-update time), **replace** it
   with a different level, or **cancel** it, all from `/admin/alerts` as with any alert. The level
   the dam chose is theirs; raising it is yours.
3. If the notice is marked **Drill**, nobody outside the admins saw or heard it. That is the dam
   rehearsing, and nothing is required of you.
4. If the dam says the gates have shut, a second alert supersedes the first **at the same level**
   and says the water is still on its way. That is correct and deliberate: closing the gates is
   not an all-clear. **Standing the level down is yours alone** - the operator cannot do it.

Giving a dam this power, or taking it away: `/admin/authorities`, on a verified unit that
registered as a dam operator, under "Dams it operates". Confirm with the dam by telephone that
these are its people before you tie it. Untying it takes effect at once. A unit that only operates
a dam deliberately gets none of a rescue team's reads - no request for help, no phone number, no
household data, no case board.

## A river has been rising for a week

Since 10 Nov 2026 (science plan Module 11) Jaga watches something slower than the alert thresholds:
how wet each catchment already is. When a zone's key gauge has risen on **five of the last seven
days** and the **fifteen-day** basin rain is in the **top third** of that basin's own record for the
month, one row is raised for you.

**Nothing has been published and nothing is waiting on a clock.** This is not the automated alarm.
There is no deadline, no draft that sends itself, and the level of every alert in force is
unchanged.

What you get: a silent line in the bell (`A river has been rising for a week`) and one notification
per episode, with the ordinary notice buzz - no alarm pattern, no repeated knock. Both take you to
`/admin/signals`.

What to do:

1. Read the figures in the zone's **"How wet this catchment already is"** block: the floor and how
   many of the last seven days it rose, the rain over 15 and 30 days and since 1 October, and where
   each of those sits in this gauge's or this basin's own record for the month. Open **Month by
   month** for the longer record.
2. **Read it beside the 72-hour rain, not instead of it.** This signal is not early: in November
   2025 at X.40A it would have spoken on the 23rd to the 27th and the river went over its bank on
   the 24th. What it tells you is that the ground has no storage left, so the next burst will do
   more than the same burst would in October.
3. If you agree, press **Start a Watch draft**. That opens the alert console with the zone's tambons
   ticked, the Watch template chosen and these figures as the note. You review the words and press
   send, as with any alert. Nothing is sent until you do.
4. Either way, write down what you decided: **I have acted on it** or **Dismiss**, with a note. That
   closes the line in the bell and is logged under your account. It does not publish anything.
5. The row closes itself when the zone goes quiet, so one spell of weather is one line, not one a
   day.

**When it says it cannot judge.** The block says so in words: a gap in the last eight days of
readings, fewer than fifteen whole days of rain, a gauge whose newest reading is over a day and a
half old, or a month with too little record. That is not "all clear" - it means this particular
signal is blind, and the gauges, the thresholds and the alarm are unaffected.

**What it deliberately does not do.** Whether the floor is above or below normal for the date is
shown as context and is **not** part of the rule: in November 2025 the floor at Yala sat in the
bottom third of its own record until two days before the river left its bank. Do not read a
below-normal floor as reassurance.

**The public map says it too** (10 Nov 2026). The laptop console's rivers card counts the rivers
that rose on five of the last seven days - the same rule, read per gauge from `station_status()` -
and a press on it opens those rivers first. It is the same measurement you are reading, so if you
dismiss a notice the card still shows the rise: the card reports, it does not judge. Only the
stations Module 11 keeps are counted there, and the card says how many of them it could judge.

The figures behind it are rebuilt after the season with `cd pipeline; uv run python -m season_state
run`, which writes `supabase/seed/61_season_state.sql`. The thresholds of the rule itself live in
`system_settings.season_state` and an admin can change them without a migration.

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

## Season review: what people told us, and what changed (A15)

Once a season, after the flood peak and **before the next season starts**. It is the one meeting
that decides what gets built next, so it is driven by the record rather than by memory. Everything
below is on `/admin/feedback`.

1. **Clear the queue first.** Approve or refuse every comment still waiting for the public page.
   The rules are printed on that screen: a comment about the app may be shown; one that asserts
   anything about flooding, water levels or whether an area is safe stays admins-only even when it
   is true, and so does one carrying a phone number, an address, a plate, a named person or one
   SOS case. Nobody's words are ever edited - a comment is shown as it was written or not at all.
2. **The lowest-rated screens.** Read "By screen, worst first" with the answer counts beside it.
   A screen with four answers is a hint, not a finding; write down anything with twenty or more.
3. **The most frequent problems.** Read "What should be better", in order. For each of the top
   five, say which it is: built, planned, or not Jaga's to fix. Remember that **warned too late**
   and **warned too often** are both offered on purpose - a warning system fails in both
   directions, and the people living there are the only ones who can say which way it failed.
4. **Did the rating move?** Compare the average by month against last season's, and against the
   months the alerts went out. A rating that fell in a flood week is about the flood; one that
   fell in a quiet month is about the app.
5. **By language.** The Malay answers separately. A gap between the Thai and Malay averages is a
   translation problem, not a feature problem.
6. **Write what was done, in all three languages**, in "What was done about it" at the foot of the
   page, with the decision entry or commit beside it. That text is what the public page shows next
   to the count, and it is the half of that page that makes it a work list rather than a star
   rating. A weak point with nothing written against it shows "nothing done about this yet" in
   public, which is honest and uncomfortable, which is the point.
7. **Triage everything that is left**: new → read → planned / done / won't do, each with a note
   and, for planned and done, the decision entry or commit it led to.
8. **Answer the people who asked to be answered.** Every `done` item whose sender left a contact
   gets one short message saying what changed. The contact is revealed on a tap, and the tap is
   logged; closing the item clears it.
9. **Write the summary into `docs/decisions.md`**: the lowest-rated screens, the most frequent
   problems, what changed, and whether the rating moved. Then put the same findings on the public
   page beside the figures (step 6) - the public half and the decision log say the same thing or
   one of them is wrong.
10. **Export the CSV** (without contacts) and keep it with the season's other records.

Two things to check rather than assume, every season: that a figure is still being withheld below
twenty answers in a period, and that no feedback link or ask has crept onto an SOS, food-and-water,
report or alert screen, or onto the home screen while somewhere is at Warning or Evacuate. The
tests hold both (`tests/unit/feedback-gates.test.tsx`, `tests/rls/feedback.test.ts`), but a new
screen is a new chance to get it wrong.
