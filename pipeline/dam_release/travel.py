"""How long water leaving the dam takes to reach each place down the river.

There is no clean record of a flood release travelling down the Pattani River: the only spill
since the river gauges began (January 2021) arrived on top of a river already rising from rain,
and the operator's own gauges start in December 2021. So the times come from two things the
archive does hold, and are given as a range, never as one time (safety rule 8):

  pulses   The turbines switch on and off every day in the dry months. The hourly change of the
           dam's outflow is compared with the hourly change of each gauge's level, and the shift
           that fits best is the time a small wave takes at low water.
  floods   Since 2020 the gauges have seen many floods pass. For each one the lag between a
           gauge and the next one downstream is taken twice: front to front (the steepest rise,
           which is what a warning needs) and peak to peak. In the largest floods rain falls
           below the dam as well, so the gauges rise together and the lag reads too short; that
           is why the short lags set only the earliest bound.

`config.yaml` holds the decided times at the gauges (`travel.anchors`); this module measures the
evidence for them and spreads them along the river by distance. A place between two gauges gets
the times in proportion to its river distance, which assumes an even speed within a reach.
"""

from __future__ import annotations

import csv
import json
import logging
import math
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("dam_release")
BANGKOK = "Asia/Bangkok"


# --------------------------------------------------------------------------- series

def read_hourly(tidy_dir: Path, variable: str, station_id: int) -> pd.Series:
    """One station's series as hourly means on a gapless hourly index (gaps are NaN). Empty when
    the archive has nothing."""
    files = sorted((tidy_dir / variable / str(station_id)).glob("*.parquet"))
    if not files:
        return pd.Series(dtype="float64")
    frame = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True).dropna(subset=["value"])
    s = pd.Series(frame["value"].to_numpy(dtype="float64"), index=pd.DatetimeIndex(frame["ts"])).sort_index()
    return s[~s.index.duplicated(keep="last")].resample("1h").mean()


# --------------------------------------------------------------------------- pulses

def best_lag(cause: pd.Series, effect: pd.Series, max_h: int, min_pairs: int = 100) -> dict | None:
    """The shift in whole hours (0..max_h) at which the hourly change of `effect` follows the
    hourly change of `cause` best. None when the two do not overlap enough or one is flat."""
    dx, dy = cause.diff(), effect.diff()
    best = None
    for lag in range(max_h + 1):
        pair = pd.concat([dx, dy.shift(-lag, freq="h")], axis=1).dropna()
        if len(pair) < min_pairs:
            continue
        a, b = pair.iloc[:, 0].to_numpy(), pair.iloc[:, 1].to_numpy()
        if a.std() == 0 or b.std() == 0:
            continue
        r = float(np.corrcoef(a, b)[0, 1])
        if best is None or r > best["r"]:
            best = {"lag_h": lag, "r": round(r, 3), "pairs": len(pair)}
    return best


def pulse_lags(outflow: pd.Series, level: pd.Series, months: list[int], max_h: int, min_r: float,
               min_swing_cms: float = 5.0) -> list[dict]:
    """One best lag per calendar month in `months` (dry months, when the turbine pulses are the
    only thing moving the river). Months where the fit is weak are left out, not guessed."""
    out = []
    if outflow.empty or level.empty:
        return out
    for period in sorted(set(outflow.index.to_period("M")) & set(level.index.to_period("M"))):
        if period.month not in months:
            continue
        a = period.start_time.tz_localize(outflow.index.tz)
        b = period.end_time.tz_localize(outflow.index.tz)
        x = outflow[a:b]
        y = level[a:b + pd.Timedelta(hours=max_h)]
        if x.notna().sum() < 400 or y.notna().sum() < 400 or x.std() < min_swing_cms:
            continue
        fit = best_lag(x, y, max_h)
        if fit and fit["r"] >= min_r:
            out.append({"month": str(period), **fit})
    return out


# --------------------------------------------------------------------------- floods

