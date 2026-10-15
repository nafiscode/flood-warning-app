# Security review, A10 (15 October 2026)

Before launch, every role was tried as an attacker would try it: a visitor with no account, a
signed-in resident, a team waiting for verification, a verified team, and an admin. The review
covered every database function and policy (latest definition of each, 80 migrations), every API
route and server action, the service worker, the browser's security headers, the git history,
the GitHub workflows and the dependencies. It was done by reading the code, by querying the
catalogue of the development database, and by trying each finding against that database in
rolled-back tests (`tests/rls/security-a10.test.ts`).

Severity: **critical** = someone in danger could be harmed or exposed; **high** = personal data or
an admin action within reach of a stranger; **medium** = abuse that needs an account or a lucky
guess, or a gap in a safety rule; **low** = defence in depth.

## Findings and fixes

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | **Critical** | Anyone who knew a person's phone number could send a "repeat" request with it. The repeat was merged into that person's open case, moved the case to the attacker's position (often into another tambon, so it left the boards of the teams covering the person), and a signed-in attacker became the case's sender: their exact position, both phone numbers, the team's number, and the power to cancel the rescue. | `submit_sos` takes the case's own key (the token the sender's phone keeps), and the app sends it with every repeat. Only the same account or the key may move a case. A match by phone or device alone still merges (safety rule 1), but the new position goes into the case's history with a note for the teams, and the case stays put; more than 1 km away it becomes a case of its own, counted for the spam flag and delivered. Migrations `20261015135100`, `20261015141300` (a null-safety fix the tests caught). | 6 tests |
| 2 | High | No security headers. Any site could frame the alert console, the team console and the SOS page and trick a tap (clickjacking); no content policy, no referrer or permissions policy. | `next.config.ts` sends a content policy listing only Jaga, its database project and the map sources, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, a referrer policy that still sends the origin Esri's key needs, a permissions policy (location, camera, microphone only for Jaga itself) and HSTS. Checked in a browser on a production build: no violations on nine pages by day and at night, the map draws from every source, and a request to an unlisted site is refused. | probe `.claude/local/csp-probe.mjs` |
| 3 | High | Next.js 16.3.6 had six published advisories (the worst: request forgery through image optimisation, cache poisoning of static pages). | Next.js 16.3.8 (patch release; 16.4 left for after the season). `npm audit` now finds nothing. | `npm audit` |
| 4 | Medium | After signing in, a crafted link (`next=/%09/evil.com`: a tab the browser drops) sent the person to another site, which could then ask for a code "to finish signing in". | `sameSitePath()` refuses control characters and spaces and checks the path is still on this site once parsed; both sign-in checks use it. The locale in redirect paths is checked too. | 4 unit tests |
| 5 | Medium | A reporter could undo an admin's "hidden" on their own report, give it a date in 2099 so it never expired, move it, or insert reports directly past the 12-an-hour limit. | Reports are written only through `submit_report`; the reporter may only add photos and a voice note to a report still pending. | 2 tests |
| 6 | Medium | A team (even a suspended one) could rewrite its own claims directly: take back a case it handed back, move a claim to another case, or backdate "rescued" so a colluding team could confirm it before the sender's 12-hour window. | No direct writes to `sos_claims`; every change goes through the dispatch functions. | 2 tests |
| 7 | Medium | An old function from September (`households_in_tambon`) still handed household phone numbers to covering teams in bulk with one log line, against safety rule 5 (every phone reveal logged). The app no longer used it. | Closed to every client role. Teams use the list without phones and the logged per-household reveal. | 3 tests |
| 8 | Medium | Anyone could post the admin email sign-in form in a loop: inbox flooding, and the project's hourly email allowance used up, so no admin could sign in during a flood. | `email_link_allowed`: 5 links an hour per address, 30 per internet address, asked only with the server's own token (so a stranger cannot use up an admin's allowance by calling it directly). If the check itself fails, the link is sent. Phone codes already had this limit in the SMS hook. | 2 tests |
| 9 | Medium | The service worker kept signed links to request, report and field-rescue photos and voice notes (and Esri tiles carrying Jaga's key) in the phone's cache for an hour; `/sos?place=` pages (a watched place's name and position) were kept for 7 days; sign-out cleared nothing. On a shared team phone the next person could open them. | Those are never cached now; `/sos?place=` offline opens the plain SOS page, which still sends. Signing out asks the worker to forget Next's page data and every page kept with a query, while the offline shell, the SOS queue and the plain pages stay (safety rules 1, 7). | e2e suite |
| 10 | Low | Each poll of a request's page, even for a made-up case, ran the whole push and LINE tick. | The tick runs only after the sender's check, and at most once every 3 s per server. | |
| 11 | Low | SOS details accepted any list of "vulnerable" flags, stored as given. | Only the known flags are kept. | |
| 12 | Low | The short-link follower trusted any `google.<short ending>`, including names anyone can register under a shared suffix (`google.pp.ua`). | An explicit list of Google's domains. | unit test |
| 13 | Low | A team could reveal the POC phone of a unit still waiting for verification (a stranger's personal number) by claiming an overlapping area. | Only a verified unit's POC phone can be revealed. | 2 tests |
| 14 | Low | `submit_sos` could still refuse a request sent straight to the database with a battery over 100 % or a typed location over 300 characters, and a failure in the priority or duplicate check rolled the request back (safety rule 1). | Such values are dropped or cut; both checks are fenced and logged. | 1 test |
| 15 | Low | Visitors held write and TRUNCATE grants on four tables (announcements, notice reads, offers, settings) and signed-in people on twenty more, unused by any policy. RLS blocked them, but TRUNCATE is not subject to RLS. | Revoked, and TRUNCATE removed from the defaults for new tables. | 1 test |

## Accepted, with reasons

- **`'unsafe-inline'` scripts in the content policy.** Next writes each page's data as inline scripts and the theme and early-status scripts run before the first paint. Nonces would make every page render on request and lose the static offline shell (safety rule 7). The policy still blocks scripts from any other site, `eval`, framing and data sent to unlisted sites.
- **A repeat by phone still tells the sender a case is open** ("added to your open request"). Someone who knows a number can learn that its owner has an open request and add a position to its history, which teams see marked as another position from the same phone. Safety rule 1 keeps the merge.
- **Anonymous photos into a fresh case.** For 24 hours after a request is made, anyone who knows its id can add (never replace or delete) up to 3 MB images to its folder. Case ids are random and are no longer handed out by a phone-number repeat.
- **Unauthenticated weather, sea and place-name lookups** pass through to free services; a script could use up their daily allowance. These are advice only; no alert or request depends on them. To revisit if it happens.
- **Usage counter:** random install ids can inflate the admins' usage figures. Counts only; no data is exposed.
- **No `server-only` markers.** No client file imports a server-only module today (checked: all 106 client components). The markers would also break the unit tests that import those modules.
- **The data workflows keep the jaga-data token in their checkout** for the steps after it (`actions/checkout` stores it; `push.sh` uses it). Only Jaga's own pipeline code and its locked dependencies run in those jobs, which never run for pull requests. Changing them in launch week would risk the archive collection; to do in January 2027 with the move to the new runner image (`persist-credentials: false`, token passed to the push step only).
- **Project email in public files.** It is the published project contact, by decision.
- **No secrets in the git history.** All 378 commits use the noreply address. No keys, private keys or personal phone numbers were found; only test numbers.

## Open, for the owner

1. **Report hexagons with a single report.** In a rural tambon a 600 m hexagon holding one report nearly points at one house (safety rule 6, reporter identities). Suggested: show a hexagon only from 2 reporters. Not changed: it alters a screen you approved on 8 Oct.
2. **The automated alarm on jaga-dev is set to publish *real* alerts** (changed from the admin screen on 14 Oct). No gauge is ticked, so nothing can fire. If a gauge is ticked before launch, an unreviewed real alert would reach the live site. Suggested: back to drill until launch day (in the launch checklist).
3. **LINE's free plan (500 messages a month)** covers one alert to fewer than 500 people. Not a security issue, but a "no-go" item on the launch checklist.

## For the live project

Every fix above is a migration, so the live project gets it when it is built. Its dashboard
settings (redirect URLs, email templates, SMTP) are in `docs/launch.md`. The admin email limit
needs the push gate set on the live project (`npm run push:gate`), as web push already does.
