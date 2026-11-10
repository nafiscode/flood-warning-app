"""Season state (science plan Module 11): how wet a catchment already is, and whether its river
has been rising for a week.

Pure computation on pandas series. No I/O, no clock, no network: everything here takes a series
and settings and returns figures, so the tests can run it on a few made-up days.

Two ideas only:

* **Baseflow** is the daily *minimum* of the gauge, on Bangkok days. The minimum because it is the
  closest thing to a tide-free floor that a single gauge offers: the tide and the day's rain push
  the maximum about, while the floor follows what the catchment is holding. It is not a discharge
  and it is not comparable between gauges - only against the same gauge's own past.
* **Antecedent rain** is the basin-mean rain already fallen, over 15 days, 30 days and since the
  first of October, each against the same basin's own record for that month.

Both are read as a position in their own record (below / middle / above the two terciles), never as
an absolute figure, because an absolute metre at one gauge means nothing at another (safety rule 8).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

BANGKOK = "Asia/Bangkok"
#: The flood season, and the only months the archive's cached basin rain covers.
MONTHS: tuple[int, ...] = (10, 11, 12, 1)


def season_of(index: pd.DatetimeIndex, start_month: int = 10) -> np.ndarray:
    """The season each timestamp belongs to, named by the October it starts in."""
    return np.where(index.month >= start_month, index.year, index.year - 1)


def baseflow(level: pd.Series) -> pd.Series:
    """The daily minimum on Bangkok days: the gauge's floor, day by day.

    Days with no reading are dropped rather than interpolated - a missing day must not look like a
    day the river did not rise.
    """
    if level.empty:
        return pd.Series(dtype="float64")
    local = level.tz_convert(BANGKOK) if level.index.tz is not None else level.tz_localize("UTC").tz_convert(BANGKOK)
    return local.resample("1D").min().dropna()


#: Periods in hours. The first three are the sea's: the moon and sun's semidiurnal M2 and the two
#: diurnal constituents K1 and O1, which the Gulf's largely diurnal tide rides on. S1 is exactly one
#: solar day and is **not** tidal: a hydropower station that opens its turbines every evening, or
#: any other human cycle, lands there. None of the three tidal periods is exactly 24 hours, which is
#: what lets this tell Bang Lang's daily pulse at X.77 from the sea at a river mouth.
CONSTITUENTS: dict[str, float] = {
    "M2": 12.4206012, "K1": 23.9344696, "O1": 25.8193387, "S1": 24.0,
}
TIDAL = ("M2", "K1", "O1")


def harmonics(level: pd.Series, min_hours: int = 24 * 400) -> dict | None:
    """Fit the sea's periods and the solar day to a gauge's sub-daily wobble.

    The Godin filter (coastal_gate) takes the slow part out first, so what is fitted is the wobble
    the catchment's own rise does not explain. Each amplitude is half the peak-to-trough swing that
    period contributes, in metres.

    `tide_m` combines the three tidal constituents; `pulse_m` is the solar-day one. Separating S1
    from K1 needs more than a year of record (they beat against each other over about a year), so
    None below `min_hours` - and a gauge that cannot be judged is left out and said to be, rather
    than assumed to be clean.
    """
    from coastal_gate.gate import godin

    s = level.dropna()
    if s.size < min_hours:
        return None
    fast = (s - godin(s)).dropna()
    if fast.size < min_hours // 2:
        return None
    hours = (fast.index - fast.index[0]).total_seconds().to_numpy(dtype="float64") / 3600.0
    columns = [np.ones_like(hours)]
    for period in CONSTITUENTS.values():
        w = 2.0 * np.pi / period
        columns += [np.cos(w * hours), np.sin(w * hours)]
    design = np.column_stack(columns)
    coefficients, *_ = np.linalg.lstsq(design, fast.to_numpy(dtype="float64"), rcond=None)
    amplitudes = {}
    for i, name in enumerate(CONSTITUENTS):
        a, b = coefficients[1 + 2 * i], coefficients[2 + 2 * i]
        amplitudes[name] = round(float(np.hypot(a, b)), 3)
    tide = float(np.sqrt(sum(amplitudes[n] ** 2 for n in TIDAL)))
    return {
        "amplitudes": amplitudes,
        "tide_m": round(tide, 3),
        "pulse_m": amplitudes["S1"],
        "hours": int(s.size),
        "years": round(float(hours[-1] / (24 * 365.25)), 1),
    }


def rose_days(daily: pd.Series, window: int = 7) -> pd.Series:
    """For each day, how many of the last `window` days' floors were above the day before.

    NaN until there are `window` days, and a day whose neighbour is missing counts as not risen:
    the rule must never be satisfied by a gap.
    """
    if daily.empty:
        return pd.Series(dtype="float64")
    full = daily.resample("1D").mean()
    rose = (full.diff() > 0).astype("float64")
    rose[full.isna()] = np.nan
    return rose.rolling(window, min_periods=window).sum()


def change_over(daily: pd.Series, window: int = 7) -> pd.Series:
    """How much the floor has moved over `window` days, in metres."""
    if daily.empty:
        return pd.Series(dtype="float64")
    return daily.resample("1D").mean().diff(window)


def daily_rain(hourly: pd.Series) -> pd.Series:
    """Basin-mean rain per Bangkok day, in mm. A day missing any hour is dropped."""
    if hourly.empty:
        return pd.Series(dtype="float64")
    local = hourly.tz_convert(BANGKOK) if hourly.index.tz is not None else hourly.tz_localize("UTC").tz_convert(BANGKOK)
    counted = local.resample("1D").count()
    total = local.resample("1D").sum(min_count=1)
    return total[counted >= 24].dropna()


def rain_window(rain: pd.Series, days: int) -> pd.Series:
    """Rolling total over `days` whole days, only where every day of the window is present."""
    if rain.empty:
        return pd.Series(dtype="float64")
    full = rain.resample("1D").mean()
    out = full.rolling(days, min_periods=days).sum()
    return out.dropna()


def rain_since_october(rain: pd.Series, start_month: int = 10) -> pd.Series:
    """The season's running total from the first of October, in mm."""
    if rain.empty:
        return pd.Series(dtype="float64")
    full = rain.resample("1D").mean()
    seasons = season_of(full.index, start_month)
    return full.groupby(seasons).cumsum().dropna()


