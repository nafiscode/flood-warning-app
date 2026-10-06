"""Command line: `uv run python -m sar_floods <command>` from the pipeline folder.

Commands
  events                 list the configured events and their date windows (no Earth Engine)
  check                  test the Earth Engine sign-in and every dataset and band the code uses
  run EVENT [--dry-run] [--with-thresholds] [--scale M] [--force]
                         plan one event and start its Drive exports. EVENT is an id from `events`
                         (e.g. event-2024-nov-dec, season-2024) or `all-seasons`. Seasons use
                         seasons.scale_m, priority events export.scale_m, unless --scale is given.
                         --dry-run lists scenes and planned exports and starts nothing;
                         add --with-thresholds to also compute and log the per-tile thresholds.
  prepare EVENT [--dry-run] [--scale M] [--force]
                         start one asset export per orbit: the dry reference and the layover mask of
                         the event's season. `run` then reads them instead of recomputing them for
                         every pass (about 60 % less compute). Wait for these tasks before `run`.
  status [RUN_ID]        task states and EECU-seconds of a run (default: the latest with tasks)
  download [--dry-run]   fetch finished exports from Google Drive into <output_dir>/drive/
  maximum EVENT [--scale M]
                         build the per-event raster (extent, n_valid, n_flooded) from the downloaded
                         per-scene rasters of that event's latest run; EVENT as for `run`
  frequency [--allow-missing] [--scale M]
                         flood frequency over all seasons from the per-season rasters (seasons.scale_m)
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


def _todo(cfg: dict, args) -> list[seasons.Event]:
    if args.event == "all-seasons":
        return [ev for ev in seasons.events(cfg) if ev.kind == "season"]
    try:
        return [seasons.find_event(args.event, cfg)]
    except KeyError:
        raise settings.ConfigError(f"Unknown event '{args.event}'. `sar_floods events` lists them.") from None


def _event_config(cfg: dict, ev: seasons.Event, args) -> dict:
    """The config with the pixel size this event is made at: --scale, else seasons.scale_m for a season."""
    scale = args.scale or (cfg["seasons"]["scale_m"] if ev.kind == "season" else cfg["export"]["scale_m"])
    return cfg if scale == cfg["export"]["scale_m"] else settings.load_config(scale_m=scale)


def _maximum(cfg: dict, args, paths: settings.Paths) -> int:
    from . import grid, maximum

    params_hash = settings.params_hash(cfg, settings.aoi_sha256())
    for ev in _todo(cfg, args):
        scale = _event_config(cfg, ev, args)["export"]["scale_m"]
        passes = maximum.used_passes(paths.runs, ev.id, scale, params_hash)
        scenes = maximum.scene_files(paths.drive, passes, scale, params_hash)
        master = grid.master_grid(aoi.bounds(aoi.load()), cfg["export"]["crs"], scale, cfg["export"]["snap_m"])
        dest = paths.products / (naming.event_name(ev.id, scale, params_hash) + ".tif")
        summary = maximum.write_maximum(scenes, master, dest, cfg["flood_rule"])
        log.info("wrote %s: %d scenes, %d pixels observed, %d flooded at least once", dest.relative_to(PIPELINE_DIR),
                 summary["scenes"], summary["pixels_observed"], summary["pixels_flooded"])
    return 0


def _run(cfg: dict, args, command: str) -> int:
    from . import run

    todo = _todo(cfg, args)
    if args.command == "prepare":
        for ev in todo:
            rl = run.prepare_references(_event_config(cfg, ev, args), ev, dry_run=args.dry_run, force=args.force,
                                        command=command)
            log.info("run log: %s", rl.path.relative_to(PIPELINE_DIR))
        return 0
    if args.with_thresholds and not args.dry_run:
        raise settings.ConfigError("--with-thresholds only makes sense with --dry-run.")
    for ev in todo:
        rl = run.run_event(_event_config(cfg, ev, args), ev, dry_run=args.dry_run,
                           with_thresholds=args.with_thresholds, force=args.force, command=command)
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

    scale = args.scale or cfg["seasons"]["scale_m"]
    params_hash = settings.params_hash(cfg, settings.aoi_sha256())
    years = list(range(cfg["seasons"]["first"], cfg["seasons"]["last"] + 1))
    files = frequency.season_files([paths.products, paths.drive], years, scale, params_hash)
    missing = [y for y in years if y not in files]
    if missing and not args.allow_missing:
        raise settings.ConfigError(
            f"No raster for season(s) {missing} with parameters {params_hash} at {scale} m. "
            "Run, download and `maximum` them, or pass --allow-missing to use only the seasons present.")
    master = grid.master_grid(aoi.bounds(aoi.load()), cfg["export"]["crs"], scale, cfg["export"]["snap_m"])
    present = sorted(files)
    if not present:
        raise settings.ConfigError("No season rasters found. Run `sar_floods maximum all-seasons` first.")
    dest = paths.products / (naming.frequency_name(present[0], present[-1], scale, params_hash) + ".tif")
    summary = frequency.write_frequency(files, master, dest)
    log.info("wrote %s: seasons %s, %d pixels observed, %d flooded at least once",
             dest.relative_to(PIPELINE_DIR), summary["seasons"], summary["pixels_observed"],
             summary["pixels_ever_flooded"])
    return 0


def upload_commands(paths: settings.Paths, day: date, base: Path = PIPELINE_DIR,
                    scene_scale: int | None = None) -> list[str]:
    """The r2sync command for every downloaded or locally computed raster and every run log with tasks.
    Per-scene rasters at another pixel size than `scene_scale` (the seasons' passes, which only feed
    the season maximum) are left out."""
    lines = []
    rasters = sorted(paths.drive.glob(naming.PREFIX + "*.tif")) + sorted(paths.products.glob(naming.PREFIX + "*.tif"))
    if scene_scale is not None:
        rasters = [p for p in rasters if not (p.name.startswith(naming.PREFIX + "scene_")
                                              and f"_{scene_scale}m_" not in p.name)]
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
    p = sub.add_parser("maximum")
    p.add_argument("event")
    p.add_argument("--scale", type=int, default=None)
    p = sub.add_parser("frequency")
    p.add_argument("--allow-missing", action="store_true", help="use only the seasons that are downloaded")
    p.add_argument("--scale", type=int, default=None)
    p = sub.add_parser("upload-plan")
    p.add_argument("--date", type=date.fromisoformat, default=None, help="date in the R2 keys (default: today)")
    args = ap.parse_args(argv)

    try:
        cfg = settings.load_config()
        paths = settings.output_paths(cfg)
        if args.command == "events":
            return _events(cfg)
        if args.command == "upload-plan":
            for line in upload_commands(paths, args.date or today_bangkok(), scene_scale=cfg["export"]["scale_m"]):
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
        if args.command == "maximum":
            return _maximum(cfg, args, paths)
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
