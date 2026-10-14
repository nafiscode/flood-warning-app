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
                 spacing_cells: int, taken: list[tuple[int, int]] | None = None,
                 quota: dict[int, int] | None = None) -> list[tuple[int, int]]:
    """Up to `per_tambon` cells in every tambon from the cells where `ok`, heaviest `weight` first,
    no two closer than `spacing_cells`, and none that close to a cell already `taken`. Returns
    (row, col). With `quota` (tambon index -> how many it still needs) only those tambons are served,
    each with at most its quota."""
    rows, cols = np.nonzero(ok)
    return pick_cells(rows, cols, weight, tambon_index, per_tambon, spacing_cells, taken, quota)


def pick_cells(rows: np.ndarray, cols: np.ndarray, weight: np.ndarray, tambon_index: np.ndarray, per_tambon: int,
               spacing_cells: int, taken: list[tuple[int, int]] | None = None,
               quota: dict[int, int] | None = None) -> list[tuple[int, int]]:
    """`pick_parking` for cells given as (row, col) arrays rather than a mask over the whole grid
    (a road's points are a few thousand cells; a mask is a hundred million). The cells should be
    unique and in row-major order, which is the order `np.nonzero` gives, so that ties in weight fall
    the same way as in `pick_parking`."""
    rows, cols = np.asarray(rows, dtype="int64"), np.asarray(cols, dtype="int64")
    tambons = tambon_index[rows, cols].astype("int64") if len(rows) else np.zeros(0, dtype="int64")
    keep = tambons > 0
    if quota is not None:
        wanted = np.array([t for t, n in quota.items() if n > 0], dtype="int64")
        keep &= np.isin(tambons, wanted)
    rows, cols, tambons = rows[keep], cols[keep], tambons[keep]
    if len(rows) == 0:
        return []
    order = np.lexsort((-weight[rows, cols], tambons))
    rows, cols, tambons = rows[order], cols[order], tambons[order]
    taken_by: dict[int, list[tuple[int, int]]] = {}
    for tr, tc in taken or []:
        taken_by.setdefault(int(tambon_index[tr, tc]), []).append((tr, tc))
    picked: list[tuple[int, int]] = []
    start = 0
    for end in list(np.nonzero(np.diff(tambons))[0] + 1) + [len(tambons)]:
        tambon = int(tambons[start])
        most = per_tambon if quota is None else min(per_tambon, quota[tambon])
        mine: list[tuple[int, int]] = []
        near = taken_by.get(tambon, [])
        for r, c in zip(rows[start:end].tolist(), cols[start:end].tolist()):
            if len(mine) == most:
                break
            if all(max(abs(r - pr), abs(c - pc)) >= spacing_cells for pr, pc in mine + near):
                mine.append((r, c))
        picked += mine
        start = end
    return picked


def road_cells(ways: dict[str, np.ndarray], kinds: list[str], to_xy, transform, shape: tuple[int, int],
               land: np.ndarray, flooded: np.ndarray | None) -> tuple[np.ndarray, np.ndarray]:
    """The cells (row, col; unique, row-major) holding points of roads of the given OSM `kinds`, not
    on a bridge or in a tunnel, on land the radar did not see flooded. Embankment parking is picked
    from these: a raised road stays dry where the land beside it floods, but a stretch the radar saw
    under water was not high enough there. `flooded` None keeps flooded cells too (for counting)."""
    on = np.isin(ways["kind"], kinds)[ways["way_of_point"]] & ~ways["bridge"][ways["way_of_point"]]
    if not on.any():
        return np.zeros(0, dtype="int64"), np.zeros(0, dtype="int64")
    x, y = to_xy(ways["lon"][on], ways["lat"][on])
    rows, cols, inside = cell(transform, np.asarray(x), np.asarray(y), shape)
    flat = np.unique(rows[inside] * shape[1] + cols[inside])
    rows, cols = flat // shape[1], flat % shape[1]
    keep = land[rows, cols] if flooded is None else land[rows, cols] & ~flooded[rows, cols]
    return rows[keep], cols[keep]
