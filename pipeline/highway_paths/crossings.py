"""Where the land's natural drainage crosses a highway, and whether an opening is mapped there.

The flow directions are the hazard module's D8 pointer on the 30 m elevation model with the mapped
rivers burned in. A 30 m model smooths a 2 m embankment away, so these paths are where water would
cross if the road were not there: exactly the places a road needs an opening. A crossing is a step
from a cell to its downstream neighbour that passes from one side of the highway line to the other,
with at least `min_catchment_km2` of land upstream.

Openings are what OpenStreetMap maps: the highway's own bridges, anything tagged as a culvert, and
waterways drawn passing the road (water has a way through there, of unknown size). Culverts are
mostly not mapped here, so "no mapped opening" is a question for the ground, not a finding.
"""

from __future__ import annotations

import numpy as np

# WhiteboxTools D8 pointer: code -> (column step, row step). Rows grow southwards.
D8 = {1: (1, -1), 2: (1, 0), 4: (1, 1), 8: (0, 1), 16: (-1, 1), 32: (-1, 0), 64: (-1, -1), 128: (0, -1)}


def steps(codes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(column step, row step, valid) for an array of D8 codes; 0 / nodata are not valid."""
    dc = np.zeros(codes.shape, dtype="int64")
    dr = np.zeros(codes.shape, dtype="int64")
    ok = np.zeros(codes.shape, dtype=bool)
    for code, (c, r) in D8.items():
        hit = codes == code
        dc[hit], dr[hit], ok[hit] = c, r, True
    return dc, dr, ok


def flow_vectors(codes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit flow direction (east, north) of each D8 code; (0, 0) where there is none."""
    dc, dr, ok = steps(codes)
    east, north = dc.astype("float64"), -dr.astype("float64")
    length = np.hypot(east, north)
    length[~ok] = 1.0
    return east / length, north / length


def find(cx: np.ndarray, cy: np.ndarray, dx: np.ndarray, dy: np.ndarray, line_tree, line_xy: np.ndarray,
         line_tangent: np.ndarray, near_line_m: float, on_line_m: float = 12.0):
    """Flow steps (from (cx, cy) to (dx, dy)) that cross a highway line. Returns (index of the step,
    crossing x, crossing y, index of the densified line point it crosses at, side the water comes
    from: 0 left of the line's direction, 1 right)."""
    if len(cx) == 0:
        empty = np.zeros(0, dtype="int64")
        return empty, np.zeros(0), np.zeros(0), empty, empty
    start = np.column_stack([cx, cy])
    d, i = line_tree.query(start, k=1, distance_upper_bound=near_line_m)
    near = np.isfinite(d)
    idx = np.nonzero(near)[0]
    i = i[near]
    p, t = line_xy[i], line_tangent[i]
    n = np.column_stack([-t[:, 1], t[:, 0]])
    s_from = ((start[idx] - p) * n).sum(axis=1)
    end = np.column_stack([dx[idx], dy[idx]])
    s_to = ((end - p) * n).sum(axis=1)
    cross = (s_from * s_to) < 0
    idx, s_from, s_to, end = idx[cross], s_from[cross], s_to[cross], end[cross]
    frac = s_from / (s_from - s_to)
    point = start[idx] + frac[:, None] * (end - start[idx])
    d2, i2 = line_tree.query(point, k=1)
    real = d2 <= on_line_m           # the step crosses the line itself, not its extension past an end
    side = np.where(s_from[real] > 0, 0, 1)
    return idx[real], point[real, 0], point[real, 1], i2[real], side


def trace(codes: np.ndarray, row: int, col: int, steps_max: int) -> list[tuple[int, int]]:
    """The D8 path from (row, col) in the window `codes`, at most `steps_max` steps, stopping at the
    window's edge or where the flow ends."""
    path = []
    for _ in range(steps_max):
        if not (0 <= row < codes.shape[0] and 0 <= col < codes.shape[1]):
            break
        step = D8.get(int(codes[row, col]))
        if step is None:
            break
        col, row = col + step[0], row + step[1]
        path.append((row, col))
    return path


def recrosses(path_xy: np.ndarray, line_tree, line_xy: np.ndarray, line_tangent: np.ndarray, line_owner: np.ndarray,
              owner: int, from_side: int, near_line_m: float) -> bool:
    """True when a flow path that has just crossed a line (from `from_side`) comes back to that side
    of the same line within `near_line_m` of it: a stream running along the road, zigzagging across it
    on a 30 m model, not a stream passing under it."""
    if len(path_xy) == 0:
        return False
    d, i = line_tree.query(path_xy, k=1)
    for dist, j, p in zip(d, i, path_xy):
        if dist > near_line_m or line_owner[j] != owner:
            continue
        n = np.array([-line_tangent[j][1], line_tangent[j][0]])
        s = float((p - line_xy[j]) @ n)
        if (s > 0 and from_side == 0) or (s < 0 and from_side == 1):
            return True
    return False


def cluster(owner: np.ndarray, x: np.ndarray, y: np.ndarray, weight: np.ndarray, radius_m: float) -> np.ndarray:
    """Indices of the crossings kept when several of the same owner (section) lie within `radius_m`
    of each other: the largest `weight` (catchment) of each group. A stream wandering along a road
    crosses it several times in a few cells; that is one crossing."""
    keep = []
    order = np.lexsort((-weight, owner))
    taken = np.zeros(len(x), dtype=bool)
    for k in order:
        if taken[k]:
            continue
        keep.append(k)
        same = (owner == owner[k]) & (np.hypot(x - x[k], y - y[k]) <= radius_m)
        taken |= same
    return np.array(sorted(keep), dtype="int64")


def waterway_crossings(waterways: list[np.ndarray], chain_lines: list[np.ndarray]) -> np.ndarray:
    """Points (x, y) where a mapped waterway line crosses a highway line, both given as (n, 2)
    arrays in metres."""
    import shapely
    from shapely import STRtree

    if not waterways or not chain_lines:
        return np.zeros((0, 2))
    roads = [shapely.LineString(c) for c in chain_lines]
    tree = STRtree(roads)
    out = []
    for w in waterways:
        if len(w) < 2:
            continue
        line = shapely.LineString(w)
        for j in tree.query(line, predicate="intersects"):
            hit = line.intersection(roads[j])
            for g in getattr(hit, "geoms", [hit]):
                if g.is_empty:
                    continue
                c = g.centroid if g.geom_type != "Point" else g
                out.append((c.x, c.y))
    return np.array(out) if out else np.zeros((0, 2))
