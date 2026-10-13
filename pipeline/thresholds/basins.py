"""The land that drains to a point, from the flow directions the hazard module computed.

WhiteboxTools writes a D8 pointer as powers of two clockwise from north-east:

    64 128   1
    32   0   2
    16   8   4

A cell belongs to a catchment when following the pointers from it reaches the outlet. The trace
runs the other way: from the outlet, ring by ring, to every cell that points into the set.
"""

from __future__ import annotations

import numpy as np

# pointer value -> (row step, column step) the water takes
STEPS = {1: (-1, 1), 2: (0, 1), 4: (1, 1), 8: (1, 0), 16: (1, -1), 32: (0, -1), 64: (-1, -1), 128: (-1, 0)}


def snap(accum: np.ndarray, row: int, col: int, cells: int) -> tuple[int, int]:
    """The cell with the most water passing through it within `cells` of (row, col)."""
    r0, c0 = max(0, row - cells), max(0, col - cells)
    win = accum[r0:row + cells + 1, c0:col + cells + 1]
    r, c = np.unravel_index(int(np.nanargmax(win)), win.shape)
    return r0 + int(r), c0 + int(c)


def upstream(pointer: np.ndarray, row: int, col: int) -> np.ndarray:
    """Boolean mask of every cell that drains through (row, col), that cell included."""
    rows, cols = pointer.shape
    inside = np.zeros(pointer.shape, bool)
    inside[row, col] = True
    fr, fc = np.array([row]), np.array([col])
    while fr.size:
        nr, nc = [], []
        for value, (dr, dc) in STEPS.items():
            # a neighbour at (r - dr, c - dc) with this pointer flows into (r, c)
            r, c = fr - dr, fc - dc
            ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
            r, c = r[ok], c[ok]
            hit = (pointer[r, c] == value) & ~inside[r, c]
            r, c = r[hit], c[hit]
            inside[r, c] = True
            nr.append(r)
            nc.append(c)
        fr, fc = np.concatenate(nr), np.concatenate(nc)
    return inside


def outline(mask: np.ndarray, transform, crs: str, simplify_m: float = 200.0) -> dict:
    """The mask's largest piece as a GeoJSON geometry in longitude and latitude."""
    import shapely
    from rasterio import features
    from rasterio.warp import transform_geom

    r, c = np.nonzero(mask)
    r0, r1, c0, c1 = r.min(), r.max() + 1, c.min(), c.max() + 1
    sub = mask[r0:r1, c0:c1]
    from rasterio.transform import Affine

    t = transform * Affine.translation(c0, r0)
    shapes = [shapely.geometry.shape(g) for g, v in features.shapes(sub.astype("uint8"), mask=sub, transform=t) if v]
    geom = shapely.unary_union(shapes).buffer(0)
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    geom = shapely.Polygon(geom.exterior).simplify(simplify_m)
    return transform_geom(crs, "EPSG:4326", shapely.geometry.mapping(geom), precision=5)
