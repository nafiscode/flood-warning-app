"""Floods from a gauge, alarms from a signal, and how the one stands against the other.

Pure functions on hourly pandas Series with a UTC DatetimeIndex. Nothing here publishes anything:
the output is a table of provisional thresholds for the admins' signal dashboard, which suggests a
level and never sets one (safety rule 2).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

HOUR = pd.Timedelta("1h")


def hourly(series: pd.Series) -> pd.Series:
    """One value per hour (the mean of what fell in it); hours without data stay missing."""
    s = series.dropna()
    if s.empty:
        return s
    return s.resample("1h").mean()


def spells(flag: pd.Series, merge_gap_h: float, min_hours: int = 1) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Runs of True in an hourly series as (first hour, last hour); gaps up to `merge_gap_h` are bridged.

    Missing hours count as False but do not split a run shorter than the gap.
    """
    on = flag.fillna(False).astype(bool)
    times = on.index[on.values]
    if len(times) == 0:
        return []
    out, start, prev = [], times[0], times[0]
    for t in times[1:]:
        if (t - prev) > pd.Timedelta(hours=merge_gap_h) + HOUR:
            out.append((start, prev))
            start = t
        prev = t
    out.append((start, prev))
    return [(a, b) for a, b in out if int(on[a:b].sum()) >= min_hours]


def floods(level: pd.Series, bank_m: float, min_hours: int, gap_days: float) -> list[dict]:
    """Each spell at or above the bank: when it began, its highest level and when, when it ended."""
    lv = hourly(level)
    out = []
    for a, b in spells(lv >= bank_m, gap_days * 24, min_hours):
        part = lv[a:b]
        out.append({"onset": a, "end": b, "peak_m": round(float(part.max()), 2), "peak_at": part.idxmax(),
                    "hours_over": int((part >= bank_m).sum())})
    return out


def season_of(t: pd.Timestamp, start_month: int = 10, end_month: int = 1) -> int | None:
    """The season a moment belongs to, named by its starting year; None outside the season."""
    if t.month >= start_month:
        return t.year
    if t.month <= end_month:
        return t.year - 1
    return None


def in_seasons(index: pd.DatetimeIndex, first: int, last: int, start_month: int, end_month: int) -> np.ndarray:
    year = np.where(index.month >= start_month, index.year, np.where(index.month <= end_month, index.year - 1, -1))
    return (year >= first) & (year <= last)


def rolling_sum(rain_mm: pd.Series, hours: int) -> pd.Series:
    """Rain over the last `hours`, missing when more than a tenth of the hours are missing."""
    r = hourly(rain_mm)
    return r.rolling(f"{hours}h").sum().where(r.rolling(f"{hours}h").count() >= 0.9 * hours)


def rise(level: pd.Series, hours: int) -> pd.Series:
    lv = hourly(level)
    return lv - lv.shift(hours)


def before(signal: pd.Series, onset: pd.Timestamp, leads_h: list[int]) -> dict[int, float | None]:
    """The signal's value at each lead before the onset (the last value within three hours)."""
    out = {}
    for lead in leads_h:
        t = onset - pd.Timedelta(hours=lead)
        part = signal[t - 3 * HOUR:t].dropna()
        out[lead] = None if part.empty else round(float(part.iloc[-1]), 2)
    return out


def score(alarm_spells: list[tuple[pd.Timestamp, pd.Timestamp]], onsets: list[pd.Timestamp], hit_window_h: float,
          judged: pd.Series | None = None) -> dict:
    """Hits, misses and false alarms.

    An alarm is a hit when a flood begins while it stands or within `hit_window_h` of its start.
    A flood is detected when some alarm began before it and covers it that way; its lead is the
    time from the first such alarm's start to the onset. `judged` (boolean, hourly) marks the
    hours in which a flood would have been seen had there been one: an alarm that starts outside
    them is counted apart, as unjudged, and is neither a hit nor a false alarm.
    """
    window = pd.Timedelta(hours=hit_window_h)
    hits = false = unjudged = 0
    lead: dict[pd.Timestamp, float] = {}
    for a, b in alarm_spells:
        caught = [o for o in onsets if a <= o <= max(b, a + window)]
        if caught:
            hits += 1
            for o in caught:
                lead[o] = max(lead.get(o, 0.0), (o - a) / HOUR)
        elif judged is not None and not bool(judged.get(a, False)):
            unjudged += 1
        else:
            false += 1
    leads = sorted(lead.values())
    found = len(lead)
    return {
        "floods": len(onsets), "detected": found, "missed": len(onsets) - found,
        "alarms": len(alarm_spells), "hits": hits, "false_alarms": false, "unjudged_alarms": unjudged,
        "pod": None if not onsets else round(found / len(onsets), 2),
        "far": None if hits + false == 0 else round(false / (hits + false), 2),
        "csi": None if not onsets else round(found / (len(onsets) + false), 2),
        "median_lead_h": None if not leads else round(float(np.median(leads)), 1),
        "shortest_lead_h": None if not leads else round(float(leads[0]), 1),
    }


def choose(rows: list[dict], min_lead_h: float) -> dict | None:
    """The candidate with the best balance of floods caught against false alarms.

    The balance is the critical success index: floods detected / (floods + false alarms). Only
    candidates whose median lead is at least `min_lead_h` are considered; ties go to the one that
    catches more floods, then to the longer lead. None when no candidate catches anything in time.
    """
    timely = [r for r in rows if r["detected"] and (r["median_lead_h"] or 0) >= min_lead_h]
    if not timely:
        return None
    return max(timely, key=lambda r: (r["csi"], r["detected"], r["median_lead_h"] or 0))
