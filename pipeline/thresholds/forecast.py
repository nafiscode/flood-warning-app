"""Forecast rain before the floods: how much warning would the rain forecast have given?

The signal dashboard suggests Watch when the forecast holds a zone's 72-hour rain threshold in the
coming three days. This checks that rule against the 2024 and 2025 seasons, the only ones Open-Meteo
keeps past forecasts for (its "previous runs" archive starts during 2024).

`precipitation_previous_dayN` at hour h is the forecast for h made about N days before h. The sum of
`previous_day3` over the 72 hours from t was therefore all issued by time t: a forecast of the next
three days that an admin could have read at t, with runs between one and three days old. The live
dashboard reads fresher runs, so this is, if anything, the cautious case.

Two questions, per zone:

  1. **Warning:** the rule "the next 72 hours hold the Watch threshold" scored like every other
     threshold (alarm spells against the floods at the key gauge), beside the same rule on rain that
     had already fallen (satellite, GSMaP).
  2. **Amount:** the 72 hours of rain before each flood as the forecasts issued one, two and three
     days earlier saw them, against what the satellite measured.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from . import hindcast as hc

ARCHIVE_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
DAYS = (1, 2, 3)
# Lower thresholds for forecast rain, because every model was far drier than what fell.
FORECAST_CANDIDATES_MM = [20, 30, 40, 50, 60, 80, 100, 120, 150]


def fetch(points: list[list[float]], first: str, last: str, cache: Path, agent: str, model: str | None = None) -> pd.DataFrame:
    """Hourly forecast rain (mm) averaged over `points` [[lon, lat], ...], one column per lead day."""
    import requests

    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{model or 'best_match'}_{first}_{last}.parquet"
    if not path.exists():
        r = requests.get(ARCHIVE_URL, params={
            "latitude": ",".join(str(p[1]) for p in points),
            "longitude": ",".join(str(p[0]) for p in points),
            "hourly": ",".join(f"precipitation_previous_day{d}" for d in DAYS),
            "start_date": first, "end_date": last, "timezone": "GMT",
            **({"models": model} if model else {}),
        }, headers={"User-Agent": agent}, timeout=300)
        r.raise_for_status()
        body = r.json()
        sites = body if isinstance(body, list) else [body]
        frames = []
        for site in sites:
            h = site["hourly"]
            idx = pd.to_datetime(h["time"], utc=True)
            frames.append(pd.DataFrame({f"day{d}": pd.Series(h[f"precipitation_previous_day{d}"], index=idx, dtype="float64")
                                        for d in DAYS}))
        mean = pd.concat(frames).groupby(level=0).mean()
        mean.to_parquet(path)
        time.sleep(2)
    return pd.read_parquet(path)


def ahead(rain: pd.Series, hours: int = 72) -> pd.Series:
    """The total of the next `hours` from each hour (the hour itself included)."""
    return rain.rolling(hours, min_periods=int(hours * 0.9)).sum().shift(-(hours - 1))


def behind(rain: pd.Series, hours: int = 72) -> pd.Series:
    """The total of the last `hours` up to and including each hour."""
    return rain.rolling(hours, min_periods=int(hours * 0.9)).sum()


def zone_check(forecast: pd.DataFrame, observed: pd.Series, onsets: list[pd.Timestamp], threshold: float,
               windows: list[tuple[pd.Timestamp, pd.Timestamp]], alarm_cfg: dict) -> dict:
    """The warning score of the forecast rule and the observed rule, and the amounts before each flood."""
    inside = pd.Series(False, index=forecast.index)
    for a, b in windows:
        inside |= (forecast.index >= a) & (forecast.index < b)

    def score(flag: pd.Series) -> dict:
        flag = flag.reindex(inside.index).fillna(False) & inside
        return hc.score(hc.spells(flag, float(alarm_cfg["merge_gap_h"])), onsets, float(alarm_cfg["hit_window_h"]))

    fc_ahead = ahead(forecast["day3"])
    obs_behind = behind(observed.reindex(forecast.index))
    floods = []
    for onset in onsets:
        start = onset - pd.Timedelta(hours=72)
        row = {"onset": str(onset), "observed_72h_mm": None}
        part = observed[start:onset - pd.Timedelta(hours=1)]
        if len(part.dropna()) >= 60:
            row["observed_72h_mm"] = round(float(part.sum()), 1)
        for d in DAYS:
            f = forecast[f"day{d}"][start:onset - pd.Timedelta(hours=1)]
            row[f"forecast_day{d}_mm"] = round(float(f.sum()), 1) if len(f.dropna()) >= 60 else None
        floods.append(row)
    candidates = [{"threshold": v, **score(fc_ahead >= v)} for v in FORECAST_CANDIDATES_MM]
    best = hc.choose(candidates, 12)
    return {
        "threshold_mm": threshold,
        "forecast_candidates": candidates,
        "forecast_best": best,
        "forecast_rule": score(fc_ahead >= threshold),
        "observed_rule": score(obs_behind >= threshold),
        "floods": floods,
    }


def markdown(rows: dict) -> str:
    lines = ["| Zone · model | Watch (72 h) | Rule | Floods caught | False alarms | Median lead | Shortest lead |",
             "|---|---|---|---|---|---|---|"]
    for zone, r in rows.items():
        for name, key in (("forecast, next 72 h", "forecast_rule"), ("rain already fallen", "observed_rule")):
            s = r[key]
            lines.append(f"| {zone} | {r['threshold_mm']:g} mm | {name} | {s['detected']}/{s['floods']} | "
                         f"{s['false_alarms']} | {s['median_lead_h'] if s['median_lead_h'] is not None else '–'} h | "
                         f"{s['shortest_lead_h'] if s['shortest_lead_h'] is not None else '–'} h |")
    lines += ["", "| Zone · model | Best forecast threshold (72 h ahead) | Floods caught | False alarms | Median lead |",
              "|---|---|---|---|---|"]
    for zone, r in rows.items():
        b = r.get("forecast_best")
        if b is None:
            lines.append(f"| {zone} | none caught a flood 12 h ahead | – | – | – |")
        else:
            lines.append(f"| {zone} | {b['threshold']:g} mm | {b['detected']}/{b['floods']} | {b['false_alarms']} | {b['median_lead_h']} h |")
    lines += ["", "| Zone | Flood onset (UTC) | Satellite, 72 h before (mm) | Forecast issued 1 / 2 / 3 days earlier (mm) |",
              "|---|---|---|---|"]
    for zone, r in rows.items():
        for f in r["floods"]:
            fc = " / ".join("–" if f[f"forecast_day{d}_mm"] is None else f"{f[f'forecast_day{d}_mm']:g}" for d in DAYS)
            obs = "–" if f["observed_72h_mm"] is None else f"{f['observed_72h_mm']:g}"
            lines.append(f"| {zone} | {f['onset'][:16]} | {obs} | {fc} |")
    return "\n".join(lines) + "\n"
