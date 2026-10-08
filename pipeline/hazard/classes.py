"""Flood hazard classes on the 30 m hazard grid (plan approved 2026-10-09, docs/decisions.md).

  4 high      flooded often by radar: in at least `high.min_seasons` seasons, or in both priority events
  3 medium    meets the frequency floor (seasons or share of valid passes), or flooded in one priority event
  2 low       not flagged by radar, but low: HAND under `low.max_hand_m`
  1 minimal   the rest of the land
  0           outside the four provinces, or no elevation

Where the radar cannot see (built-up land, land under the radar's terrain mask) the class comes from
HAND alone: under `radar_blind.medium_max_hand_m` at least medium, under `radar_blind.low_max_hand_m` at
least low. A radar flag is still used where there is one. The second band says what a cell's class rests on:

  1 radar and elevation   2 elevation only: built-up   3 elevation only: masked for the radar or never observed

Every limit is a starting value in config.yaml. Nothing here is validated against observed floods
except the hold-out check (`score`).
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

log = logging.getLogger("hazard")
MINIMAL, LOW, MEDIUM, HIGH = 1, 2, 3, 4
RADAR, BUILT, UNSEEN = 1, 2, 3
NAMES = {HIGH: "high", MEDIUM: "medium", LOW: "low", MINIMAL: "minimal"}
BASIS_NAMES = {RADAR: "radar and elevation", BUILT: "elevation only: built-up", UNSEEN: "elevation only: not seen by radar"}


def box_mean(a: np.ndarray, cells: int) -> np.ndarray:
    """Mean over a square window of `cells` x `cells` (odd), edges padded with the edge value."""
    if cells <= 1:
        return a.astype("float32")
    pad = cells // 2
    p = np.pad(a.astype("float64"), pad, mode="edge")
    c = np.cumsum(np.cumsum(p, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = cells
    total = c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]
    return (total / (n * n)).astype("float32")


def classify(hand: np.ndarray, land: np.ndarray, seasons_flooded: np.ndarray, frequency: np.ndarray,
             events_flooded: np.ndarray, observed: np.ndarray, built: np.ndarray, rules: dict,
             n_events: int) -> tuple[np.ndarray, np.ndarray]:
    """(class, basis) per cell. `land` is where a class is given; `hand` may be NaN on land (then only
    the radar can raise the class). `events_flooded` counts the priority events with flood in the cell."""
    hi, med, low, blind = rules["high"], rules["medium"], rules["low"], rules["radar_blind"]
    known = np.nan_to_num(hand, nan=np.inf)
    radar_high = seasons_flooded >= hi["min_seasons"]
    if hi.get("all_events") and n_events >= 2:
        radar_high |= events_flooded >= n_events
    radar_medium = (seasons_flooded >= med["min_seasons"]) | (frequency > med["min_frequency"])
    if med.get("any_event"):
        radar_medium |= events_flooded >= 1
    cls = np.full(hand.shape, MINIMAL, dtype="uint8")
    cls[known < low["max_hand_m"]] = LOW
    unseen = ~observed
    by_elevation = built | unseen
    cls[by_elevation & (known < blind["low_max_hand_m"])] = LOW
    cls[by_elevation & (known < blind["medium_max_hand_m"])] = MEDIUM
    cls[radar_medium] = np.maximum(cls[radar_medium], MEDIUM)
    cls[radar_high] = HIGH
    basis = np.full(hand.shape, RADAR, dtype="uint8")
    basis[unseen] = UNSEEN
    basis[built] = BUILT
    cls[~land] = 0
    basis[~land] = 0
    return cls, basis


def on_grid(src_path: Path, band: int, dst_transform, dst_shape, dst_crs: str, resampling: Resampling,
            pick=None, dtype="uint8", src_nodata=None, fill=0) -> np.ndarray:
    """One band of a raster brought to the hazard grid. `pick` turns the source values into what is
    resampled (for example a 0/1 flood flag, so that `max` means "flooded anywhere in the cell")."""
    with rasterio.open(src_path) as src:
        data = src.read(band)
        if pick is not None:
            data = pick(data)
        out = np.full(dst_shape, fill, dtype=dtype)
        reproject(data, out, src_transform=src.transform, src_crs=src.crs, src_nodata=src_nodata,
                  dst_transform=dst_transform, dst_crs=dst_crs, dst_nodata=fill, resampling=resampling)
    return out


def areas(cls: np.ndarray, basis: np.ndarray, cell_km2: float, buildings: np.ndarray | None = None) -> dict:
    """km2 (and buildings) per class, and per class and basis."""
    out = {"classes": {}, "by_basis": {}}
    land = cls > 0
    total = float(land.sum()) * cell_km2
    for code, name in NAMES.items():
        m = cls == code
        row = {"km2": round(float(m.sum()) * cell_km2, 1), "pct": round(100 * float(m.sum()) * cell_km2 / max(total, 1e-9), 1)}
        if buildings is not None:
            row["buildings"] = int(round(float(buildings[m].sum())))
        out["classes"][name] = row
        out["by_basis"][name] = {b: round(float((m & (basis == k)).sum()) * cell_km2, 1) for k, b in BASIS_NAMES.items()}
    out["land_km2"] = round(total, 1)
    if buildings is not None:
        out["buildings"] = int(round(float(buildings[land].sum())))
    return out


def score(cls: np.ndarray, flood: np.ndarray, seen: np.ndarray) -> dict:
    """How a flood that was held out falls on the classes. `flood` and `seen` are on the hazard grid:
    flooded in the held-out event, and validly observed by it. Only observed land is scored."""
    out = {"flooded_cells": int((flood & seen & (cls > 0)).sum()), "classes": {}}
    total = max(out["flooded_cells"], 1)
    for code, name in NAMES.items():
        m = (cls == code) & seen
        f = int((m & flood).sum())
        out["classes"][name] = {"share_of_flood_pct": round(100 * f / total, 1),
                                "flooded_share_of_class_pct": round(100 * f / max(int(m.sum()), 1), 1)}
    warned = (cls >= MEDIUM) & seen
    hit, miss, false = int((warned & flood).sum()), int((~warned & flood & seen & (cls > 0)).sum()), int((warned & ~flood).sum())
    out["medium_or_high"] = {"hit_rate_pct": round(100 * hit / max(hit + miss, 1), 1),
                             "csi": round(hit / max(hit + miss + false, 1), 3)}
    return out
