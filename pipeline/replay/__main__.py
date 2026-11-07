"""Command line: `uv run python -m replay <command>` from the pipeline folder.

Commands
  plan         (default) read the window from the archive and print what a run would write: the
               gauges and dam it found, the number of readings, the archive span, and how long
               the run would take at the chosen speed. Touches no database.
  run          feed those readings into the database with the clock shifted to now, pausing the
               ingestion crons for the duration and restoring them on exit. Refuses without
               --yes, and refuses a target equal to LIVE_DB_URL.
  restore      turn the ingestion crons back on (jaga-gauge-readings, jaga-dam-readings,
               jaga-signal-forecasts). For when a previous run was killed before it could.

Common options
  --from / --to   window in the archive, YYYY-MM-DD (default: all of November 2025).
  --speed         how many archive-seconds pass per real second (default 48: a day in 30 min).
  --tick-seconds  how often the loop writes what has come due (default 20).
  --only          all | gauges | dam (default all).
  --yes           required by `run`: confirm writing to the named project.

The database is SUPABASE_DB_URL (the dev project) from the environment or repo .env.local, the
same address scripts/db.mjs uses. Advisory and rehearsal only: this writes readings, never an
alert (safety rule 2). Method and the dry-run checklist: replay/METHODS.md.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

from ingest_thaiwater.settings import data_dir, env_value

from . import core, db

log = logging.getLogger("replay")
UTC = timezone.utc


def _parse_day(s: str, *, end: bool) -> datetime:
    d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)
    return d.replace(hour=23, minute=59, second=59) if end else d


def _window(args: argparse.Namespace) -> tuple[datetime, datetime]:
    lo, hi = core.default_window(2025, 11)
    if args.start:
        lo = _parse_day(args.start, end=False)
    if args.end:
        hi = _parse_day(args.end, end=True)
    if hi <= lo:
        sys.exit("The --to date must be after --from.")
    return lo, hi


def _flags(only: str) -> tuple[bool, bool]:
    return only in ("all", "gauges"), only in ("all", "dam")


def cmd_plan(args: argparse.Namespace) -> int:
    root = data_dir()
    t_from, t_to = _window(args)
    want_gauges, want_dam = _flags(args.only)
    events = core.build_events(root, t_from, t_to, want_gauges=want_gauges, want_dam=want_dam)
    if not events:
        print(f"No readings in the archive for {t_from.date()}..{t_to.date()} under {root}.")
        return 1
    sim_start, sim_end = events[0].sim_ts, events[-1].sim_ts
    gauges = {e.thaiwater_id for e in events if e.kind == "gauge"}
    dams = {e.thaiwater_id for e in events if e.kind == "dam"}
    by_var: dict[str, int] = {}
    for e in events:
        key = e.field if e.kind == "gauge" else f"dam/{e.field}"
        by_var[key] = by_var.get(key, 0) + 1
    dur = core.wall_duration(sim_start, sim_end, args.speed)
    print(f"Archive:   {root}")
    print(f"Window:    {sim_start:%Y-%m-%d %H:%M} .. {sim_end:%Y-%m-%d %H:%M} UTC")
    print(f"Readings:  {len(events):,}  from {len(gauges)} gauges and {len(dams)} dam(s)")
    for key in sorted(by_var):
        print(f"             {by_var[key]:>7,}  {key}")
    print(f"Speed:     {args.speed:g}x  ->  a run would take about {_human(dur.total_seconds())}")
    print("\nThis is a plan only; nothing was written. Use `run --yes` to feed it in.")
    return 0


def _human(seconds: float) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, _ = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    return f"{m}m"


def cmd_restore(args: argparse.Namespace) -> int:
    url = args.db_url or env_value("SUPABASE_DB_URL")
    if not url:
        sys.exit("No SUPABASE_DB_URL in the environment or .env.local.")
    target = core.parse_target(url)
    print(f"Project:   {target.label()}")
    with db.connect(url) as conn:
        for name in db.INGESTION_CRONS:
            ok = db.set_cron_active(conn, name, True)
            print(f"  {'on ' if ok else 'n/a'}  {name}")
    print("Ingestion crons restored.")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    url = args.db_url or env_value("SUPABASE_DB_URL")
    if not url:
        sys.exit("No SUPABASE_DB_URL in the environment or .env.local.")
    live = env_value("LIVE_DB_URL")
    if core.same_database(url, live):
        sys.exit(
            "Refusing: the target is the same project as LIVE_DB_URL. The replay writes test "
            "readings and must never touch the live database."
        )
    target = core.parse_target(url)

    root = data_dir()
    t_from, t_to = _window(args)
    want_gauges, want_dam = _flags(args.only)
    events = core.build_events(root, t_from, t_to, want_gauges=want_gauges, want_dam=want_dam)
    if not events:
        sys.exit(f"No readings in the archive for {t_from.date()}..{t_to.date()}.")
    sim_start, sim_end = events[0].sim_ts, events[-1].sim_ts
    dur = core.wall_duration(sim_start, sim_end, args.speed)

    print(f"Project:   {target.label()}")
    print(f"Readings:  {len(events):,}  spanning {sim_start:%Y-%m-%d %H:%M}..{sim_end:%H:%M} UTC")
    print(f"Speed:     {args.speed:g}x  ->  about {_human(dur.total_seconds())} to finish")
    if not args.yes and os.environ.get("JAGA_REPLAY_CONFIRM") != "1":
        sys.exit("Refusing without confirmation. Re-run with --yes to write to this project.")

    with db.connect(url) as conn:
        gauge_ids = db.station_ids(conn, [e.thaiwater_id for e in events if e.kind == "gauge"])
        dam_map = db.dam_codes(conn, [e.thaiwater_id for e in events if e.kind == "dam"])
        if want_gauges and not gauge_ids:
            log.warning("No archive gauges matched public.stations (thaiwater_id). Is it seeded?")
        _run_loop(conn, events, sim_start, args, gauge_ids, dam_map)
    return 0


def _run_loop(conn, events, sim_start, args, gauge_ids, dam_map) -> None:
    # Record which ingestion crons were on, so only those are turned back on afterwards.
    was_on = db.cron_state(conn, db.INGESTION_CRONS)
    stopping = {"flag": False}

    def _stop(*_a):
        stopping["flag"] = True

    signal.signal(signal.SIGINT, _stop)
    try:
        for name in db.INGESTION_CRONS:
            if db.set_cron_active(conn, name, False):
                log.info("paused cron %s", name)
        run_start = datetime.now(UTC)
        monotonic0 = time.monotonic()
        i = 0
        total = len(events)
        written = {"gauge": 0, "dam": 0, "skipped": 0}
        last_report = 0.0
        while i < total and not stopping["flag"]:
            cutoff = sim_start.timestamp() + (time.monotonic() - monotonic0) * args.speed
            dam_batch: dict[tuple[str, datetime], dict[str, float]] = {}
            while i < total and events[i].sim_ts.timestamp() <= cutoff:
                e = events[i]
                ts = core.wall_due(e.sim_ts, sim_start, run_start, args.speed)
                if e.kind == "gauge":
                    uid = gauge_ids.get(e.thaiwater_id)
                    if uid:
                        db.insert_observation(conn, uid, ts, e.field, e.value)
                        written["gauge"] += 1
                    else:
                        written["skipped"] += 1
                else:
                    code = dam_map.get(e.thaiwater_id)
                    if code:
                        dam_batch.setdefault((code, ts), {})[e.field] = e.value
                    else:
                        written["skipped"] += 1
                i += 1
            for (code, ts), columns in dam_batch.items():
                db.upsert_dam_reading(conn, code, ts, columns)
                written["dam"] += 1
            now = time.monotonic()
            if now - last_report >= 10 or i >= total:
                sim_now = datetime.fromtimestamp(cutoff, UTC)
                log.info(
                    "sim %s | %d/%d written (gauge %d, dam %d, unmapped %d)",
                    sim_now.strftime("%Y-%m-%d %H:%M"),
                    i, total, written["gauge"], written["dam"], written["skipped"],
                )
                last_report = now
            if i < total and not stopping["flag"]:
                time.sleep(args.tick_seconds)
        log.info("replay %s", "stopped" if stopping["flag"] else "finished")
    finally:
        for name, on in was_on.items():
            if on:
                db.set_cron_active(conn, name, True)
                log.info("restored cron %s", name)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    p = argparse.ArgumentParser(prog="replay", description="Replay a past flood season into the DB.")
    p.add_argument("command", nargs="?", default="plan", choices=["plan", "run", "restore"])
    p.add_argument("--from", dest="start", metavar="YYYY-MM-DD", help="window start (default 2025-11-01)")
    p.add_argument("--to", dest="end", metavar="YYYY-MM-DD", help="window end (default 2025-11-30)")
    p.add_argument("--speed", type=float, default=48.0, help="archive seconds per real second")
    p.add_argument("--tick-seconds", type=float, default=20.0, dest="tick_seconds")
    p.add_argument("--only", choices=["all", "gauges", "dam"], default="all")
    p.add_argument("--yes", action="store_true", help="confirm writing (required by run)")
    p.add_argument("--db-url", dest="db_url", help="override SUPABASE_DB_URL (advanced)")
    args = p.parse_args(argv)
    if args.speed <= 0:
        sys.exit("--speed must be positive.")
    return {"plan": cmd_plan, "run": cmd_run, "restore": cmd_restore}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
