"""Command line: `uv run python -m season_state <command>` from the pipeline folder.

Commands
  run          every gauge with levels in seed 47 and every warning zone: the gauge's daily-minimum
               floor and its seven-day change per flood-season month, each zone's basin rain over
               fifteen days, thirty days and since 1 October, all as terciles of their own record,
               and how often the soft notice's rule would have held. Writes
               <output_dir>/summary.json and report.md, report.md beside this code, and
               supabase/seed/61_season_state.sql.
  gauge CODE   one gauge's floor, its tidal share and its monthly terciles, printed (writes nothing).
  bias         asks the Open-Meteo archive for the same seasons at each zone's own live rain points
               and measures how its daily rain compares with the GSMaP the terciles are built from.
               The only command that touches the network. Writes <output_dir>/bias.json, which
               `run` then prints in the report.

`run` and `gauge` are offline: the ThaiWater archive in pipeline/data and the cached basin rain in
pipeline/out/thresholds/rain. Settings: season_state/config.yaml; method: season_state/METHODS.md;
docs/science-plan.md Module 11.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, data_dir

from . import output, state

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("season_state")


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise ValueError("output_dir must be inside pipeline/.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def zones_config(cfg: dict) -> dict:
    with open(PIPELINE_DIR / cfg["zones_config"], encoding="utf-8") as f:
        return yaml.safe_load(f)


def gauges(cfg: dict) -> list[dict]:
    """Every gauge with a Warning and an Evacuate level in seed 47, with its code, zone and role."""
    levels = output.read_levels((PIPELINE_DIR / cfg["levels_sql"]).read_text(encoding="utf-8"))
    roles = output.zone_roles(zones_config(cfg)["zones"])
    stations = pd.read_csv(data_dir() / "stations.csv")
    code_of = dict(zip(stations["station_id"].astype(int), stations["old_code"].astype(str)))
    out = []
    for tid, lv in levels.items():
        if lv["evacuate"] is None:
            continue
        zone, role = roles.get(tid, (None, None))
        out.append({"code": code_of.get(tid, str(tid)), "thaiwater_id": tid, "zone": zone, "role": role,
                    "bank": lv["evacuate"], "warning": lv["warning"]})
    return out


def measure_gauge(g: dict, cfg: dict, tidy: Path) -> dict:
    """One gauge's tidal share, floor and monthly terciles. Sets `kept` and `why_dropped`."""
    from dam_release.travel import read_hourly
    from safe_return.recession import clean

    gc, ref, tide = cfg["gauge"], cfg["reference"], cfg["tide"]
    raw = read_hourly(tidy, "water_level_msl", int(g["thaiwater_id"]))
    level = clean(raw, g["bank"], float(gc["max_above_bank_m"]), int(gc["bridge_h"]))
    observed = level.dropna()
    floor = state.baseflow(level)
    season_floor = floor[np.isin(pd.DatetimeIndex(floor.index).month, list(ref["months"]))]
    g["record"] = {
        "from": None if observed.empty else observed.index[0].strftime("%Y-%m-%d"),
        "to": None if observed.empty else observed.index[-1].strftime("%Y-%m-%d"),
        "hours": int(observed.size),
        "days": int(season_floor.size),
    }
    g["tide"] = state.harmonics(level, int(tide["min_hours"]))
    g["floor_series"] = floor
    g["kept"], g["why_dropped"] = True, ""
    if g["tide"] is None:
        g["kept"], g["why_dropped"] = False, "too little record to tell the sea from a daily pulse"
    elif g["tide"]["pulse_m"] > float(tide["max_pulse_m"]):
        # The pulse is tested first: a tall, square daily pulse leaks into the moon's neighbouring
        # periods, so a gauge 40 m up a mountain river can otherwise be reported as tidal.
        g["kept"], g["why_dropped"] = False, f"a daily pulse of {g['tide']['pulse_m']:.2f} m"
    elif g["tide"]["tide_m"] > float(tide["max_tide_m"]):
        g["kept"], g["why_dropped"] = False, f"the sea moves it {g['tide']['tide_m']:.2f} m"
    elif season_floor.size < int(gc["min_days"]):
        g["kept"], g["why_dropped"] = False, f"only {season_floor.size} days in the flood season"
    if g["kept"]:
        g["floor"] = state.monthly(floor, int(ref["min_seasons"]), tuple(ref["months"]),
                                   int(ref["season_start_month"]))
        g["rise"] = state.monthly(state.change_over(floor, int(cfg["rule"]["rose_window"])),
                                  int(ref["min_seasons"]), tuple(ref["months"]),
                                  int(ref["season_start_month"]))
    else:
        g["floor"] = g["rise"] = {m: {"p33": None, "p50": None, "p67": None, "seasons": 0, "days": 0}
                                  for m in ref["months"]}
    return g


