"""What the terrain and the radar say about a site, and where high ground for cars is.

Everything is read on the hazard grid (30 m, UTM 47N), so a site's values are those of its cell.
Heights are FABDEM's, whose error of a metre or more can decide a ranking on a flat plain: that is
why every site stays unverified until somebody has stood there (science plan, Module 2).
"""

from __future__ import annotations

import numpy as np


def cell(transform, x: np.ndarray, y: np.ndarray, shape: tuple[int, int]):
    """(row, col, inside) of points on the grid."""
    col = np.floor((x - transform.c) / transform.a).astype("int64")
    row = np.floor((y - transform.f) / transform.e).astype("int64")
    inside = (row >= 0) & (row < shape[0]) & (col >= 0) & (col < shape[1])
    return row, col, inside


def sample(raster: np.ndarray, row, col, inside, fill=np.nan) -> np.ndarray:
    out = np.full(len(row), fill, dtype="float64")
    out[inside] = raster[row[inside], col[inside]]
    return out


def flood_edge(flood: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Flooded cells with a dry land cell beside them (up, down, left or right): the water's edge,
    where the ground height is the height of the water."""
    dry = land & ~flood
    beside = np.zeros_like(flood)
    beside[1:, :] |= dry[:-1, :]
    beside[:-1, :] |= dry[1:, :]
    beside[:, 1:] |= dry[:, :-1]
    beside[:, :-1] |= dry[:, 1:]
    return flood & beside


def water_surface(edge_xy: np.ndarray, edge_height: np.ndarray, points: np.ndarray, k: int, max_m: float) -> np.ndarray:
    """The flood's water surface near each point: the median height of the `k` nearest edge cells
    within `max_m`. NaN where no edge is that close."""
    from scipy.spatial import cKDTree

    if len(edge_xy) == 0:
        return np.full(len(points), np.nan)
    k = min(k, len(edge_xy))
    d, i = cKDTree(edge_xy).query(points, k=k, distance_upper_bound=max_m)
    d, i = d.reshape(len(points), -1), i.reshape(len(points), -1)
    heights = np.where(np.isfinite(d), edge_height[np.minimum(i, len(edge_height) - 1)], np.nan)
    with np.errstate(all="ignore"):
        return np.nanmedian(heights, axis=1)


def keep_patches(mask: np.ndarray, min_cells: int) -> np.ndarray:
    """The mask without its patches smaller than `min_cells` (cells joined by a side or a corner)."""
    from scipy import ndimage

    if min_cells <= 1:
        return mask
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))
    if n == 0:
        return mask
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return (sizes >= min_cells)[labels]


def freeboard(hand: np.ndarray, stage: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(metres, basis). Both inputs are heights above the nearest stream: the site's, and the nearby
    flood's (`stage`, from the water's edge). Where a flood edge is near, freeboard is the site minus
    the stage; where none is, it is the site's height above the stream itself, and the row says so.

    Working in height above the stream rather than in height above sea level is what keeps this
    sane in hills: the water's edge two kilometres up a valley is metres higher above the sea than
    the same flood here, but about as high above its own stream."""
    known = np.isfinite(hand)
    by_edge = known & np.isfinite(stage)
    value = np.where(by_edge, hand - stage, hand)
    basis = np.where(by_edge, "flood_edge", np.where(known, "stream", "unknown"))
    return value, basis


def box_sum(a: np.ndarray, radius_cells: int) -> np.ndarray:
    """Sum over the square of side 2 * radius + 1 around every cell."""
    n = 2 * radius_cells + 1
    p = np.pad(np.nan_to_num(a.astype("float64")), radius_cells)
    c = np.pad(np.cumsum(np.cumsum(p, axis=0), axis=1), ((1, 0), (1, 0)))
    return c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]


def pick_parking(ok: np.ndarray, weight: np.ndarray, tambon_index: np.ndarray, per_tambon: int,
                 spacing_cells: int) -> list[tuple[int, int]]:
    """Up to `per_tambon` cells in every tambon from the cells where `ok`, heaviest `weight` first,
    no two closer than `spacing_cells`. Returns (row, col)."""
    rows, cols = np.nonzero(ok & (tambon_index > 0))
    if len(rows) == 0:
        return []
    order = np.lexsort((-weight[rows, cols], tambon_index[rows, cols]))
    rows, cols, tambons = rows[order], cols[order], tambon_index[rows, cols][order]
    picked: list[tuple[int, int]] = []
    start = 0
    for end in list(np.nonzero(np.diff(tambons))[0] + 1) + [len(tambons)]:
        mine: list[tuple[int, int]] = []
        for r, c in zip(rows[start:end].tolist(), cols[start:end].tolist()):
            if all(max(abs(r - pr), abs(c - pc)) >= spacing_cells for pr, pc in mine):
                mine.append((r, c))
                if len(mine) == per_tambon:
                    break
        picked += mine
        start = end
    return picked
