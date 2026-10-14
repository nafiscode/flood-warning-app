"""The tide at the river mouths: does Open-Meteo's modelled sea level (the feed the signal
dashboard shows) agree with what the gauges near the mouths record?

The phase prompt asked for ThaiWater's own tide and storm-surge data to be evaluated first. Its
public API publishes no tide or surge series (its "wave" and "storm" items are model pictures:
SWAN wave maps and storm-track images), so the only observed sea-driven water level in the four
provinces is at the gauges the tide reaches. They are the yardstick here.

Each gauge's hourly level is split in two with a centred 25-hour mean (just over two tidal cycles):
the **tidal band** (level less its 25-hour mean) and the **slow part** (the 25-hour mean: river
flow, surge, monsoon set-up). For each band: the correlation with the model at the best lag within
six hours, and the ratio of the gauge's spread to the model's. A gauge whose tidal band follows the
model closely is tidal; one that does not is above the tide's reach.

It also counts, for each gauge, how often it stands at or over its bank while its slow part is below
the bank: hours over the bank that the tide alone explains. That is what makes a bank a poor flood
marker at a tidal gauge.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("thresholds")

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"


def fetch_sea_level(point: tuple[float, float], first: str, last: str, cache: Path, agent: str) -> pd.Series:
    """Hourly modelled sea level (m above mean sea level) at `point` (lon, lat), year by year, cached."""
    import requests

    cache.mkdir(parents=True, exist_ok=True)
    parts = []
    for year in range(int(first[:4]), int(last[:4]) + 1):
        path = cache / f"{year}.parquet"
        if not path.exists():
            start = max(first, f"{year}-01-01")
            end = min(last, f"{year}-12-31")
            r = requests.get(MARINE_URL, params={
                "latitude": point[1], "longitude": point[0], "hourly": "sea_level_height_msl",
                "start_date": start, "end_date": end, "timezone": "GMT",
            }, headers={"User-Agent": agent}, timeout=120)
            r.raise_for_status()
            h = r.json()["hourly"]
            s = pd.Series(h["sea_level_height_msl"], index=pd.to_datetime(h["time"], utc=True), dtype="float64")
            s.to_frame("sea_level_m").to_parquet(path)
            time.sleep(1)
        parts.append(pd.read_parquet(path)["sea_level_m"])
    s = pd.concat(parts).sort_index()
    return s[~s.index.duplicated(keep="last")]


def split(level: pd.Series, hours: int = 25) -> tuple[pd.Series, pd.Series]:
    """(tidal band, slow part) of an hourly series."""
    slow = level.rolling(hours, center=True, min_periods=int(hours * 0.8)).mean()
    return level - slow, slow


def best_match(a: pd.Series, b: pd.Series, max_lag_h: int = 6, min_pairs: int = 24 * 14) -> dict | None:
    """Correlation of `b` (the gauge) with `a` (the model) at the best whole-hour lag; a positive
    lag means the gauge follows the model. None without enough hours in common."""
    best = None
    for lag in range(-max_lag_h, max_lag_h + 1):
        pair = pd.concat([a, b.shift(-lag, freq="h")], axis=1).dropna()
        if len(pair) < min_pairs:
            continue
        x, y = pair.iloc[:, 0].to_numpy(), pair.iloc[:, 1].to_numpy()
        if x.std() == 0 or y.std() == 0:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        if best is None or r > best["r"]:
            best = {"r": round(r, 3), "lag_h": lag, "hours": len(pair), "spread_ratio": round(float(y.std() / x.std()), 2)}
    return best


def tide_over_bank(level: pd.Series, bank: float) -> dict:
    """Hours at or over the bank, and how many of them came while the slow part stood below it."""
    _, slow = split(level)
    known = slow.notna()
    over = (level >= bank) & known
    tide_only = over & (slow < bank)
    return {"hours_over": int(over.sum()), "tide_only": int(tide_only.sum()),
            "share_tide_only": None if not over.any() else round(float(tide_only.sum() / over.sum()), 2)}


def compare(model: pd.Series, gauge: pd.Series, bank: float | None) -> dict:
    """The tide check for one gauge against the model at its zone's tide point."""
    gauge = gauge.dropna()
    if gauge.index.tz is None:
        # The archive's clock times are Bangkok's.
        gauge.index = gauge.index.tz_localize("Asia/Bangkok").tz_convert("UTC")
    m_tide, m_slow = split(model)
    g_tide, g_slow = split(gauge)
    out = {
        "first": None if gauge.empty else str(gauge.index[0].date()),
        "hours": int(gauge.notna().sum()),
        "tidal": best_match(m_tide, g_tide),
        "slow": best_match(m_slow, g_slow, max_lag_h=24),
        "model_tidal_range_m": round(float(m_tide.quantile(0.95) - m_tide.quantile(0.05)), 2),
        "gauge_tidal_range_m": None if gauge.empty else round(float(g_tide.quantile(0.95) - g_tide.quantile(0.05)), 2),
    }
    if bank is not None:
        out["bank_m"] = bank
        out["over_bank"] = tide_over_bank(gauge, bank)
    return out


def verdict(row: dict) -> str:
    t = row.get("tidal") or {}
    r = t.get("r")
    if r is None:
        return "not enough data"
    if r >= 0.8:
        return "tidal, follows the model"
    if r >= 0.5:
        return "partly tidal"
    return "above the tide's reach"


def markdown(rows: list[dict]) -> str:
    lines = [
        "| Zone | Gauge | Hours | Tidal band: r, lag, spread ratio | Tidal range gauge / model (m) | Slow part: r, lag | Over bank: hours, by tide alone | Reading |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        t, s, o = row.get("tidal") or {}, row.get("slow") or {}, row.get("over_bank") or {}
        lines.append(
            f"| {row['zone']} | {row['code']} | {row['hours']} | "
            f"{t.get('r', '–')}, {t.get('lag_h', '–')} h, {t.get('spread_ratio', '–')} | "
            f"{row.get('gauge_tidal_range_m', '–')} / {row.get('model_tidal_range_m', '–')} | "
            f"{s.get('r', '–')}, {s.get('lag_h', '–')} h | "
            f"{o.get('hours_over', '–')}, {o.get('tide_only', '–')} | {verdict(row)} |")
    return "\n".join(lines) + "\n"
