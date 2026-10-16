"""Command line: `uv run python -m coastal_gate <command>` from the pipeline folder.

Commands
  run          every mouth in config.yaml: the whole marine archive of modelled sea level, split
               into the tide and the monsoon set-up, the flood-season percentiles of the daily low
               water, the figures over each flood on record, the spells with no low-water window,
               and the wind that explains the set-up. Writes <output_dir>/ (daily.csv,
               summary.json, report.md), report.md beside this code, and
               supabase/seed/49_coastal_gate.sql.
  now          the live gate at each mouth from the marine forecast: the next days' low water
               against the reference, and whether the gate reads open, narrowing or shut. For a
               look; writes nothing.

Network: Open-Meteo's marine archive (sea level, cached per mouth and year under <output_dir>)
and its ERA5 archive (wind, cached the same way). Settings: coastal_gate/config.yaml; method:
coastal_gate/METHODS.md; docs/science-plan.md Module 10.

Advisory only. Nothing here publishes anything and nothing here can raise an alert level
(safety rule 2).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, data_dir
from thresholds.tide import MARINE_URL, fetch_sea_level

from . import gate, output

CONFIG_PATH = Path(__file__).with_name("config.yaml")
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
log = logging.getLogger("coastal_gate")


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise ValueError("output_dir must be inside pipeline/.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def user_agent() -> str:
    """The same agent string the rest of the pipeline sends."""
    with open(PIPELINE_DIR / "thresholds" / "config.yaml", encoding="utf-8") as f:
        agent = str(yaml.safe_load(f)["user_agent"])
    import os

    return agent.replace("{contact}", os.environ.get("CONTACT_EMAIL", "contact in .env.local"))


def grid_point(point: tuple[float, float], agent: str) -> list[float]:
    """The model cell the request lands in: it snaps to the nearest sea cell, which is a few
    kilometres offshore. Recorded so the report never pretends the figure is at the mouth."""
    r = requests.get(MARINE_URL, params={
        "latitude": point[1], "longitude": point[0], "hourly": "sea_level_height_msl",
        "start_date": "2024-01-01", "end_date": "2024-01-01", "timezone": "GMT",
    }, headers={"User-Agent": agent}, timeout=60)
    r.raise_for_status()
    body = r.json()
    return [round(float(body["longitude"]), 4), round(float(body["latitude"]), 4)]


def fetch_wind(point: tuple[float, float], first: str, last: str, cache: Path, agent: str) -> pd.DataFrame:
    """Hourly ERA5 wind at `point` (lon, lat), year by year, cached beside the sea level."""
    cache.mkdir(parents=True, exist_ok=True)
    parts = []
    for year in range(int(first[:4]), int(last[:4]) + 1):
        path = cache / f"wind-{year}.parquet"
        if not path.exists():
            r = requests.get(ARCHIVE_URL, params={
                "latitude": point[1], "longitude": point[0],
                "hourly": "wind_speed_10m,wind_direction_10m",
                "start_date": max(first, f"{year}-01-01"), "end_date": min(last, f"{year}-12-31"),
                "timezone": "GMT",
            }, headers={"User-Agent": agent}, timeout=120)
            r.raise_for_status()
            h = r.json()["hourly"]
            frame = pd.DataFrame(
                {"speed_ms": [None if v is None else v / 3.6 for v in h["wind_speed_10m"]],
                 "direction_deg": h["wind_direction_10m"]},
                index=pd.to_datetime(h["time"], utc=True), dtype="float64")
            frame.to_parquet(path)
            time.sleep(1)
        parts.append(pd.read_parquet(path))
    frame = pd.concat(parts).sort_index()
    return frame[~frame.index.duplicated(keep="last")]


def measure(mouth_id: str, spec: dict, cfg: dict, out: Path, agent: str) -> dict:
    point = (float(spec["point"][0]), float(spec["point"][1]))
    cache = out / "sea" / mouth_id
    ar, fl, ref0 = cfg["archive"], cfg["flag"], cfg["reference"]
    sea = fetch_sea_level(point, ar["first"], ar["last"], cache, agent).dropna().asfreq("h")
    days = gate.daily(sea, int(cfg["filter"]["min_hours_per_day"]))
    reference = gate.reference(days, ref0["months"], ref0["percentiles"])
    if "llw_p90" not in reference:
        raise SystemExit(f"{mouth_id}: no flood-season days in the archive; nothing to measure.")

    zone = spec.get("zone")
    # Mueang Narathiwat is in no warning zone, so the Bang Nara has no flood windows of its own in
    # the timeline. Tak Bai is 20 km along the same shore and the same water, so its windows are
    # borrowed and the report says so.
    borrow = None if zone else "kolok"
    windows = output.windows_from_timeline(data_dir() / "event_timeline.csv", zone or borrow)
    events = {}
    for name, (a, b) in windows.items():
        figures = output.window_figures(days, reference, a, b)
        if figures:
            events[name] = figures

    wind = {}
    try:
        w = fetch_wind(point, ar["first"], ar["last"], cache, agent)
        stress = gate.onshore_stress(w["speed_ms"], w["direction_deg"])
        wind = gate.wind_link(sea, stress, ref0["months"])
    except requests.RequestException as e:  # the wind is a nice-to-know, not the measurement
        log.warning("%s: no wind (%s)", mouth_id, e)

    return {
        "id": mouth_id, "name": spec["name"], "zone": zone, "point": list(point),
        "grid": grid_point(point, agent),
        "reference": reference,
        "months": gate.monthly(days, ref0["percentiles"]),
        "events": events, "windows_from": borrow,
        "spells": gate.spells(days, reference[f"llw_p{fl['shut_percentile']}"], int(fl["shut_days"])),
        "wind": wind,
        "daily": days,
    }


def cmd_run(cfg: dict) -> int:
    out = output_dir(cfg)
    agent = user_agent()
    made = date.today().isoformat()
    mouths, frames = [], []
    for mouth_id, spec in cfg["mouths"].items():
        m = measure(mouth_id, spec, cfg, out, agent)
        frame = m.pop("daily")
        frame = frame.assign(mouth=mouth_id)
        frames.append(frame)
        mouths.append(m)
        r = m["reference"]
        shut = sum(s["days"] for s in m["spells"])
        print(f"{mouth_id:14} {r['days']:4} season days  low water p50/p90/p98 "
              f"{r['llw_p50']:.2f}/{r['llw_p90']:.2f}/{r['llw_p98']:.2f}  "
              f"set-up p90 {r['setup_p90']:.2f}  shut spells {len(m['spells'])} ({shut} d)  "
              f"floods {len(m['events'])}")

    pd.concat(frames).to_csv(out / "daily.csv", float_format="%.3f")
    (out / "summary.json").write_text(
        json.dumps({"made": made, "config": cfg, "mouths": mouths}, ensure_ascii=False,
                   indent=2, default=str) + "\n", encoding="utf-8")
    text = output.markdown(mouths, cfg, made)
    for folder in (out, CONFIG_PATH.parent):
        (folder / "report.md").write_text(text, encoding="utf-8", newline="\n")
    seed = REPO_DIR / "supabase" / "seed" / output.SEED_NAME
    seed.write_text(output.seed_sql(mouths, cfg, made), encoding="utf-8", newline="\n")
    print(f"{len(mouths)} mouths -> {out}; seed {seed.name}")
    return 0


def cmd_now(cfg: dict) -> int:
    """What the live feed would say today, read the way the dashboard reads it."""
    agent = user_agent()
    out = output_dir(cfg)
    saved = out / "summary.json"
    if not saved.exists():
        raise SystemExit("Run `coastal_gate run` first: the reference comes from its summary.json.")
    by_id = {m["id"]: m for m in json.loads(saved.read_text(encoding="utf-8"))["mouths"]}
    fl = cfg["flag"]
    for mouth_id, spec in cfg["mouths"].items():
        ref = by_id.get(mouth_id, {}).get("reference")
        if not ref:
            print(f"{mouth_id:14} no reference")
            continue
        r = requests.get(MARINE_URL, params={
            "latitude": spec["point"][1], "longitude": spec["point"][0],
            "hourly": "sea_level_height_msl", "past_days": 1, "forecast_days": 7, "timezone": "GMT",
        }, headers={"User-Agent": agent}, timeout=60)
        r.raise_for_status()
        h = r.json()["hourly"]
        s = pd.Series(h["sea_level_height_msl"], index=pd.to_datetime(h["time"], utc=True),
                      dtype="float64").dropna()
        days = gate.daily(s, int(cfg["filter"]["min_hours_per_day"]))
        line = ref[f"llw_p{fl['shut_percentile']}"]
        shut = [str(d.date()) for d, v in days["llw"].items() if v >= line]
        print(f"{mouth_id:14} low water line {line:.2f} m; "
              f"next days " + " ".join(f"{v:.2f}" for v in days['llw']) +
              (f"; shut {', '.join(shut)}" if shut else "; gate open"))
        time.sleep(1)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="coastal_gate", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    sub.add_parser("now")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "now":
        return cmd_now(cfg)
    return cmd_run(cfg)


if __name__ == "__main__":
    sys.exit(main())
