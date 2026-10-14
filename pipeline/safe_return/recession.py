"""Flood events at a gauge and how long the river took to fall back after each.

Pure functions on an hourly pandas Series with a gapless UTC DatetimeIndex (missing hours are NaN),
as `dam_release.travel.read_hourly` returns it. Nothing here publishes anything: the durations are
shown to the admin who writes a Return alert's window, beside their own judgement (safety rule 2).
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

HOUR = pd.Timedelta("1h")


def clean(level: pd.Series, bank_m: float, max_above_bank_m: float, bridge_h: int) -> pd.Series:
    """Drop broken-sensor readings, put the series on a gapless hourly index and bridge short gaps.

    Only gaps of at most `bridge_h` missing hours are filled (a straight line between the readings
    on either side); a longer gap stays missing in full, not filled at its edges.
    """
    s = level.dropna()
    s = s[s <= bank_m + max_above_bank_m]
    if s.empty:
        return s
    s = s[~s.index.duplicated(keep="last")].sort_index().resample("1h").mean()
    missing = s.isna().to_numpy()
    if not missing.any() or bridge_h <= 0:
        return s
    filled = s.interpolate(limit_area="inside")
    keep_gap = np.zeros(len(s), bool)
    for a, b in runs(missing):
        if b - a + 1 > bridge_h:
            keep_gap[a:b + 1] = True
    return filled.mask(keep_gap)


def runs(flag: np.ndarray) -> list[tuple[int, int]]:
    """Runs of True as (first, last) positions, both inclusive."""
    f = np.asarray(flag, bool)
    if not f.any():
        return []
    d = np.diff(np.concatenate([[0], f.astype(np.int8), [0]]))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1) - 1
    return list(zip(starts.tolist(), ends.tolist()))


def groups(on: np.ndarray, stay_below_h: int, min_hours: int) -> list[tuple[int, int]]:
    """Events as (first, last) positions of the hours at or above the level.

    Spells above the level with fewer than `stay_below_h` hours between them (missing hours count
    as between) are one event; an event needs at least one spell of `min_hours` hours in a row.
    """
    spells = runs(on)
    out: list[list[int]] = []
    longest: list[int] = []
    for a, b in spells:
        if out and a - out[-1][1] - 1 < stay_below_h:
            out[-1][1] = b
            longest[-1] = max(longest[-1], b - a + 1)
        else:
            out.append([a, b])
            longest.append(b - a + 1)
    return [(a, b) for (a, b), n in zip(out, longest) if n >= min_hours]


def stays_below(values: np.ndarray, start: int, level: float, stay_h: int) -> tuple[int | None, int, bool]:
    """The first position from `start` where the value is below `level` and stays below for `stay_h`
    observed hours.

    Returns (position, last position known, censored). Censored when a missing hour or the end of
    the record comes first: the river was still at or above the level at least until the position
    known, and when it fell is not on record.
    """
    n = len(values)
    t = start
    while t < n:
        v = values[t]
        if math.isnan(v):
            return None, t - 1, True
        if v < level:
            window = values[t:t + stay_h]
            # The first hour in the window that is not "observed and below": a rise or a gap.
            stop = np.flatnonzero(np.isnan(window) | (window >= level))
            if stop.size == 0:
                if len(window) < stay_h:
                    return None, t - 1, True      # the record ends before the stay is complete
                return t, t, False
            k = int(stop[0])
            if math.isnan(window[k]):
                return None, t - 1, True          # below, but a gap hides whether it stayed below
            t += k
            continue
        t += 1
    return None, n - 1, True


def season_of(t: pd.Timestamp, start_month: int = 10) -> int:
    """The water year a moment belongs to, named by the October it starts in."""
    return t.year if t.month >= start_month else t.year - 1


def events(level: pd.Series, warning_m: float, bank_m: float, opts: dict) -> list[dict]:
    """Every flood event at one gauge with its peak and how long the fall back took.

    `level` is the cleaned hourly series (`clean`). Each event: its first hour at or above Warning,
    its peak (time and level), the hours from the peak until the level was below the bank and below
    Warning and stayed there (`stay_below_h`), the hours at or above the bank in all, and whether
    either duration is censored (a gap or the end of the record came first; the figure is then a
    lower bound). Events with a gap near the peak, that begin with the record or a gap, or (when
    `opts["months"]` is given) whose peak falls outside those months, or inside one of
    `opts["exclude"]` ((from, to) dates, a known non-flood period), are returned with `dropped` set
    and no durations.
    """
    if level.empty:
        return []
    idx = level.index
    v = level.to_numpy(dtype="float64")
    stay = int(opts["stay_below_h"])
    guard = int(opts["peak_guard_h"])
    start_month = int(opts.get("season_start_month", 10))
    months = set(int(m) for m in (opts.get("months") or []))
    excluded = [(pd.Timestamp(a, tz="UTC"), pd.Timestamp(b, tz="UTC")) for a, b in (opts.get("exclude") or [])]
    on =np.nan_to_num(v, nan=-np.inf) >= warning_m
    out = []
    for a, b in groups(on, stay, int(opts["min_hours"])):
        part = v[a:b + 1]
        p = a + int(np.nanargmax(part))
        peak_m = float(v[p])
        ev = {"start": idx[a], "peak_at": idx[p], "peak_m": round(peak_m, 2),
              "season": season_of(idx[p], start_month), "over_bank": peak_m >= bank_m, "dropped": None,
              "to_bank_h": None, "to_bank_censored": False, "to_warning_h": None, "to_warning_censored": False,
              "above_bank_h": None, "hours_above_warning": int(on[a:b + 1].sum())}
        lo, hi = max(0, p - guard), min(len(v), p + guard + 1)
        if months and idx[p].month not in months:
            # Outside the flood months: high water then is no monsoon flood (and at X.77 below
            # Bang Lang, the dam's daily turbine pulses).
            ev["dropped"] = "off_season"
        elif any(lo_t <= idx[p] < hi_t for lo_t, hi_t in excluded):
            ev["dropped"] = "excluded"
        elif a == 0 or math.isnan(v[a - 1]):
            # Already above Warning when the record (or a gap) begins: the rise and the peak are unseen.
            ev["dropped"] = "starts_in_gap"
        elif np.isnan(v[lo:hi]).any():
            ev["dropped"] = "gap_at_peak"
        if ev["dropped"]:
            out.append(ev)
            continue
        w_pos, w_known, w_cens = stays_below(v, p, warning_m, stay)
        end = w_pos if w_pos is not None else w_known + 1
        ev["to_warning_h"] = float(((idx[w_pos] if w_pos is not None else idx[w_known]) - idx[p]) / HOUR)
        ev["to_warning_censored"] = w_cens
        if peak_m >= bank_m:
            k_pos, k_known, k_cens = stays_below(v, p, bank_m, stay)
            ev["to_bank_h"] = float(((idx[k_pos] if k_pos is not None else idx[k_known]) - idx[p]) / HOUR)
            ev["to_bank_censored"] = k_cens
        seg = v[a:end]
        ev["above_bank_h"] = int(np.sum(np.nan_to_num(seg, nan=-np.inf) >= bank_m))
        out.append(ev)
    return out


def quantiles(values: list[float], min_n: int) -> dict:
    """25th, 50th and 75th percentile (linear), min, max and n; the percentiles are None under `min_n`."""
    x = np.asarray([float(t) for t in values if t is not None], dtype="float64")
    n = int(x.size)
    if n == 0:
        return {"n": 0, "p25": None, "p50": None, "p75": None, "min": None, "max": None}
    q = np.percentile(x, [25, 50, 75]) if n >= min_n else [None, None, None]
    return {"n": n, "p25": None if q[0] is None else round(float(q[0]), 1),
            "p50": None if q[1] is None else round(float(q[1]), 1),
            "p75": None if q[2] is None else round(float(q[2]), 1),
            "min": round(float(x.min()), 1), "max": round(float(x.max()), 1)}


def typical_range(p25: float | None, p75: float | None, half_days_from_h: float = 48) -> dict | None:
    """The 25th to 75th percentile widened outward: whole hours, or half days when the top passes
    `half_days_from_h`. Returns {"low_h", "high_h", "text"} (English, for the report)."""
    if p25 is None or p75 is None:
        return None
    if p75 > half_days_from_h:
        high = 12 * math.ceil(p75 / 12)
        if p25 < 24:
            # A low end under a day stays in hours: rounding 20 h down to half a day would say 12 h.
            low = math.floor(p25)
            text = f"{low} h – {high / 24:g} days"
        else:
            low = 12 * math.floor(p25 / 12)
            text = f"{low / 24:g}–{high / 24:g} days"
    else:
        low, high = math.floor(p25), math.ceil(p75)
        text = f"{low}–{high} h"
    return {"low_h": int(low), "high_h": int(high), "text": text}


def summarise(evs: list[dict], min_events: int, half_days_from_h: float = 48) -> dict:
    """Per gauge: counts, and the spread of each duration over the complete (uncensored) events."""
    used = [e for e in evs if not e["dropped"]]
    over = [e for e in used if e["over_bank"]]
    to_bank = [e["to_bank_h"] for e in over if not e["to_bank_censored"]]
    to_warn = [e["to_warning_h"] for e in used if not e["to_warning_censored"]]
    # The same, over the floods that went over the bank only: after an Evacuate it is these that count,
    # and a Warning-only event's short fall would otherwise pull the figure below the time to the bank.
    warn_over = [e["to_warning_h"] for e in over if not e["to_warning_censored"]]
    above = [e["above_bank_h"] for e in over if not e["to_bank_censored"]]
    qb, qw, qa = quantiles(to_bank, min_events), quantiles(to_warn, min_events), quantiles(above, min_events)
    qwo = quantiles(warn_over, min_events)
    seasons = sorted({e["season"] for e in used})
    dropped: dict[str, int] = {}
    for e in evs:
        if e["dropped"]:
            dropped[e["dropped"]] = dropped.get(e["dropped"], 0) + 1
    return {
        "events": len(used), "over_bank": len(over), "dropped": dropped,
        "censored": sum(1 for e in used if e["to_warning_censored"] or e["to_bank_censored"]),
        "censored_bank": sum(1 for e in over if e["to_bank_censored"]),
        "censored_warning": sum(1 for e in used if e["to_warning_censored"]),
        "to_bank_h": qb, "to_warning_h": qw, "to_warning_h_over_bank": qwo, "above_bank_h": qa,
        "to_bank_range": typical_range(qb["p25"], qb["p75"], half_days_from_h),
        "to_warning_range": typical_range(qw["p25"], qw["p75"], half_days_from_h),
        "to_warning_over_bank_range": typical_range(qwo["p25"], qwo["p75"], half_days_from_h),
        "first_season": seasons[0] if seasons else None, "last_season": seasons[-1] if seasons else None,
        "few_events": qw["n"] < min_events,
    }