def rain_series(cfg: dict, zone: str, basin: str) -> pd.Series:
    """The zone's cached hourly basin-mean GSMaP rain, as one column of out/thresholds/rain."""
    from thresholds.sources import read_rain

    frame = read_rain(PIPELINE_DIR / cfg["rain_cache"])
    column = f"{zone}.{basin}"
    if frame.empty or column not in frame.columns:
        return pd.Series(dtype="float64")
    return frame[column].dropna()


def measure_zone(zone: str, z: dict, cfg: dict, key_floor: pd.Series | None) -> dict:
    """One zone's rain reference, and how often the rule would have held in each past season."""
    ref, rule = cfg["reference"], cfg["rule"]
    months, start = tuple(ref["months"]), int(ref["season_start_month"])
    basin = str(z["rain_basin"])
    hourly = rain_series(cfg, zone, basin)
    rain = state.daily_rain(hourly)
    w15, w30 = (int(d) for d in ref["rain_windows"])
    d15, d30 = state.rain_window(rain, w15), state.rain_window(rain, w30)
    std = state.rain_since_october(rain, start)
    out = {
        "zone": zone, "basin": basin,
        "record": {
            "from": None if rain.empty else rain.index[0].strftime("%Y-%m-%d"),
            "to": None if rain.empty else rain.index[-1].strftime("%Y-%m-%d"),
            "days": int(rain.size),
        },
        "d15": state.monthly(d15, int(ref["min_seasons"]), months, start),
        "d30": state.monthly(d30, int(ref["min_seasons"]), months, start),
        "std": state.monthly(std, int(ref["min_seasons"]), months, start),
    }
    out["hindcast"] = hindcast(key_floor, d15, out["d15"], cfg) if key_floor is not None else {}
    return out


def hindcast(floor: pd.Series, d15: pd.Series, reference: dict, cfg: dict) -> dict:
    """How many days the rule held in each season, and how many separate episodes that is.

    In sample: the terciles come from the same seasons this counts over. It is a sanity check on
    how often an admin would hear from this, not a skill score.
    """
    ref, rule = cfg["reference"], cfg["rule"]
    rose = state.rose_days(floor, int(rule["rose_window"]))
    if rose.empty or d15.empty:
        return {}
    days = rose.index.intersection(d15.index)
    if days.empty:
        return {}
    held = []
    for day in days:
        month = day.month
        if month not in ref["months"]:
            continue
        g, _ = state.grade(float(rose[day]) if not np.isnan(rose[day]) else None,
                           state.band(float(d15[day]), reference.get(month)), rule)
        held.append((day, g == "rising_wet"))
    out: dict[int, dict] = {}
    previous = None
    for day, fired in held:
        season = int(day.year if day.month >= int(ref["season_start_month"]) else day.year - 1)
        row = out.setdefault(season, {"days": 0, "episodes": 0})
        if fired:
            row["days"] += 1
            if previous is None or (day - previous).days > 1:
                row["episodes"] += 1
            previous = day
        elif previous is not None and (day - previous).days > 1:
            previous = None
    return out


def cmd_run(cfg: dict) -> int:
    out = output_dir(cfg)
    tidy = data_dir() / "tidy"
    made = date.today().isoformat()
    measured = [measure_gauge(g, cfg, tidy) for g in gauges(cfg)]
    for g in measured:
        t = g.get("tide") or {}
        print(f"{g['code']:8} {g.get('zone') or '-':14} tide {t.get('tide_m', '-')!s:>6} "
              f"pulse {t.get('pulse_m', '-')!s:>6}  days {g['record']['days']:4}  "
              f"{'kept' if g['kept'] else 'dropped: ' + g['why_dropped']}")
    kept_key = {g["zone"]: g["floor_series"] for g in measured
                if g["kept"] and g.get("role") == "key" and g.get("zone")}
    zones = [measure_zone(name, z, cfg, kept_key.get(name))
             for name, z in zones_config(cfg)["zones"].items()]
    for z in zones:
        seasons = ", ".join(f"{s}: {h['days']}d/{h['episodes']}ep" for s, h in sorted((z["hindcast"] or {}).items()))
        print(f"{z['zone']:14} {z['basin']:12} rain days {z['record']['days']:5}  {seasons}")
    bias_path = out / "bias.json"
    bias = json.loads(bias_path.read_text(encoding="utf-8")) if bias_path.exists() else None
    summary = {"made": made, "config": cfg,
               "gauges": [{k: v for k, v in g.items() if k != "floor_series"} for g in measured],
               "zones": zones}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
                                      encoding="utf-8")
    text = output.markdown(measured, zones, cfg, made, bias)
    for folder in (out, CONFIG_PATH.parent):
        (folder / "report.md").write_text(text, encoding="utf-8", newline="\n")
    seed = REPO_DIR / "supabase" / "seed" / output.SEED_NAME
    seed.write_text(output.seed_sql(measured, zones, cfg, made), encoding="utf-8", newline="\n")
    kept = sum(1 for g in measured if g["kept"])
    print(f"{kept} of {len(measured)} gauges kept, {len(zones)} zones -> {out}; seed {seed.name}")
    return 0


