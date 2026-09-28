"""Command line: `uv run python -m ingest_thaiwater <command>` from the pipeline folder.

Commands
  refresh              stations -> water level -> daily rain (default window) -> hourly rain -> coverage
  stations             refresh stations.csv only
  waterlevel           water-level history (walks back year by year)
  rain-daily [--since] daily rain history from --since (default from config.yaml)
  rain-hourly          hourly rain, last ~42 h (run at least every 36 h; CI runs it every 12 h)
  backfill             daily rain back to rain_daily.backfill_since, time-boxed by --max-minutes
  coverage             rewrite reports/coverage.md
  snapshot             zip the archive into snapshots/

Exit codes: 0 ok, 1 error, 2 the API is blocking or down (every request failing).
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timezone

from . import coverage, download, stations
from .client import BlockedError, ThaiWaterClient
from .settings import Paths, data_dir, load_config
from .snapshot import make_snapshot
from .state import State

log = logging.getLogger("ingest_thaiwater")


def _setup_logging(paths: Paths) -> None:
    paths.logs.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in (logging.StreamHandler(sys.stdout),
              logging.FileHandler(paths.logs / f"ingest-{datetime.now():%Y%m%d}.log", encoding="utf-8")):
        h.setFormatter(fmt)
        root.addHandler(h)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _stations(client, cfg, paths) -> "stations.pd.DataFrame":
    new = stations.build(stations.fetch(client, cfg), cfg)
    merged = stations.merge_with_previous(new, stations.read_csv(paths.stations_csv))
    stations.write_csv(merged, paths.stations_csv)
    log.info("stations.csv: %d stations (%d water-level candidates, %d rain candidates)",
             len(merged), int(merged["wl_candidate"].sum()), int(merged["rain_candidate"].sum()))
    return merged


def _coverage(paths: Paths) -> None:
    coverage.write_report(paths.tidy, stations.read_csv(paths.stations_csv),
                          State(paths.state("rain_daily")).backfill, paths.reports / "coverage.md")


def _load_stations(client, cfg, paths):
    df = stations.read_csv(paths.stations_csv)
    return df if df is not None else _stations(client, cfg, paths)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ingest_thaiwater", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["refresh", "stations", "waterlevel", "rain-daily", "rain-hourly",
                                        "backfill", "coverage", "snapshot"])
    ap.add_argument("--since", type=date.fromisoformat, help="rain-daily start date (YYYY-MM-DD)")
    ap.add_argument("--max-minutes", type=float, default=None, help="stop cleanly after this many minutes")
    args = ap.parse_args(argv)

    cfg = load_config()
    paths = Paths(data_dir())
    paths.root.mkdir(parents=True, exist_ok=True)
    _setup_logging(paths)

    if args.command == "coverage":
        _coverage(paths)
        return 0
    if args.command == "snapshot":
        log.info("snapshot written: %s", make_snapshot(paths).relative_to(paths.root))
        return 0

    client = ThaiWaterClient(cfg)
    ctx = download.make_ctx(client, paths, cfg)
    deadline = download.Deadline(args.max_minutes)
    since = args.since or date.fromisoformat(cfg["rain_daily"]["default_since"])
    try:
        if args.command == "stations":
            _stations(client, cfg, paths)
        elif args.command == "refresh":
            st = _stations(client, cfg, paths)
            download.run_waterlevel(ctx, download.station_ids(st, "wl_candidate"), deadline)
            download.run_rain_daily(ctx, download.station_ids(st, "rain_candidate"), since, deadline)
            download.run_rain_hourly(ctx, download.station_ids(st, "rain_reporting"), deadline)
        elif args.command == "waterlevel":
            download.run_waterlevel(ctx, download.station_ids(_load_stations(client, cfg, paths), "wl_candidate"), deadline)
        elif args.command == "rain-daily":
            download.run_rain_daily(ctx, download.station_ids(_load_stations(client, cfg, paths), "rain_candidate"), since, deadline)
        elif args.command == "rain-hourly":
            download.run_rain_hourly(ctx, download.station_ids(_load_stations(client, cfg, paths), "rain_reporting"), deadline)
        elif args.command == "backfill":
            target = cfg["rain_daily"]["backfill_since"]
            bf = ctx.rain_state.backfill
            if bf.get("complete") and bf.get("target") == target:
                log.info("daily-rain backfill to %s already complete; nothing to do", target)
                return 0
            done = download.run_rain_daily(
                ctx, download.station_ids(_load_stations(client, cfg, paths), "rain_candidate"),
                date.fromisoformat(target), deadline)
            bf.update(target=target, complete=done, last_run=datetime.now(timezone.utc).isoformat(timespec="seconds"))
            ctx.rain_state.save()
            log.info("daily-rain backfill to %s: %s", target, "complete" if done else "time box reached, continues next run")
    except BlockedError as exc:
        log.error("ThaiWater API looks blocked or down: %s", exc)
        return 2
    finally:
        client.close()
        log.info("%d requests made", client.requests)

    if args.command in ("refresh", "backfill"):
        _coverage(paths)
    return 0


if __name__ == "__main__":
    sys.exit(main())
