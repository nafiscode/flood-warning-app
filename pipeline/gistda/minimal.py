"""The land GISTDA flags as flooded that Jaga's hazard map calls Minimal: where it is and why.

Minimal means two things at once: the cell is 2 m or more above its nearest stream (5 m in built-up
or unobserved land), and the radar flagged it in at most one season, under the frequency floor and
in neither priority event. This module collects every such cell that GISTDA flags and describes it.
"""

from __future__ import annotations

import numpy as np

HAND_BANDS = ((2.0, "under 2 m"), (5.0, "2 to 5 m"), (10.0, "5 to 10 m"), (np.inf, "10 m or more"))


def patches(rows: np.ndarray, cols: np.ndarray, width: int) -> np.ndarray:
    """A patch number for every cell: cells that touch, corners included, share one."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    key = rows.astype(np.int64) * width + cols
    order = np.argsort(key)
    sorted_key = key[order]
    a, b = [], []
    for dr, dc in ((0, 1), (1, -1), (1, 0), (1, 1)):
        ok = (cols + dc >= 0) & (cols + dc < width)
        want = (rows[ok] + dr).astype(np.int64) * width + cols[ok] + dc
        at = np.searchsorted(sorted_key, want)
        at[at == len(sorted_key)] = 0
        hit = sorted_key[at] == want
        a.append(np.flatnonzero(ok)[hit])
        b.append(order[at[hit]])
    a, b = np.concatenate(a), np.concatenate(b)
    n = len(key)
    return connected_components(coo_matrix((np.ones(len(a), dtype=np.uint8), (a, b)), shape=(n, n)), directed=False)[1]


def hand_band(hand: np.ndarray) -> np.ndarray:
    """Position in HAND_BANDS for every value; NaN (no height known) is len(HAND_BANDS)."""
    out = np.full(hand.shape, len(HAND_BANDS), dtype=np.uint8)
    known = ~np.isnan(hand)
    out[known] = np.searchsorted([b[0] for b in HAND_BANDS], hand[known], side="right")
    return out


def shares(labels: list[str], codes: np.ndarray, cell_km2: float, weight: np.ndarray | None = None) -> dict:
    """km2 (and, with `weight`, buildings) per label."""
    out = {}
    for i, label in enumerate(labels):
        m = codes == i
        row = {"km2": round(float(m.sum()) * cell_km2, 1)}
        if weight is not None:
            row["buildings"] = int(round(float(weight[m].sum())))
        out[label] = row
    return out
