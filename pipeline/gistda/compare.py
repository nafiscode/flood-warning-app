"""GISTDA's repeated-flood polygons against Jaga's radar seasons and hazard classes.

Their layer says, per polygon, in which calendar years it was flooded. It is burned onto Jaga's
grid as one number per cell whose bits are the years, and everything else is counting.
Agreement between two satellite readings means they are consistent, not that either is right.
"""

from __future__ import annotations

import numpy as np

DRY, VV, VH, BOTH, MASKED, WATER, NO_DATA = 0, 1, 2, 3, 250, 251, 255   # sar_floods `extent` codes


def bit(year: int, first: int) -> int:
    return 1 << (year - first)


def year_bits(props: dict, first: int, last: int) -> int:
    """The years a polygon is flagged in, as bits (bit 0 = `first`)."""
    out = 0
    for y in range(first, last + 1):
        if props.get(f"y_{y}"):
            out |= bit(y, first)
    return out


def burn(grid: np.ndarray, transform, features: list[dict], to_grid, first: int, last: int) -> int:
    """Burn one page of features into `grid` (uint16 year bits, cell-centre rule), touching only
    the window the page covers. Cells keep the years of every polygon that covers them.
    `to_grid(lon, lat) -> (x, y)` projects to the grid's coordinates. Returns polygons burned."""
    import shapely
    from rasterio import features as rio_features
    from rasterio.windows import Window, transform as window_transform

    geoms, values = [], []
    for f in features:
        v = year_bits(f.get("properties") or {}, first, last)
        if v and f.get("geometry"):
            geoms.append(shapely.geometry.shape(f["geometry"]))
            values.append(v)
    if not geoms:
        return 0
    geoms = shapely.transform(np.array(geoms, dtype=object), lambda x, y: to_grid(x, y), interleaved=False)
    w, s, e, n = shapely.total_bounds(geoms)
    cell_x, cell_y = transform.a, -transform.e
    c0 = max(int(np.floor((w - transform.c) / cell_x)), 0)
    c1 = min(int(np.ceil((e - transform.c) / cell_x)), grid.shape[1])
    r0 = max(int(np.floor((transform.f - n) / cell_y)), 0)
    r1 = min(int(np.ceil((transform.f - s) / cell_y)), grid.shape[0])
    if r1 <= r0 or c1 <= c0:
        return 0
    t = window_transform(Window(c0, r0, c1 - c0, r1 - r0), transform)
    part = grid[r0:r1, c0:c1]
    # Polygons that share a year pattern are burned together; patterns are OR-ed, so two
    # polygons over one cell both count.
    values = np.array(values)
    for v in np.unique(values):
        mask = rio_features.rasterize(((g, 1) for g in geoms[values == v]), out_shape=part.shape, transform=t,
                                      fill=0, dtype="uint8").astype(bool)
        part[mask] |= np.uint16(v)
    return len(values)


def count_years(bits: np.ndarray, first: int, year_from: int, year_to: int) -> np.ndarray:
    """How many of the years year_from..year_to are set in each cell."""
    out = np.zeros(bits.shape, dtype=np.uint8)
    for y in range(year_from, year_to + 1):
        out += ((bits >> (y - first)) & 1).astype(np.uint8)
    return out


def near(mask: np.ndarray, cells: int) -> np.ndarray:
    """`mask` grown by `cells` cells in every direction (a square neighbourhood)."""
    from scipy import ndimage

    if cells <= 0:
        return mask
    return ndimage.maximum_filter(mask.astype(np.uint8), size=2 * cells + 1, mode="constant").astype(bool)


def agreement(ours: int, theirs: int, both: int, cell_km2: float, ours_near: int | None = None,
              theirs_near: int | None = None) -> dict:
    """Areas and rates from cell counts. `ours` and `theirs` are the totals each map floods among
    the scored cells, `both` their overlap; the `_near` counts are the cells of one map within
    the tolerance of the other."""
    def pct(a, b):
        return round(100 * a / b, 1) if b else None

    out = {"ours_km2": round(ours * cell_km2, 1), "theirs_km2": round(theirs * cell_km2, 1),
           "both_km2": round(both * cell_km2, 1),
           "theirs_also_ours_pct": pct(both, theirs), "ours_also_theirs_pct": pct(both, ours),
           "csi": round(both / (ours + theirs - both), 3) if ours + theirs - both else None}
    if ours_near is not None:
        out["ours_near_theirs_pct"] = pct(ours_near, ours)
    if theirs_near is not None:
        out["theirs_near_ours_pct"] = pct(theirs_near, theirs)
    return out


def cross(a: np.ndarray, b: np.ndarray, where: np.ndarray, na: int, nb: int) -> np.ndarray:
    """na x nb table of cell counts: a's value down, b's value across, over the cells in `where`."""
    flat = a[where].astype(np.int64) * nb + b[where].astype(np.int64)
    return np.bincount(flat, minlength=na * nb).reshape(na, nb)