def cmd_gauge(cfg: dict, code: str) -> int:
    found = [g for g in gauges(cfg) if g["code"] == code]
    if not found:
        raise SystemExit(f"No gauge {code} with an Evacuate level in {cfg['levels_sql']}.")
    g = measure_gauge(found[0], cfg, data_dir() / "tidy")
    print(f"{code}: bank {g['bank']} m, record {g['record']}, tide {g['tide']}")
    print(f"kept: {g['kept']}" + ("" if g["kept"] else f" ({g['why_dropped']})"))
    for m in cfg["reference"]["months"]:
        f, r = g["floor"][m], g["rise"][m]
        print(f"  month {m:2}: floor {f['p33']} / {f['p50']} / {f['p67']}   "
              f"7-day change {r['p33']} / {r['p50']} / {r['p67']}   seasons {f['seasons']}")
    floor = g["floor_series"]
    if not floor.empty:
        last = floor.tail(10)
        rose = state.rose_days(floor, int(cfg["rule"]["rose_window"])).reindex(last.index)
        print("  last ten days of floor (m) and days risen of the last seven:")
        for day, value in last.items():
            r = rose.get(day)
            print(f"    {day:%Y-%m-%d}  {value:8.2f}  {'-' if r is None or np.isnan(r) else int(r)}")
    return 0


FEED_ROW = re.compile(r"'signal_feed',\s*'(\{.*?\})'::jsonb", re.S)


def feed_points(cfg: dict) -> dict[str, list[list[float]]]:
    """The live rain points per zone, read back out of seed 46 so the bias check uses the same ones."""
    sql = (PIPELINE_DIR / cfg["feed_seed"]).read_text(encoding="utf-8")
    m = FEED_ROW.search(sql)
    if not m:
        raise SystemExit(f"No signal_feed row found in {cfg['feed_seed']}.")
    feed = json.loads(m.group(1).replace("''", "'"))
    return {zone: z["rain_points"] for zone, z in feed["zones"].items() if z.get("rain_points")}


def user_agent() -> str:
    """The same agent string the rest of the pipeline sends (as coastal_gate builds it)."""
    import os

    with open(PIPELINE_DIR / "thresholds" / "config.yaml", encoding="utf-8") as f:
        agent = str(yaml.safe_load(f)["user_agent"])
    return agent.replace("{contact}", os.environ.get("CONTACT_EMAIL", "contact in .env.local"))


def cmd_bias(cfg: dict) -> int:
    import requests

    out = output_dir(cfg)
    bias, points = cfg["bias"], feed_points(cfg)
    zones = zones_config(cfg)["zones"]
    made = date.today().isoformat()
    result: dict = {"made": made, "url": bias["url"], "zones": {}}
    for zone, z in zones.items():
        if zone not in points:
            continue
        gsmap = state.daily_rain(rain_series(cfg, zone, str(z["rain_basin"])))
        lats = ",".join(f"{p[1]}" for p in points[zone])
        lons = ",".join(f"{p[0]}" for p in points[zone])
        for season in bias["seasons"]:
            first, last = f"{season}-10-01", f"{season + 1}-01-31"
            r = requests.get(bias["url"], timeout=int(bias["timeout_s"]),
                             headers={"User-Agent": user_agent()},
                             params={"latitude": lats, "longitude": lons, "daily": "precipitation_sum",
                                     "start_date": first, "end_date": last, "timezone": "Asia/Bangkok"})
            r.raise_for_status()
            answer = r.json()
            series = answer if isinstance(answer, list) else [answer]
            frames = [pd.Series(a["daily"]["precipitation_sum"], index=pd.to_datetime(a["daily"]["time"]),
                                dtype="float64") for a in series]
            mean = pd.concat(frames, axis=1).mean(axis=1)
            window = gsmap[(gsmap.index >= f"{first} 00:00+07:00") & (gsmap.index <= f"{last} 23:59+07:00")]
            g_total, o_total = float(window.sum()), float(mean.sum())
            result["zones"].setdefault(zone, {})[str(season)] = {
                "gsmap_mm": round(g_total, 1), "open_meteo_mm": round(o_total, 1),
                "ratio": None if g_total <= 0 else round(o_total / g_total, 3),
                "points": len(points[zone]), "days": int(mean.size),
            }
            print(f"{zone:14} {season}  GSMaP {g_total:7.0f} mm   Open-Meteo {o_total:7.0f} mm   "
                  f"ratio {'-' if g_total <= 0 else round(o_total / g_total, 2)}")
    (out / "bias.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"-> {out / 'bias.json'}; run `season_state run` again to put it in the report")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="season_state", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    sub.add_parser("gauge").add_argument("code")
    sub.add_parser("bias")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "gauge":
        return cmd_gauge(cfg, args.code)
    if args.command == "bias":
        return cmd_bias(cfg)
    return cmd_run(cfg)


if __name__ == "__main__":
    sys.exit(main())
