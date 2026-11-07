# Replay: method and the dry-run checklist

`replay` feeds a past flood season into a Supabase project with the clock shifted to now, so the
app behaves as if that season were happening live. It is the tool for the launch dry run
(docs/prompts.md A10, docs/launch.md): the signal dashboard rises, a ticked gauge crosses its
threshold, and the automated alarm rings as a drill.

It is **rehearsal and advisory only**. It writes readings into the same tables the live feeds
write; it never issues an alert, and it cannot (safety rule 2). Alerts in the dry run are issued
by a human admin, exactly as in service.

## What it reads

The tidy archive in `pipeline/data` (the private `jaga-data` repo), one parquet per variable per
station per month: `tidy/<variable>/<thaiwater_id>/<YYYY-MM>.parquet`, columns `ts` (UTC), `value`.

- River gauges: `water_level_msl`, `discharge` (30-minute cadence).
- Rain: `rain_1h`, `rain_daily` where present (November 2025 has `rain_daily` but no `rain_1h` in
  the archive, so only daily rain is replayed that month alongside the gauges and dam).
- Dam (Bang Lang, ThaiWater id 50): `dam_level`, `dam_storage`, `dam_released_1h`, and inflow /
  spill if present, hourly.

## What it writes

- Gauges and rain → `public.observations (station_id, ts, variable, value)`, matched to our
  `stations` by `thaiwater_id`. This is what `auto_alarm_check()` and the signal dashboard read.
- Dam → `public.dam_readings`, matched to `dams` by `thaiwater_hourly_id`, one row per moment with
  whichever columns are known then.

Each reading is written with `ts` = the run's start plus the archive time elapsed, compressed by
`--speed`. So the two newest readings of a gauge land seconds apart and count as fresh, which is
what the alarm needs (`confirm_readings` recent readings over threshold).

## The clock

`wall = run_start + (sim_ts − sim_start) / speed`. At the default `--speed 48`, one archive day
plays in 30 minutes and all of November 2025 would take about 15 hours; narrow the window with
`--from`/`--to` to fit the session (a 4-day window ≈ 2 hours, the length of the planned dry run).
Run `plan` to see the exact duration before committing.

## Crons

While a run is going it pauses the ingestion jobs so the live ThaiWater feed does not overwrite
the replayed readings:

- `jaga-gauge-readings`, `jaga-dam-readings`, `jaga-signal-forecasts` → paused
  (`cron.alter_job(active := false)`).
- `jaga-auto-alarm` and `jaga-push-tick` → left running; they are what is being rehearsed.

They are turned back on when the run ends or is interrupted (Ctrl-C). If a run is killed harder
than that, `uv run python -m replay restore` turns them back on.

## Safety

- `plan` (the default) writes nothing.
- `run` refuses without `--yes` (or `JAGA_REPLAY_CONFIRM=1`), prints the project ref and host
  first, and refuses outright if the target is the same project as `LIVE_DB_URL` — the same guard
  `scripts/db.mjs` uses, so a copied `.env.local` cannot aim the replay at the live database.
- It only ever writes to `observations` and `dam_readings`; it does not touch alerts, SOS,
  reports, or any account data.

## Dry-run checklist (operator)

1. `cd pipeline && uv run python -m replay plan --from 2025-11-23 --to 2025-11-27` — pick a window
   whose rise crosses the gauges you will tick, and a `--speed` that fits your time.
2. In the admin console, tick the river gauge(s) for the automated alarm, and set the alarm
   `mode` to **drill** (`system_settings.auto_alarm`) so nothing reaches the public.
3. `uv run python -m replay run --from … --to … --speed … --yes` against the dev/staging project.
4. Watch the signal dashboard rise and the alarm draft appear; have an admin send or dismiss it,
   or let the grace time publish the drill.
5. Ctrl-C (or let it finish). Confirm the ingestion crons are back on (`replay restore` if unsure).
6. Rebuild the dev project afterwards if you want the test readings gone (`npm run db:reset`,
   dev only), or delete the replayed rows.

## Not yet

- The dam's own release notice is raised inside `dam_fetch()`, which is paused during a run, so
  dam-driven notices are not exercised by the replay (the river-gauge alarm is). A later version
  could call `dam_signal()` after each dam row.
- A threshold-crossing preview in `plan` (which gauges will cross, and when) would save guessing
  the window; it needs the per-zone thresholds from the database.
