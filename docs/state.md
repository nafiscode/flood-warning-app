# Where things stand

A short, public summary of the live state of Jaga, for a session that has only the
repository: a cloud session started from the Claude mobile app or claude.ai/code, a
second machine before `.env.local` is in place, or a new contributor.

It holds nothing secret and nothing personal. The owner's full working notes stay in
`CLAUDE.local.md`, which is gitignored and never leaves the laptop.

**Keep this file current whenever the answer to one of its questions changes.**
Last updated: 28 November 2026.

## Live

- The app is live at `https://jagaapp.org` (Vercel, free plan). Map tiles come from
  `tiles.jagaapp.org` (Cloudflare R2 behind the Cloudflare cache).
- The database is the free Supabase project `jaga-dev`, in Singapore. There is no
  separate live project: the launch runs on `jaga-dev` (owner, 24 October 2026), so
  **anything applied to it changes the live site**.
- Both Vercel and Supabase stay on their free plans for the 2026 season. The upgrade
  triggers are in `docs/runbook.md`; the admin page `/admin/plans` shows where each
  service stands.
- Go-live was 25 October 2026. Flood peak is November to December.

## Phases

- A0–A19 built. Science modules S1–S11 built; S6 (stage-to-extent) is deliberately
  not on the map this season because its agreement with the radar is low.
- Alerts can be published for real. The automated alarm of safety rule 2 is armed on
  a small number of ticked river gauges.
- Thai copy is reviewed; Malay has had two passes by Claude and still waits for a
  Patani Malay human reader. New Thai and Malay lines are queued for their reviewers —
  assume any string added in the last few weeks has not been reviewed yet.

## A session without database access

A cloud session (phone or web) gets the repository and nothing else. It does **not**
have `.env.local`, `CLAUDE.local.md`, `.claude/local/`, or the private data archive in
`pipeline/data/`. So it cannot reach Supabase, R2, Earth Engine or ThaiWater, and it
cannot run the pipeline, the RLS suite or anything that needs a key.

What such a session should do instead:

- **Work on what is in the repo**: components, routes, `messages/*.json`, docs, tests,
  SQL migration files, pipeline code.
- **Write a migration, never claim it is applied.** Put it in
  `supabase/migrations/`, write its policy tests in `tests/rls/`, and say plainly in
  the pull request that it is unapplied and that the RLS tests have not been run. Only
  the owner applies migrations, from the laptop.
- **Check the 14-digit prefix is unique** before adding a migration:
  `ls supabase/migrations | cut -c1-14 | sort | uniq -d` must print nothing. The
  migration ledger keys on that prefix alone, so two files sharing one make the second
  look applied while doing nothing.
- **Never re-create a database function from a body copied out of an older migration.**
  The live definition may have moved on, and rebuilding "whole" from a stale body
  silently reverts it. That check needs the laptop, so a cloud session should prefer a
  narrow `create or replace` it can justify, or leave the function alone and say so.
- **Stop at a pull request.** Do not push to `main`. CI runs lint, typecheck and the
  unit and RLS suites against a throwaway database, which is the real check; the Vercel
  preview deployment on the pull request is how the owner looks at the change.
- **Run the unit tests with `npx vitest run --no-isolate`.** Do not try the end-to-end
  suite: it needs a dev server and a database.

## What always needs the laptop

Applying migrations · the RLS suite against `jaga-dev` · any `pipeline/` run ·
`npm run db:*` · publishing map tiles to R2 · the LINE rich menu · the push gate ·
anything reading a key.

## The rules that never bend

`CLAUDE.md` is the contract, and its ten safety rules come before any feature. The two
that catch people out most often: **only a human publishes an alert** (the one
exception is the automated alarm, and it is narrowly defined), and **sensitive data is
protected by Postgres row-level security, never by the frontend**. Every decision is
appended to `docs/decisions.md` with its date and a one-line reason.