def flood_starts(level: pd.Series, quantile: float, gap_days: int) -> list[pd.Timestamp]:
    """The first hour of each spell in which the gauge is above its `quantile` level; spells closer
    than `gap_days` count as one flood."""
    high = level[level > level.quantile(quantile)]
    starts: list[pd.Timestamp] = []
    for t in high.index:
        if not starts or (t - starts[-1]).days >= gap_days:
            starts.append(t)
    return starts


def event_lags(up: pd.Series, down: pd.Series, *, quantile: float, gap_days: int, min_rise_m: float,
               max_h: int, max_up_m: float | None = None, max_down_m: float | None = None) -> list[dict]:
    """For every flood at the upstream gauge: hours from its steepest three-hour rise to the
    downstream gauge's (front), and from its peak to the downstream peak. A flood without enough
    data at either gauge, or rising less than `min_rise_m`, is skipped. `max_up_m` and `max_down_m`
    drop readings above a level no flood reaches at that gauge (a broken sensor)."""
    if max_up_m is not None:
        up = up.where(up < max_up_m)
    if max_down_m is not None:
        down = down.where(down < max_down_m)
    rows = []
    for start in flood_starts(up, quantile, gap_days):
        a, b = start - pd.Timedelta(days=2), start + pd.Timedelta(days=6)
        u, d = up[a:b], down[a:b + pd.Timedelta(hours=max_h)]
        if u.notna().sum() < 120 or d.notna().sum() < 120:
            continue
        rise = float(u.max() - u.min())
        if rise < min_rise_m:
            continue
        peak_u = u.idxmax()
        after = d[peak_u - pd.Timedelta(hours=6):peak_u + pd.Timedelta(hours=max_h)]
        if after.notna().sum() < 20:
            continue
        slope_u = u.rolling(3, center=True).mean().diff(3)
        slope_d = d.rolling(3, center=True).mean().diff(3)
        front_u = slope_u.idxmax()
        window = slope_d[front_u - pd.Timedelta(hours=3):front_u + pd.Timedelta(hours=max_h)]
        front = (window.idxmax() - front_u).total_seconds() / 3600 if window.notna().sum() > 10 else None
        rows.append({"peak": peak_u.tz_convert(BANGKOK).strftime("%Y-%m-%d"), "rise_m": round(rise, 2),
                     "front_lag_h": front, "peak_lag_h": (after.idxmax() - peak_u).total_seconds() / 3600})
    return rows


def spread(values: list[float], low: float = 25, high: float = 75) -> dict | None:
    """Count, quartiles and median of the lags that are not negative (a negative lag means the
    lower gauge rose first: rain, not travel)."""
    v = [x for x in values if x is not None and x >= 0]
    if not v:
        return None
    return {"n": len(v), "low": float(np.percentile(v, low)), "median": float(np.median(v)),
            "high": float(np.percentile(v, high)), "dropped_negative": sum(1 for x in values if x is not None and x < 0)}


# --------------------------------------------------------------------------- along the river

def _metres(pts):
    """Lon/lat points as metres on a local flat grid (good to well under 1 % over this river)."""
    lat0 = math.radians(sum(p[1] for p in pts) / len(pts))
    return [(p[0] * 111_320.0 * math.cos(lat0), p[1] * 110_574.0) for p in pts], lat0


def river_km(main_pts: list, point: tuple[float, float]) -> tuple[float, float]:
    """(distance down the river in km, distance off the line in m) of the place on the river
    nearest to `point` (lon, lat)."""
    from shapely.geometry import LineString, Point

    flat, lat0 = _metres(main_pts)
    line = LineString(flat)
    p = Point(point[0] * 111_320.0 * math.cos(lat0), point[1] * 110_574.0)
    return line.project(p) / 1000.0, line.distance(p)


