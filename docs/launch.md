# Launch checklist, 2026 season

Target go-live: **Sunday 25 October 2026**. The go/no-go call is the owner's, on **Saturday 24 October**,
against the criteria below. This file is the list; tick items here in commits as they are done
(`[x]`), with the date.

Owner = needs the owner's account or payment. Claude = done from the laptop.

## 1. Before the dry run (by Tue 20 Oct)

- [ ] Security review written up with fixes (`docs/security-review-2026.md`), RLS tests for each fix. (Claude)
- [ ] `docs/runbook.md` written. (Claude)
- [ ] New Supabase organisation on **Pro**, live project created in Singapore (Owner). jaga-dev stays in its free organisation.
- [ ] Live project built from migrations and seed (`npm run db:push` against the live project, then the seed files in order). (Claude)
- [ ] Live project's dashboard settings, copied from SETUP.md (Owner, walkthrough on the tracker):
  - [ ] Authentication → URL Configuration: Site URL `https://jagaapp.org`, redirect URLs `https://jagaapp.org/**`.
  - [ ] Custom OAuth2 provider `custom:line` (as in SETUP.md "One-time: LINE sign-in"), and the live project's callback URL added to the LINE Login channel.
  - [ ] Custom SMTP (Gmail app password), magic-link and invite templates using `{{ .TokenHash }}` → `/api/auth/confirm`.
  - [ ] Daily backups visible under Database → Backups.
- [ ] On the live project: `npm run admin:super -- <project email>`, `npm run push:gate -- https://jagaapp.org`, dam history backfilled (`dam_fetch_range` for the last 60 days). (Claude)
- [x] Vercel stays on **Hobby** for launch (owner, 24 Oct: wait for traffic before paying). Upgrade triggers are in `docs/runbook.md`, "Vercel's free plan limit is reached". (Owner)
- [ ] Vercel Production environment points at the live project (`NEXT_PUBLIC_SUPABASE_URL`, publishable key, and any server key); Preview environment points at jaga-dev for the `staging` branch (Owner, walkthrough).
- [ ] Backup and restore test done and written up. (Claude, with the owner's dashboard access)
- [ ] Load test done and written up (`docs/load-test-2026.md`). (Claude)
- [ ] Replay tool for the dry run ready on staging. (Claude)

## 2. Dry run (Wed 21 Oct)

- [ ] Nov 2025 replayed on staging; alerts issued by the owner; fake requests for help worked by at least one test team on a second phone; the automated alarm rang (drill).
- [ ] Issues written into `docs/dry-run-2026.md`, each with an owner and a fix-by date.

## 3. Fixes (Thu 22 – Fri 23 Oct)

- [ ] Every dry-run issue marked fixed, or accepted with a reason.
- [ ] Credits page live (from `docs/attributions.md`), and every "To verify" row checked at the source.

## 4. Go/no-go (Sat 24 Oct)

**Go only if all of these hold.** A "no" on any one moves launch; the "not in service" text then gets
its new start date.

1. **Requests for help:** on the live site, a request for help from a phone with no account reaches a test team's console, rings, can be accepted, and the sender sees the team. Offline, it waits on the phone and goes out when the signal returns.
2. **Alerts:** an admin publishes an alert on the live project; it shows on the home screen and map within a minute, and reaches a test phone by web push (and by LINE, if the quota allows) in the affected tambon and not outside it.
3. **Hotlines:** 1784, 1669, 191 and 199 are one tap away on every screen, online and offline.
4. **Security:** no open critical or high finding in `docs/security-review-2026.md`.
5. **Load:** the load test met its target (5,000 people opening home in 10 minutes) with no errors attributable to Jaga, inside the plan limits. On Hobby the test also reports CDN requests per visit, so the 1,000,000 a month can be read as a number of people.
6. **Restore:** a backup was restored and checked.
7. **Data:** gauges, dam and forecast feeds have run on the live project for at least 24 hours without a gap longer than an hour.
8. **People:** at least two admins who can take shifts, have signed in on the live site, and have read the runbook; at least one verified response team per province, or a written reason why not.
9. **Words:** the owner has read the Thai of every safety screen (alert, checklists, SOS, safe places, hotlines). Malay may launch as it is, said on the tracker.
10. **Costs:** Supabase Pro is paid; Vercel stays on the free Hobby plan with its upgrade triggers written down (owner, 24 Oct); the LINE plan is decided (the free plan's 500 messages a month cover one alert to fewer than 500 people).

## 5. Launch day (Sun 25 Oct)

In this order, with the owner on the laptop and one admin on a phone:

1. [ ] Vercel → Production → remove `JAGA_DEV_PAGES`, so `/dev/*` answers 404.
2. [ ] Vercel → Production → set `JAGA_IN_SERVICE=1`. Tambons without an alert now show Normal instead of "not in service yet", and the SOS button sends instead of calling first.
3. [ ] Redeploy, then check on a phone: home shows Normal or a level, SOS opens the request form, `/dev/brand` is 404.
4. [ ] Forward `jaga-neon.vercel.app` to `https://jagaapp.org` (Vercel → Domains → redirect).
5. [ ] `/admin/alerts`: the automated alarm switch → **real**, and tick the gauges agreed for the season.
6. [ ] Send one test request for help from a phone without an account, accept it from a test team, close it.
7. [ ] Admins' shift order for the first week posted in their group chat (runbook, "Shift handover").
8. [ ] Announce: LINE broadcast and the share link.
9. [ ] An entry in `docs/decisions.md`: "Jaga in service from <time>".

## After launch

- First week: the owner reads `/admin/usage` and the audit log daily, and Vercel → Usage (Hobby has no warning emails that we know of; at 50% of any meter, upgrade).
- Reminders tab on the tracker carries everything that repeats (keys, quotas, reruns).
