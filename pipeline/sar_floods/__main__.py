"""Command line: `uv run python -m sar_floods <command>` from the pipeline folder.

Commands
  events                 list the configured events and their date windows (no Earth Engine)
  check                  test the Earth Engine sign-in and every dataset and band the code uses
  run EVENT [--dry-run] [--with-thresholds] [--scale M] [--force]
                         plan one event and start its Drive exports. EVENT is an id from `events`
                         (e.g. event-2024-nov-dec, season-2024) or `all-seasons`.
                         --dry-run lists scenes and planned exports and starts nothing;
                         add --with-thresholds to also compute and log the per-tile thresholds.
  prepare EVENT [--dry-run] [--scale M] [--force]
                         start one asset export per orbit: the dry reference and the layover mask of
                         the event's season. `run` then reads them instead of recomputing them for
                         every pass (about 60 % less compute). Wait for these tasks before `run`.
  status [RUN_ID]        task states and EECU-seconds of a run (default: the latest with tasks)
  download [--dry-run]   fetch finished exports from Google Drive into <output_dir>/drive/
  frequency [--allow-missing]
                         flood frequency over all seasons from the downloaded per-season rasters
  upload-plan [--date YYYY-MM-DD]
                         print the r2sync commands for the downloaded files (runs nothing)
  aoi                    rebuild aoi.geojson from supabase/seed/10_provinces.sql

Settings: sar_floods/config.yaml; the Cloud project from EE_PROJECT (environment or .env.local).
Every run writes a JSON log to <output_dir>/runs/. Exit codes: 0 ok, 1 fixable error, 2 Earth Engine
or Drive error.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

from ingest_thaiwater.settings import PIPELINE_DIR, today_bangkok

from . import aoi, naming, runlog, seasons, settings

log = logging.getLogger("sar_floods")


def _setup_logging(paths: settings.Paths) -> None:
    logs = paths.root / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in (logging.StreamHandler(sys.stdout),
              logging.FileHandler(logs / f"sar-{datetime.now():%Y%m%d}.log", encoding="utf-8")):
        h.setFormatter(fmt)
        root.addHandler(h)
    for noisy in ("googleapiclient", "urllib3", "rasterio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _events(cfg: dict) -> int:
    for ev in seasons.events(cfg):
        windows = ", ".join(f"{a} to {b}" for a, b in seasons.reference_windows(ev, cfg))
        print(f"{ev.id:22} {ev.start} to {ev.end}   reference {windows}"
              f"{'   per-scene exports' if ev.per_scene else ''}")
    return 0


def _check(cfg: dict) -> int:
    from . import ee_ops

    print(f"earthengine-api {ee_ops.init(settings.ee_project())}, signed in")
    ok = True
    for label, passed, detail in ee_ops.check(cfg, aoi.load()):
        print(f"{'ok  ' if passed else 'FAIL'} {label}: {detail}")
        ok = ok and passed
    return 0 if ok else 2


def _run(cfg: dict, args, command: str) -> int:
    from . import run

    if args.event == "all-seasons":
        todo = [ev for ev in seasons.events(cfg) if ev.kind == "season"]
    else:
        try:
            todo = [seasons.find_event(args.event, cfg)]
        except KeyError:
            raise settings.ConfigError(f"Unknown event '{args.event}'. `sar_floods events` lists them.") from None
    if args.command == "prepare":
        for ev in todo:
            rl = run.prepare_references(cfg, ev, dry_run=args.dry_run, force=args.force, command=command)
            log.info("run log: %s", rl.path.relative_to(PIPELINE_DIR))
        return 0
    if args.with_thresholds and not args.dry_run:
        raise settings.ConfigError("--with-thresholds only makes sense with --dry-run.")
    for ev in todo:
        rl = run.run_event(cfg, ev, dry_run=args.dry_run, with_thresholds=args.with_thresholds,
                           force=args.force, command=command)
        log.info("run log: %s", rl.path.relative_to(PIPELINE_DIR))
    return 0


def _status(cfg: dict, args, paths: settings.Paths) -> int:
    from . import run

    if args.run_id:
        path = paths.runs / f"{args.run_id.removesuffix('.json')}.json"
        if not path.exists():
            raise settings.ConfigError(f"No run log {path.name} in {paths.runs.relative_to(PIPELINE_DIR)}.")
        rl = runlog.RunLog.load(path)
    else:
        rl = runlog.latest_run(paths.runs, with_tasks=True)
        if rl is None:
            raise settings.ConfigError("No run with started tasks yet.")
    counts = run.update_status(rl)
    for e in rl.data["exports"]:
        eecu = e.get("task", {}).get("batch_eecu_usage_seconds")
        print(f"{e['state']:26} {e['name']}" + (f"   {eecu:.0f} EECU-s" if eecu else "")
              + (f"   {e['task']['error_message']}" if e.get("task", {}).get("error_message") else ""))
    print(f"{rl.data['run_id']}: " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))
          + f"; {rl.data['eecu_seconds_total'] / 3600:.2f} EECU-hours so far")
    return 0


def _download(cfg: dict, args, paths: settings.Paths) -> int:
    from . import drive

    for line in drive.download_all(drive.service(settings.ee_project()), cfg["export"]["drive_folder"],
                                   paths.drive, args.dry_run):
        print(line)
    return 0


def _frequency(cfg: dict, args, paths: settings.Paths) -> int:
    from . import frequency, grid

    scale = cfg["export"]["scale_m"]
    params_hash = settings.params_hash(cfg, settings.aoi_sha256())
    years = list(range(cfg["seasons"]["first"], cfg["seasons"]["last"] + 1))
    files = frequency.season_files(paths.drive, years, scale, params_hash)
    missing = [y for y in years if y not in files]
    if missing and not args.allow_missing:
        raise settings.ConfigError(
            f"No downloaded raster for season(s) {missing} with parameters {params_hash} at {scale} m. "
            "Run and download them, or pass --allow-missing to use only the seasons present.")
    master = grid.master_grid(aoi.bounds(aoi.load()), cfg["export"]["crs"], scale, cfg["export"]["snap_m"])
    present = sorted(files)
    if not present:
        raise settings.ConfigError("No season rasters found. Run `sar_floods download` first.")
    dest = paths.products / (naming.frequency_name(present[0], present[-1], scale, params_hash) + ".tif")
    summary = frequency.write_frequency(files, master, dest)
    log.info("wrote %s: seasons %s, %d pixels observed, %d flooded at least once",
             dest.relative_to(PIPELINE_DIR), summary["seasons"], summary["pixels_observed"],
             summary["pixels_ever_flooded"])
    return 0


def upload_commands(paths: settings.Paths, day: date, base: Path = PIPELINE_DIR) -> list[str]:
    """The r2sync command for every downloaded or locally computed raster and every run log with tasks."""
    lines = []
    rasters = sorted(paths.drive.glob(naming.PREFIX + "*.tif")) + sorted(paths.products.glob(naming.PREFIX + "*.tif"))
    for path in rasters:
        lines.append(f"uv run python -m r2sync push {path.relative_to(base)} --bucket private "
                     f"--key {naming.r2_key(path.name, day)}")
    for rl in runlog.all_runs(paths.runs):
        if rl.task_ids():
            lines.append(f"uv run python -m r2sync push {rl.path.relative_to(base)} --bucket private "
                         f"--key {naming.run_log_key(rl.data['run_id'])}")
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="sar_floods", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    for name in ("events", "check", "aoi"):
        sub.add_parser(name)
    p = sub.add_parser("run")
    p.add_argument("event")
    p.add_argument("--dry-run", action="store_true", help="list scenes and planned exports; start no tasks")
    p.add_argument("--with-thresholds", action="store_true", help="with --dry-run: also compute thresholds")
    p.add_argument("--scale", type=int, default=None, help="export pixel size in metres (default: config)")
    p.add_argument("--force", action="store_true", help="start exports even if an earlier run started them")
    p = sub.add_parser("prepare")
    p.add_argument("event")
    p.add_argument("--dry-run", action="store_true", help="list the references; start no tasks")
    p.add_argument("--scale", type=int, default=None, help="pixel size in metres (default: config)")
    p.add_argument("--force", action="store_true", help="export again even if the asset or a task exists")
    p = sub.add_parser("status")
    p.add_argument("run_id", nargs="?")
    p = sub.add_parser("download")
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("frequency")
    p.add_argument("--allow-missing", action="store_true", help="use only the seasons that are downloaded")
    p.add_argument("--scale", type=int, default=None)
    p = sub.add_parser("upload-plan")
    p.add_argument("--date", type=date.fromisoformat, default=None, help="date in the R2 keys (default: today)")
    args = ap.parse_args(argv)

    try:
        cfg = settings.load_config(scale_m=getattr(args, "scale", None))
        paths = settings.output_paths(cfg)
        if args.command == "events":
            return _events(cfg)
        if args.command == "upload-plan":
            for line in upload_commands(paths, args.date or today_bangkok()):
                print(line)
            return 0
        if args.command == "aoi":
            feature = aoi.write(cfg)
            print(f"wrote {settings.AOI_PATH.relative_to(PIPELINE_DIR)}: bounds {aoi.bounds(feature['geometry'])}")
            return 0
        _setup_logging(paths)
        command = "sar_floods " + " ".join(argv if argv is not None else sys.argv[1:])
        if args.command == "check":
            return _check(cfg)
        if args.command in ("run", "prepare"):
            return _run(cfg, args, command)
        if args.command == "status":
            return _status(cfg, args, paths)
        if args.command == "download":
            return _download(cfg, args, paths)
        if args.command == "frequency":
            return _frequency(cfg, args, paths)
    except (settings.ConfigError, FileNotFoundError) as e:
        print(f"sar_floods: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        if type(e).__name__ == "FrequencyError":
            print(f"sar_floods: {e}", file=sys.stderr)
            return 1
        # Earth Engine and Drive errors carry no secrets; show them so the cause is visible.
        print(f"sar_floods: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