def tambon_entry_km(main_pts: list, tambons: list[dict]) -> dict[str, float]:
    """tambon code -> river km at which the river first touches the tambon. Tambons the river
    does not touch are left out."""
    from shapely.geometry import LineString, Point
    from shapely.ops import transform

    flat, lat0 = _metres(main_pts)
    line = LineString(flat)
    k = 111_320.0 * math.cos(lat0)
    out = {}
    for t in tambons:
        shape = transform(lambda x, y, z=None: (x * k, y * 110_574.0), t["geometry"])
        if not shape.intersects(line):
            continue
        part = shape.intersection(line)
        pieces = list(part.geoms) if hasattr(part, "geoms") else [part]
        # A piece of the river inside the tambon begins at the smallest distance among its points.
        out[t["code"]] = min(line.project(Point(c)) for g in pieces for c in g.coords) / 1000.0
    return out


def arrival(km: float, anchors: list[dict], key: str) -> float:
    """Hours after the gates open for `key` ("earliest_h" or "latest_h") at river distance `km`,
    in proportion between the two anchors around it. Below the last anchor the last reach's speed
    is carried on."""
    pts = sorted(anchors, key=lambda a: a["km"])
    if km <= pts[0]["km"]:
        return float(pts[0][key])
    for a, b in zip(pts, pts[1:]):
        if km <= b["km"]:
            return a[key] + (b[key] - a[key]) * (km - a["km"]) / (b["km"] - a["km"])
    a, b = pts[-2], pts[-1]
    return b[key] + (b[key] - a[key]) / (b["km"] - a["km"]) * (km - b["km"])


def warn_from(earliest_h: float, margin: float) -> float:
    """The time a warning counts down to: the earliest arrival with the safety margin taken off,
    rounded down to half an hour (never up)."""
    return math.floor(earliest_h * (1.0 - margin) * 2) / 2


KEYS = ("earliest_h", "latest_h", "peak_earliest_h", "peak_latest_h")


def table(entries: dict[str, dict], anchors: list[dict], margin: float) -> list[dict]:
    """One row per place: `entries` maps a code to {"km", "via"}. `earliest_h`..`latest_h` is when
    the water first rises, in hours after the gates open; `peak_*` is when the highest water
    comes, in hours after the highest release."""
    rows = []
    for code, e in sorted(entries.items(), key=lambda kv: (kv[1]["km"], kv[0])):
        v = {k: arrival(e["km"], anchors, k) for k in KEYS}
        rows.append({"tambon_code": code, "via": e["via"], "km_from_dam": round(e["km"], 1),
                     "warn_from_h": warn_from(v["earliest_h"], margin),
                     "earliest_h": round(v["earliest_h"], 1), "latest_h": round(v["latest_h"], 1),
                     "peak_earliest_h": round(v["peak_earliest_h"]), "peak_latest_h": round(v["peak_latest_h"])})
    return rows


def seed_sql(dam_code: str, source: str, rows: list[dict], method: dict) -> str:
    """supabase/seed/41_dam_arrivals.sql: generated, never edited by hand."""
    lines = ["-- Generated by pipeline/dam_release (`travel`). Do not edit by hand.",
             "-- Hours are ranges measured from the river gauges, not a forecast: see",
             "-- pipeline/dam_release/METHODS.md, \"Travel times\".", "",
             f"delete from public.dam_arrivals where dam_code = '{dam_code}' and source = '{source}';", "",
             "insert into public.dam_arrivals (dam_code, source, tambon_code, via, km_from_dam, warn_from_h,",
             "    earliest_h, latest_h, peak_earliest_h, peak_latest_h, method) values"]
    note = json.dumps(method, ensure_ascii=False).replace("'", "''")
    values = [f"  ('{dam_code}', '{source}', '{r['tambon_code']}', '{r['via']}', {r['km_from_dam']}, {r['warn_from_h']},"
              f" {r['earliest_h']}, {r['latest_h']}, {r['peak_earliest_h']}, {r['peak_latest_h']}, '{note}'::jsonb)"
              for r in rows]
    return "\n".join(lines) + "\n" + ",\n".join(values) + ";\n"


def write_csv(path: Path, rows: list[dict], names: dict[str, tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["tambon_code", "name_th", "name_en", *list(rows[0].keys())[1:]])
        w.writeheader()
        for r in rows:
            th, en = names.get(r["tambon_code"], ("", ""))
            w.writerow({**r, "name_th": th, "name_en": en})


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
