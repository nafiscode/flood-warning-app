"""The highway lines: joined into long lines, cut into sections, and the land on each side of them.

Everything is in metres on the hazard grid's coordinates (UTM 47N). OpenStreetMap splits a road into
many ways (at every bridge, every change of lanes or name), so ways that meet end to end, and only
two at that node, are joined before cutting; a section then runs across bridges instead of stopping
at them.

The land beside a section is sampled with points on a regular pattern: every `step_m` along the
line, and every `step_m` across it from `near_m` to `far_m` on each side. A point is kept only when
the nearest highway to it is its own line (so a strip never reaches across another highway, a link
road or the other carriageway) and it is at least `near_m` from it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def load_ways(paths, kinds: list[str]) -> dict[str, np.ndarray]:
    """The ways of the road cache whose highway class is in `kinds`, each way once (a way crossing a
    tile edge is in both tiles). Same arrays as `safe_places.roads.load_tiles`, without loading the
    rest of the network."""
    seen: set[int] = set()
    parts = {k: [] for k in ("way_id", "kind", "bridge", "count", "node", "lon", "lat")}
    for path in paths:
        t = np.load(path)
        new = np.array([w not in seen and k in kinds for w, k in zip(t["way_id"].tolist(), t["kind"].tolist())], dtype=bool)
        seen.update(t["way_id"][new].tolist())
        counts = np.diff(t["start"])
        keep_points = np.repeat(new, counts)
        parts["way_id"].append(t["way_id"][new])
        parts["kind"].append(t["kind"][new])
        parts["bridge"].append(t["bridge"][new])
        parts["count"].append(counts[new])
        for k in ("node", "lon", "lat"):
            parts[k].append(t[k][keep_points])
    return {k: np.concatenate(v) if v else np.array([]) for k, v in parts.items()}


@dataclass
class Chain:
    """A joined line: its points (x, y metres), and per segment the way it came from."""
    xy: np.ndarray            # (n, 2)
    way: np.ndarray           # (n - 1,) index of the way of each segment
    bridge: np.ndarray        # (n - 1,) the segment is on a bridge (or in a tunnel)


def join_ways(starts: list[int], ends: list[int]) -> list[list[tuple[int, bool]]]:
    """Ways (given by their first and last node ids) joined end to end where exactly two ways meet at
    a node. Returns chains as lists of (way index, reversed). Every way is in exactly one chain; a
    ring is cut where it was entered."""
    n = len(starts)
    at: dict[int, list[int]] = {}
    for i in range(n):
        at.setdefault(starts[i], []).append(i)
        at.setdefault(ends[i], []).append(i)

    def other(node: int, i: int) -> int | None:
        ws = at.get(node, [])
        if len(ws) != 2 or ws[0] == ws[1]:
            return None
        return ws[1] if ws[0] == i else ws[0]

    used = np.zeros(n, dtype=bool)
    chains = []
    # Start from ways with a free end first, so that lines are entered at an end, not in the middle.
    order = sorted(range(n), key=lambda i: (other(starts[i], i) is not None and other(ends[i], i) is not None))
    for first in order:
        if used[first]:
            continue
        used[first] = True
        chain = [(first, False)]
        # Walk backwards from the start, then forwards from the end.
        for forward in (False, True):
            i, rev = first, False
            node = ends[i] if forward else starts[i]
            while True:
                j = other(node, i)
                if j is None or used[j]:
                    break
                used[j] = True
                # Forward: j must leave from `node`; backward: j must arrive at `node`.
                if forward:
                    rev_j = ends[j] == node and starts[j] != node
                    chain.append((j, rev_j))
                    node = starts[j] if rev_j else ends[j]
                else:
                    rev_j = starts[j] == node and ends[j] != node
                    chain.insert(0, (j, rev_j))
                    node = ends[j] if rev_j else starts[j]
                i = j
        chains.append(chain)
    return chains


def build_chains(ways: dict, keep: np.ndarray, x: np.ndarray, y: np.ndarray) -> list[Chain]:
    """Chains from the ways of `safe_places.roads.load_tiles` selected by `keep` (a mask over ways);
    `x`, `y` are the projected positions of every point of `ways`."""
    bounds = np.concatenate([[0], np.cumsum(ways["count"].astype("int64"))])
    idx = np.nonzero(keep)[0]
    starts = [int(ways["node"][bounds[i]]) for i in idx]
    ends = [int(ways["node"][bounds[i + 1] - 1]) for i in idx]
    out = []
    for chain in join_ways(starts, ends):
        pts, way, bridge = [], [], []
        for k, (local, rev) in enumerate(chain):
            i = idx[local]
            seg = np.column_stack([x[bounds[i]:bounds[i + 1]], y[bounds[i]:bounds[i + 1]]])
            if rev:
                seg = seg[::-1]
            if k > 0:
                seg = seg[1:]                     # the shared node is already there
            pts.append(seg)
            way += [i] * len(seg)
            bridge += [bool(ways["bridge"][i])] * len(seg)
        xy = np.concatenate(pts)
        # `way` was filled per point; a segment takes the way of its end point (the first segment of
        # a chain belongs to the first way).
        way_arr = np.array(way[1:] if len(way) > 1 else way, dtype="int64")
        bridge_arr = np.array(bridge[1:] if len(bridge) > 1 else bridge, dtype=bool)
        keep_pts = np.ones(len(xy), dtype=bool)
        keep_pts[1:] = np.hypot(*(xy[1:] - xy[:-1]).T) > 0.01      # drop repeated points
        if keep_pts.sum() < 2:
            continue
        seg_keep = keep_pts[1:]
        out.append(Chain(xy=xy[keep_pts], way=way_arr[seg_keep], bridge=bridge_arr[seg_keep]))
    return out


def along(xy: np.ndarray) -> np.ndarray:
    """Distance from the start at every point."""
    return np.concatenate([[0.0], np.cumsum(np.hypot(*(xy[1:] - xy[:-1]).T))])


def cut_points(length: float, section_m: float, min_section_m: float) -> np.ndarray:
    """Where a line of `length` is cut: every `section_m`, the last piece joined to the one before
    it when it is shorter than `min_section_m`. Includes 0 and `length`."""
    if length <= section_m:
        return np.array([0.0, length])
    cuts = list(np.arange(0.0, length, section_m))
    if length - cuts[-1] < min_section_m and len(cuts) > 1:
        cuts.pop()
    return np.array(cuts + [length])


def interpolate(xy: np.ndarray, dist: np.ndarray, at: np.ndarray) -> np.ndarray:
    return np.column_stack([np.interp(at, dist, xy[:, 0]), np.interp(at, dist, xy[:, 1])])


def piece(xy: np.ndarray, dist: np.ndarray, a: float, b: float) -> np.ndarray:
    """The line between distances a and b, with its own vertices in between."""
    inner = (dist > a) & (dist < b)
    return np.concatenate([interpolate(xy, dist, np.array([a])), xy[inner], interpolate(xy, dist, np.array([b]))])


def tangents(xy: np.ndarray, dist: np.ndarray, at: np.ndarray) -> np.ndarray:
    """Unit direction of the segment each position falls on."""
    seg = np.clip(np.searchsorted(dist, at, side="right") - 1, 0, len(xy) - 2)
    d = xy[seg + 1] - xy[seg]
    return d / np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]


def densify(xy: np.ndarray, step: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(points, unit tangents, distances) every `step` metres along the line, ends included."""
    dist = along(xy)
    n = max(int(np.ceil(dist[-1] / step)), 1)
    at = np.linspace(0.0, dist[-1], n + 1)
    return interpolate(xy, dist, at), tangents(xy, dist, at), at


