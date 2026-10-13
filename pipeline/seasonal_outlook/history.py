"""What the past seasons say: how wet each flood season was, how that went with the state of the
Pacific beforehand, and whether there is a trend. Pure functions over small tables.

A season is named by the year it starts in and runs November to January. Rain comes as five-day
totals (CHIRPS pentads), so "the wettest five days" is the largest pentad of the season.
"""

from __future__ import annotations

import numpy as np

SEASON_MONTHS = (11, 12, 1)
PHASES = ("la_nina", "neutral", "el_nino")


def season_of(year: int, month: int) -> int | None:
    """The season a month belongs to, or None outside November to January."""
    if month in (11, 12):
        return year
    if month == 1:
        return year - 1
    return None


def seasons(pentads: list[dict], complete: int = 18) -> dict[int, dict]:
    """{season: {total_mm, peak_5d_mm, peak_15d_mm, pentads}} from rows {year, month, pentad, mm}.
    A season with fewer than `complete` pentads (six a month) is marked incomplete."""
    by: dict[int, list[tuple[int, float]]] = {}
    for row in pentads:
        s = season_of(row["year"], row["month"])
        if s is None or row["mm"] is None:
            continue
        order = (0 if row["month"] == 11 else 1 if row["month"] == 12 else 2) * 6 + row["pentad"]
        by.setdefault(s, []).append((order, float(row["mm"])))
    out = {}
    for s, rows in sorted(by.items()):
        mm = np.array([v for _, v in sorted(rows)])
        run3 = np.convolve(mm, np.ones(3), mode="valid") if len(mm) >= 3 else mm
        out[s] = {"total_mm": round(float(mm.sum()), 1), "peak_5d_mm": round(float(mm.max()), 1),
                  "peak_15d_mm": round(float(run3.max()), 1), "pentads": len(mm), "complete": len(mm) >= complete}
    return out


def parse_oni(text: str) -> dict[tuple[str, int], float]:
    """NOAA's oni.ascii.txt -> {(three-month label, year of the middle... as printed): anomaly}."""
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0].isalpha() and parts[1].isdigit():
            out[(parts[0], int(parts[1]))] = float(parts[3])
    return out


def phase(oni: float | None, limit: float = 0.5) -> str | None:
    if oni is None:
        return None
    return "la_nina" if oni <= -limit else "el_nino" if oni >= limit else "neutral"


def terciles(values: list[float]) -> tuple[float, float]:
    lo, hi = np.percentile(np.array(values, dtype=float), [100 / 3, 200 / 3])
    return float(lo), float(hi)


def rank_of(value: float, values: list[float]) -> int:
    """1 = the largest."""
    return int(sum(v > value for v in values)) + 1


def by_phase(rows: list[dict], key: str, upper: float, lower: float) -> dict:
    """Per ENSO phase: how many seasons, how many in the wet third and the dry third, the median."""
    out = {}
    for p in PHASES:
        vals = [r[key] for r in rows if r["phase"] == p]
        out[p] = {"seasons": len(vals), "wet_third": int(sum(v > upper for v in vals)),
                  "dry_third": int(sum(v < lower for v in vals)),
                  "median": round(float(np.median(vals)), 1) if vals else None}
    return out


def association(x: list[float], y: list[float], shuffles: int = 5000, seed: int = 1) -> dict:
    """Rank correlation with a p-value from shuffling: how often chance alone does as well."""
    from scipy import stats

    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    r = float(stats.spearmanr(x, y).statistic)
    rng = np.random.default_rng(seed)
    hits = sum(abs(float(stats.spearmanr(x, rng.permutation(y)).statistic)) >= abs(r) for _ in range(shuffles))
    return {"n": int(len(x)), "spearman": round(r, 2), "p": round((hits + 1) / (shuffles + 1), 3),
            "share_of_variance_pct": round(100 * r * r, 0)}


def trend(years: list[int], values: list[float]) -> dict:
    """Theil-Sen slope per decade with its 95% range, and the Mann-Kendall p-value."""
    from scipy import stats

    slope, _, lo, hi = stats.theilslopes(values, years, 0.95)
    tau = stats.kendalltau(years, values)
    mean = float(np.mean(values))
    return {"per_decade": round(float(slope) * 10, 1), "low": round(float(lo) * 10, 1), "high": round(float(hi) * 10, 1),
            "per_decade_pct_of_mean": round(100 * float(slope) * 10 / mean, 1), "p": round(float(tau.pvalue), 3)}
