"""The reach of a gauge: a stretch of main stem and the land that drains onto it, with each cell's
height above the main-stem cell its flow path reaches.

The D8 pointer is WhiteboxTools' (powers of two clockwise from north-east, as in thresholds/basins.py).
Everything here works on a window of the 30 m grid around one gauge, never on the whole grid.
"""

from __future__ import annotations

import math

import numpy as np

from hazard.hand import NODATA, hand_from_flow
from thresholds.basins import STEPS


def step_length(code: int, cell_m: float) -> float:
    dr, dc = STEPS[int(code)]
    return cell_m * (math.sqrt(2.0) if dr and dc else 1.0)


def downstream(pointer: np.ndarray, row: int, col: int, length_m: float, cell_m: float) -> list[tuple[int, int, float]]:
    """(row, col, km from the start) down the pointers from (row, col), the start included, until
    `length_m` is passed, the window ends or the path stops (no pointer, or a loop)."""
    rows, cols = pointer.shape
    out = [(row, col, 0.0)]
    seen = {(row, col)}
    dist = 0.0
    r, c = row, col
    while dist < length_m:
        code = int(pointer[r, c])
        if code not in STEPS:
            break
        dr, dc = STEPS[code]
        nr, nc = r + dr, c + dc
        if not (0 <= nr < rows and 0 <= nc < cols) or (nr, nc) in seen:
            break
        dist += step_length(code, cell_m)
        r, c = nr, nc
        seen.add((r, c))
        out.append((r, c, dist / 1000.0))
    return out


def upstream_main(pointer: np.ndarray, accum: np.ndarray, row: int, col: int, length_m: float,
                  cell_m: float) -> list[tuple[int, int, float]]:
    """(row, col, km above the start) up the main stem: at each cell, the neighbour that drains into
    it with the most water passing through it. The start is not included."""
    rows, cols = pointer.shape
    out: list[tuple[int, int, float]] = []
    dist = 0.0
    r, c = row, col
    seen = {(row, col)}
    while dist < length_m:
        best, best_acc = None, -1.0
        for code, (dr, dc) in STEPS.items():
            nr, nc = r - dr, c - dc                     # a neighbour with this pointer flows into (r, c)
            if 0 <= nr < rows and 0 <= nc < cols and int(pointer[nr, nc]) == code and (nr, nc) not in seen:
                a = float(accum[nr, nc])
                if a > best_acc:
                    best, best_acc = (nr, nc, code), a
        if best is None:
            break
        r, c, code = best
        dist += step_length(code, cell_m)
        seen.add((r, c))
        out.append((r, c, dist / 1000.0))
    return out


def stem(pointer: np.ndarray, accum: np.ndarray, row: int, col: int, up_m: float, down_m: float,
         cell_m: float) -> tuple[np.ndarray, list[tuple[int, int, float]]]:
    """Mask of the main stem from `up_m` above (row, col) to `down_m` below it, and its cells as
    (row, col, signed km: negative upstream, positive downstream)."""
    down = downstream(pointer, row, col, down_m, cell_m)
    up = upstream_main(pointer, accum, row, col, up_m, cell_m)
    mask = np.zeros(pointer.shape, dtype=bool)
    cells = [(r, c, -km) for r, c, km in reversed(up)] + down
    for r, c, _ in cells:
        mask[r, c] = True
    return mask, cells


def height_above_stem(pointer: np.ndarray, stem_mask: np.ndarray, surface: np.ndarray) -> np.ndarray:
    """Each cell's height above the main-stem cell its flow path reaches first (NaN where the path
    leaves the window or ends elsewhere). This is the hazard module's HAND with the main stem as the
    only stream: tributaries are crossed, not stopped at."""
    h = hand_from_flow(pointer, stem_mask, surface, np.zeros(surface.shape, dtype=bool))
    return np.where(h == NODATA, np.nan, h).astype("float32")


def reach_height(hand: np.ndarray, above_stem: np.ndarray, allowance_m: float = 0.0) -> np.ndarray:
    """The height h a cell must be flooded to, from the reach's river: the larger of its HAND (to
    whichever stream it drains to) and its height above the main stem less `allowance_m`. The cell
    is wet at depth d when h < d, i.e. when it is less than d above its own stream AND less than
    d + allowance above the main river where its path joins it. Where a cell drains straight onto
    the main stem the two heights are the same; up a tributary the second grows, so the tributary's
    floodplain is wet only as far as the main river's water can back up into it, plus the
    allowance for the tributary's own water (METHODS.md "The height"). NaN outside the reach."""
    hand = np.where(np.isfinite(hand) & (hand != NODATA), hand, np.nan)
    out = np.fmax(hand, above_stem - allowance_m)
    return np.where(np.isfinite(above_stem), out, np.nan).astype("float32")


def built_up(presence: np.ndarray, window_cells: int, min_presence: float) -> np.ndarray:
    """Built-up cells: mean building presence over a square of `window_cells` at least `min_presence`."""
    from scipy import ndimage

    mean = ndimage.uniform_filter(np.nan_to_num(presence.astype("float32")), size=window_cells, mode="nearest")
    return mean >= min_presence
