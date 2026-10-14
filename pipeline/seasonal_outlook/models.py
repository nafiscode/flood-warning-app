"""The seasonal forecast models (NMME, from NOAA CPC) against what the seasons brought.

Each model's forecast made at the start of October for November to January, as the mean over a few
1-degree cells around the four provinces, for the hindcast years and for this year. A forecast
"leans" dry, normal or wet when it falls in the dry, middle or wet third of that model's own other
years; it is scored against the third the observed season fell in, the same way. Thirds are always
taken without the season being scored (leave one out), so no forecast is graded with knowledge of
its own outcome.
"""

from __future__ import annotations

import re

import numpy as np

DRY, NORMAL, WET = 0, 1, 2
NAMES = {DRY: "dry", NORMAL: "normal", WET: "wet"}
_HEAD = re.compile(r"cpt:T=(\d{4})-(\d{2})")


def read_cpt(text: str, lons: list[float], lats: list[float]) -> dict[int, float]:
    """{season year: mean over the chosen cells} from a CPT text file (one field per season; a row of
    longitudes, then one row per latitude). Missing values are skipped; a season with none is left out."""
    out: dict[int, float] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = _HEAD.search(lines[i]) if lines[i].startswith("cpt:field") else None
        if not m:
            i += 1
            continue
        season = int(m.group(1))
        missing = float(re.search(r"cpt:missing=([-\d.]+)", lines[i]).group(1))
        nrow = int(re.search(r"cpt:nrow=(\d+)", lines[i]).group(1))
        cols = [float(v) for v in lines[i + 1].split()]
        want_cols = [cols.index(x) for x in lons]
        vals = []
        for row in lines[i + 2: i + 2 + nrow]:
            parts = row.split()
            if float(parts[0]) in lats:
                for c in want_cols:
                    v = float(parts[1 + c])
                    if v != missing:
                        vals.append(v)
        if vals:
            out[season] = float(np.mean(vals))
        i += 2 + nrow
    return out


def third_of(value: float, others: list[float]) -> int:
    lo, hi = np.percentile(np.asarray(others, dtype=float), [100 / 3, 200 / 3])
    return DRY if value < lo else WET if value > hi else NORMAL


def leave_one_out(series: dict[int, float], seasons: list[int]) -> dict[int, int]:
    """Each season's third among the other seasons of the same list."""
    return {s: third_of(series[s], [series[o] for o in seasons if o != s]) for s in seasons}


def score(forecast: dict[int, int], observed: dict[int, int]) -> dict:
    """Hit rate, the Heidke skill score (0 = no better than chance, 1 = perfect), and what happened
    when the forecast leaned dry or wet."""
    common = sorted(set(forecast) & set(observed))
    n = len(common)
    hits = sum(forecast[s] == observed[s] for s in common)
    expected = sum(sum(forecast[s] == k for s in common) * sum(observed[s] == k for s in common)
                   for k in NAMES) / n if n else 0
    table = {NAMES[f]: {NAMES[o]: sum(forecast[s] == f and observed[s] == o for s in common) for o in NAMES}
             for f in NAMES}
    return {"seasons": n, "hits": hits, "hit_rate_pct": round(100 * hits / n, 0) if n else None,
            "heidke": round((hits - expected) / (n - expected), 2) if n and n != expected else 0.0,
            "when_it_leaned": table}


def enso_lean(oni: float | None, limit: float = 0.5) -> int | None:
    """The Pacific alone: La Nina -> wet, El Nino -> dry, else normal (what the record of 45 seasons shows)."""
    if oni is None:
        return None
    return WET if oni <= -limit else DRY if oni >= limit else NORMAL


def odds(lean: int, forecast: dict[int, int], observed: dict[int, int]) -> dict:
    """What followed in past seasons when the method leaned this way, as odds for the three thirds,
    with one season added to each third so a small count never reads as certainty."""
    seasons = [s for s in forecast if forecast[s] == lean and s in observed]
    counts = {k: sum(observed[s] == k for s in seasons) for k in NAMES}
    total = len(seasons) + 3
    return {"lean": NAMES[lean], "past_seasons_with_this_lean": len(seasons),
            "counts": {NAMES[k]: counts[k] for k in NAMES},
            "odds_pct": {NAMES[k]: round(100 * (counts[k] + 1) / total) for k in NAMES}}
