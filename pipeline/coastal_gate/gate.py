"""The coastal gate: how much low-water window the sea leaves a river to drain through.

An hourly sea-level record holds two things that matter here. The **tide** opens and shuts the
mouth twice (here often once) a day, and the **set-up** - the slow part left when the tide is
filtered out - is where the north-east monsoon piles water against this coast. A river drains
while the sea is below it, so what decides whether days of rain leave or stay is not the high
water but the *low* water: the floor the river has to get over. Set-up lifts that floor, and when
the tidal range collapses at the same time the floor never drops.

Everything here is a modifier. The sea floods nothing on its own; it decides how long the water
stays (safety rules 2 and 8).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def godin(s: pd.Series, windows: tuple[int, int, int] = (24, 24, 25)) -> pd.Series:
    """The slow (non-tidal) part of an hourly series: three centred moving means, 24-24-25 hours.

    The standard filter for taking both the diurnal and the semidiurnal tide out of a sea-level
    record, and the reason this module does not reuse the single 25-hour mean of
    thresholds/tide.py: the Gulf's tide is largely diurnal, which a 25-hour mean passes in part.
    """
    out = s
    for w in windows:
        out = out.rolling(w, center=True).mean()
    return out


def daily(s: pd.Series, min_hours: int = 20) -> pd.DataFrame:
    """Per Bangkok day: lower low water, higher high water, range, mean, and the set-up.

    Bangkok days because that is the day an admin and a resident live in, and because a tidal day
    here runs roughly with the solar day.
    """
    if s.empty:
        return pd.DataFrame(columns=["llw", "hhw", "range", "mean", "setup", "hours"])
    setup = godin(s)
    local = s.tz_convert("Asia/Bangkok")
    day = local.index.floor("D")
    out = pd.DataFrame({
        "llw": local.groupby(day).min(),
        "hhw": local.groupby(day).max(),
        "mean": local.groupby(day).mean(),
        "setup": setup.tz_convert("Asia/Bangkok").groupby(day).mean(),
        "hours": local.groupby(day).count(),
    })
    out["range"] = out["hhw"] - out["llw"]
    out.index = pd.DatetimeIndex(out.index).tz_localize(None)
    out.index.name = "day"
    return out[out["hours"] >= min_hours]


def reference(days: pd.DataFrame, months: list[int], percentiles: list[int]) -> dict:
    """Percentiles of the daily low water and the set-up over the flood-season months only."""
    season = days[days.index.month.isin(months)]
    if season.empty:
        return {"days": 0}
    out: dict = {"days": int(len(season)),
                 "first": str(season.index[0].date()), "last": str(season.index[-1].date())}
    for col in ("llw", "hhw", "setup", "range"):
        for p in percentiles:
            out[f"{col}_p{p}"] = round(float(season[col].quantile(p / 100)), 3)
        out[f"{col}_mean"] = round(float(season[col].mean()), 3)
    return out


def monthly(days: pd.DataFrame, percentiles: list[int]) -> dict:
    """The same figures month by month, for the report: the gate is a December thing above all."""
    out = {}
    for m, part in days.groupby(days.index.month):
        row = {"days": int(len(part))}
        for p in percentiles:
            row[f"llw_p{p}"] = round(float(part["llw"].quantile(p / 100)), 3)
            row[f"setup_p{p}"] = round(float(part["setup"].quantile(p / 100)), 3)
        out[int(m)] = row
    return out


# The shoreline from Songkhla to Tak Bai runs north-west to south-east, so onshore is from about
# north-east - which is the monsoon's own direction, and why the set-up and the season arrive
# together.
ONSHORE_DEG = 45.0


def onshore_stress(speed_ms: pd.Series, direction_deg: pd.Series) -> pd.Series:
    """Onshore wind stress, signed: the onshore component squared. Wind stress goes as the square."""
    onshore = speed_ms * np.cos(np.radians(direction_deg - ONSHORE_DEG))
    return np.sign(onshore) * onshore**2


def wind_link(setup: pd.Series, stress: pd.Series, months: list[int], lags_h=(0, 12, 24, 36, 48)) -> dict:
    """Does onshore wind explain the set-up? If it does, a wind forecast sees the gate coming."""
    both = pd.concat({"setup": godin(setup), "stress": godin(stress)}, axis=1).dropna()
    season = both[both.index.month.isin(months)]
    if len(season) < 24 * 30:
        return {"hours": int(len(season))}
    return {
        "hours": int(len(season)),
        "r_all_year": round(float(both["setup"].corr(both["stress"])), 2),
        "r_season": round(float(season["setup"].corr(season["stress"])), 2),
        "r_by_lag_h": {int(h): round(float(season["setup"].corr(season["stress"].shift(h))), 2) for h in lags_h},
    }


def spells(days: pd.DataFrame, threshold: float, min_days: int) -> list[dict]:
    """Runs of consecutive days whose low water stayed at or over `threshold`."""
    if days.empty:
        return []
    hit = days["llw"] >= threshold
    out, start, prev = [], None, None
    for day, v in hit.items():
        if v and start is None:
            start = day
        elif not v and start is not None:
            out.append((start, prev))
            start = None
        prev = day
    if start is not None:
        out.append((start, prev))
    return [{"from": str(a.date()), "to": str(b.date()), "days": (b - a).days + 1,
             "llw_max": round(float(days.loc[a:b, "llw"].max()), 2),
             "setup_max": round(float(days.loc[a:b, "setup"].max()), 2)}
            for a, b in out if (b - a).days + 1 >= min_days]
