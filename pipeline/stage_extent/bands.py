"""From the calibrated model to what the app reads: for each cell, the first gauge stage (on a
0.25 m step) at which it is under water, and a table of area and buildings per stage."""

from __future__ import annotations

import math

import numpy as np


def steps(bank_m: float, record_m: float, step_m: float, below_bank_m: float, above_record_m: float) -> np.ndarray:
    """Stage steps from bank - `below_bank_m` (rounded down) to the record + `above_record_m` (rounded up)."""
    lo = math.floor(round((bank_m - below_bank_m) / step_m, 6)) * step_m
    hi = math.ceil(round((record_m + above_record_m) / step_m, 6)) * step_m
    return np.round(np.arange(lo, hi + step_m / 2, step_m), 4)


def band_index(height: np.ndarray, z0: float, stage_steps: np.ndarray) -> np.ndarray:
    """1-based index of the first step s with s > height + z0 (the cell is wet when h < s - z0); 0 for a
    cell that stays dry up to the highest step or is outside the reach (NaN). Cells already wet at
    the lowest step get 1."""
    wet_from = np.where(np.isfinite(height), height + z0, np.inf)
    k = np.searchsorted(stage_steps, wet_from, side="right")
    return np.where(k < len(stage_steps), k + 1, 0).astype("uint8")


def lookup(index: np.ndarray, stage_steps: np.ndarray, cell_km2: float, buildings: np.ndarray | None) -> list[dict]:
    """For each step: the area under water at that stage (the cells with index <= its own) and the
    buildings on it."""
    rows = []
    valid = index > 0
    counts = np.bincount(index[valid], minlength=len(stage_steps) + 1)
    b_counts = (np.bincount(index[valid], weights=np.nan_to_num(buildings[valid]), minlength=len(stage_steps) + 1)
                if buildings is not None else None)
    area = 0.0
    bsum = 0.0
    for k, s in enumerate(stage_steps, start=1):
        area += counts[k] * cell_km2
        row = {"stage_m": float(s), "area_km2": round(area, 3)}
        if b_counts is not None:
            bsum += b_counts[k]
            row["buildings"] = int(round(bsum))
        rows.append(row)
    return rows