def terciles(values: pd.Series, seasons: np.ndarray, min_seasons: int) -> dict:
    """The lower and upper third of a set of days, with the number of seasons behind them.

    Returns nulls - never a made-up number - when fewer than `min_seasons` seasons contributed.
    Terciles, not high percentiles, because the key gauges have six seasons of record: a p98 over
    six values would be a single day dressed up as a statistic.
    """
    v = np.asarray(values, dtype="float64")
    s = np.asarray(seasons)
    if s.size != v.size:
        s = np.zeros(v.size)
    keep = ~np.isnan(v)
    v, s = v[keep], s[keep]
    none = {"p33": None, "p50": None, "p67": None}
    if v.size == 0:
        return {**none, "seasons": 0, "days": 0}
    count = int(len(set(s.tolist())))
    if count < min_seasons:
        return {**none, "seasons": count, "days": int(v.size)}
    q = np.percentile(v, [33.3, 50.0, 66.7])
    return {"p33": round(float(q[0]), 3), "p50": round(float(q[1]), 3), "p67": round(float(q[2]), 3),
            "seasons": count, "days": int(v.size)}


def monthly(values: pd.Series, min_seasons: int, months: tuple[int, ...] = MONTHS,
            start_month: int = 10) -> dict[int, dict]:
    """`{month: terciles}` for each flood-season month, over whole seasons of one series."""
    out: dict[int, dict] = {}
    if values.empty:
        return {m: terciles(pd.Series(dtype="float64"), np.array([]), min_seasons) for m in months}
    idx = pd.DatetimeIndex(values.index)
    seasons = season_of(idx, start_month)
    for m in months:
        pick = idx.month == m
        out[m] = terciles(values[pick], seasons[pick], min_seasons)
    return out


def band(value: float | None, ref: dict | None) -> str:
    """Where one figure sits in its own record: `low`, `middle`, `high`, or `unknown`.

    `unknown` whenever either side is missing. It is never guessed, and `unknown` must read as
    "we cannot say", never as "normal" (safety rule 10).
    """
    if value is None or ref is None or ref.get("p33") is None or ref.get("p67") is None:
        return "unknown"
    if value <= float(ref["p33"]):
        return "low"
    if value >= float(ref["p67"]):
        return "high"
    return "middle"


#: What the soft notice needs to be true before it says anything.
RULE = {"rose_days_min": 5, "rose_window": 7, "rain_window_days": 15}


def grade(rose: float | None, rain_band: str, rule: dict | None = None) -> tuple[str, list[str]]:
    """The zone's state in one word, and the reasons behind it.

    `rising_wet` only when both legs hold: the floor rose on at least `rose_days_min` of the last
    seven days **and** the fifteen-day rain is in the top third of this basin's own record for the
    month. Either leg alone is `wet` or `rising`, which raises nothing and is only shown.

    Whether the floor is above or below normal for the date is deliberately **not** a condition.
    Measured on the archive, the daily minimum at X.40A (Yala) sat about a metre *below* its own
    median for the date through 5-22 November 2025 and then went over its bank on the 24th: the
    worst flood in the record fell on a catchment that was running low. A gate on "above normal"
    would have been silent before it. The figure is printed beside the grade instead.
    """
    r = {**RULE, **(rule or {})}
    rising = rose is not None and rose >= float(r["rose_days_min"])
    wet = rain_band == "high"
    reasons = []
    if rising:
        reasons.append("rising_week")
    if wet:
        reasons.append("wet_fortnight")
    if rising and wet:
        return "rising_wet", reasons
    if wet:
        return "wet", reasons
    if rising:
        return "rising", reasons
    return "quiet", reasons
