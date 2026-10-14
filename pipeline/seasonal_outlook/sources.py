"""Rain records other than CHIRPS, turned into the same five-day rows {area, year, month, pentad, mm}.

A "pentad" is CHIRPS's: days 1-5, 6-10, 11-15, 16-20, 21-25 and 26 to the month's end.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np


def pentad_of(day: int) -> int:
    return min((day - 1) // 5, 5)


def to_pentads(daily: list[dict]) -> list[dict]:
    """Rows {area, year, month, day, mm} -> five-day sums. A pentad with a missing day is left out,
    so a gap never reads as a dry spell."""
    acc: dict[tuple, list[float]] = defaultdict(list)
    days: dict[tuple, set[int]] = defaultdict(set)
    for r in daily:
        if r["mm"] is None:
            continue
        key = (r["area"], r["year"], r["month"], pentad_of(r["day"]))
        if r["day"] in days[key]:
            continue
        days[key].add(r["day"])
        acc[key].append(float(r["mm"]))
    out = []
    for (area, year, month, p), vals in sorted(acc.items()):
        need = 5 if p < 5 else _days_in(year, month) - 25
        if len(vals) == need:
            out.append({"area": area, "year": year, "month": month, "pentad": p, "mm": round(sum(vals), 2)})
    return out


def _days_in(year: int, month: int) -> int:
    import calendar

    return calendar.monthrange(year, month)[1]


def gauge_daily(frames, stations: dict[int, str], min_stations: int = 3) -> list[dict]:
    """Daily area means from the ThaiWater gauges: the mean of every reporting station in a province
    (and in the four together), Bangkok calendar days. `frames` yields DataFrames with station_id, ts
    (UTC; a day's total is stamped 17:00 UTC the evening before) and value. Days with fewer than
    `min_stations` reporting are left out."""
    import pandas as pd

    df = pd.concat(list(frames), ignore_index=True)
    df = df[df["station_id"].isin(stations.keys()) & df["value"].notna() & (df["value"] >= 0)]
    df = df.assign(day=(df["ts"] + pd.Timedelta(hours=7)).dt.date, area=df["station_id"].map(stations))
    out = []
    for area, part in [("all", df), *df.groupby("area")]:
        g = part.groupby("day")["value"].agg(["mean", "count"])
        for day, row in g.iterrows():
            if row["count"] >= min_stations:
                out.append({"area": area, "year": day.year, "month": day.month, "day": day.day,
                            "mm": round(float(row["mean"]), 2)})
    return out


def agreement(a: dict[int, float], b: dict[int, float]) -> dict:
    """How two records of the same seasons agree: rank correlation and the share of seasons in the
    same third."""
    from scipy import stats

    common = sorted(set(a) & set(b))
    x, y = np.array([a[s] for s in common]), np.array([b[s] for s in common])

    def third(v):
        lo, hi = np.percentile(v, [100 / 3, 200 / 3])
        return np.where(v < lo, 0, np.where(v > hi, 2, 1))

    return {"seasons": len(common), "spearman": round(float(stats.spearmanr(x, y).statistic), 2),
            "same_third_pct": round(100 * float((third(x) == third(y)).mean()), 0)}