def side_points(xy: np.ndarray, step: float, near_m: float, far_m: float):
    """Sample points on both sides of a line: (points, side, tangent, offset). Side 0 is the left of
    the line's direction, 1 the right. Positions along the line are step/2, 3*step/2, ...; offsets
    across it from near_m + step/2 to far_m."""
    dist = along(xy)
    if dist[-1] < step / 2:
        return np.zeros((0, 2)), np.zeros(0, "int8"), np.zeros((0, 2)), np.zeros(0)
    at = np.arange(step / 2, dist[-1], step)
    base = interpolate(xy, dist, at)
    t = tangents(xy, dist, at)
    normal = np.column_stack([-t[:, 1], t[:, 0]])                     # to the left
    offsets = np.arange(near_m + step / 2, far_m + 1e-9, step)
    pts, side, tan, off = [], [], [], []
    for s, sign in ((0, 1.0), (1, -1.0)):
        for d in offsets:
            pts.append(base + sign * d * normal)
            side.append(np.full(len(base), s, dtype="int8"))
            tan.append(t)
            off.append(np.full(len(base), d))
    return np.concatenate(pts), np.concatenate(side), np.concatenate(tan), np.concatenate(off)


def own_side(points: np.ndarray, owner: np.ndarray, line_tree, line_owner: np.ndarray, near_m: float) -> np.ndarray:
    """Keep a sample point when the nearest densified highway point belongs to the same line
    (`owner` vs `line_owner`, e.g. chain ids) and is at least near_m (less a metre for rounding) away."""
    if len(points) == 0:
        return np.zeros(0, dtype=bool)
    d, i = line_tree.query(points, k=1)
    return (line_owner[i] == owner) & (d >= near_m - 1.0)


def borrow(points: np.ndarray, from_chain: np.ndarray, twin_chain: int, mid: np.ndarray, tangent: np.ndarray,
           half_len: float, empty_side: int, near_m: float, far_m: float) -> np.ndarray:
    """Indices of the points of the twin line (`from_chain == twin_chain`) that lie on this
    section's `empty_side`, within its length (along its own chord), and between near_m and far_m
    (plus the gap between the two lines) of it. For a dual carriageway these are the other line's
    outer side: the land this section's own strip could not have, because the twin is nearer to it."""
    sel = np.nonzero(from_chain == twin_chain)[0]
    if len(sel) == 0:
        return sel
    rel = points[sel] - mid
    normal = np.array([-tangent[1], tangent[0]])
    a = rel @ tangent
    c = rel @ normal
    on_side = c > 0 if empty_side == 0 else c < 0
    return sel[on_side & (np.abs(a) <= half_len) & (np.abs(c) >= near_m) & (np.abs(c) <= far_m)]
