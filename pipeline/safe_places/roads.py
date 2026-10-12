"""The road network as arrays, and how far one can get along it.

Nodes are OpenStreetMap's own way points, so a road's bends are in the distances. The graph is kept
as flat numpy arrays (this laptop has little memory to spare) and the search only ever looks at the
neighbourhood within the time limit, so a few thousand searches cost seconds, not hours.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Graph:
    xy: np.ndarray            # node positions, metres (the hazard grid's coordinate system)
    indptr: np.ndarray        # CSR: the edges leaving node i are indptr[i]:indptr[i + 1]
    to: np.ndarray            # the node each edge leads to
    length_m: np.ndarray
    walk: np.ndarray          # may be walked
    drive: np.ndarray         # may be driven
    flooded: np.ndarray       # the radar saw flood on it (set by `mark_flooded`)
    bridge: np.ndarray        # a bridge or a tunnel: never flooded
    frm: np.ndarray           # the node each edge leaves

    @property
    def nodes(self) -> int:
        return len(self.xy)


def load_tiles(paths: list[Path], drop: list[str]) -> dict[str, np.ndarray]:
    """Every way once (a way crossing a tile edge is in both tiles), as the arrays of `osm.road_arrays`
    plus `way_of_point`."""
    seen: set[int] = set()
    parts = {k: [] for k in ("way_id", "kind", "bridge", "count", "node", "lon", "lat")}
    for path in paths:
        t = np.load(path)
        new = np.array([w not in seen and k not in drop for w, k in zip(t["way_id"].tolist(), t["kind"].tolist())], dtype=bool)
        seen.update(t["way_id"][new].tolist())
        counts = np.diff(t["start"])
        keep_points = np.repeat(new, counts)
        parts["way_id"].append(t["way_id"][new])
        parts["kind"].append(t["kind"][new])
        parts["bridge"].append(t["bridge"][new])
        parts["count"].append(counts[new])
        for k in ("node", "lon", "lat"):
            parts[k].append(t[k][keep_points])
    out = {k: np.concatenate(v) if v else np.array([]) for k, v in parts.items()}
    out["way_of_point"] = np.repeat(np.arange(len(out["way_id"])), out["count"].astype("int64"))
    return out


def build(ways: dict[str, np.ndarray], to_xy, no_walking: list[str], no_driving: list[str]) -> Graph:
    """`to_xy(lon, lat) -> (x, y)` puts the points on the working grid's coordinates."""
    ids, index = np.unique(ways["node"], return_inverse=True)
    x, y = to_xy(ways["lon"], ways["lat"])
    xy = np.zeros((len(ids), 2), dtype="float64")
    xy[index, 0], xy[index, 1] = x, y
    same_way = ways["way_of_point"][1:] == ways["way_of_point"][:-1]
    a, b = index[:-1][same_way], index[1:][same_way]
    way = ways["way_of_point"][1:][same_way]
    length = np.hypot(xy[a, 0] - xy[b, 0], xy[a, 1] - xy[b, 1])
    walk = ~np.isin(ways["kind"], no_walking)[way]
    drive = ~np.isin(ways["kind"], no_driving)[way]
    bridge = ways["bridge"][way]
    # Both directions: one-way streets are ignored (on foot they do not apply; by car in an evacuation
    # the difference is small next to everything else this ignores).
    u, v = np.concatenate([a, b]), np.concatenate([b, a])
    order = np.argsort(u, kind="stable")
    indptr = np.zeros(len(ids) + 1, dtype="int64")
    np.add.at(indptr, u + 1, 1)
    indptr = np.cumsum(indptr)
    twice = lambda arr: np.concatenate([arr, arr])[order]          # noqa: E731
    return Graph(xy=xy, indptr=indptr, to=v[order], length_m=twice(length), walk=twice(walk), drive=twice(drive),
                 flooded=np.zeros(len(order), dtype=bool), bridge=twice(bridge), frm=u[order])


def mark_flooded(g: Graph, flood: np.ndarray, transform) -> int:
    """An edge is flooded when at least two of its three sample points (both ends and the middle) lie
    on a flooded cell of `flood`, a boolean raster on the working grid. One point alone is a road
    touching the water's edge or crossing a stream on a culvert nobody tagged as a bridge, and a
    road network falls apart if every such touch is a cut. Bridges and tunnels are never flooded.
    Returns the number of flooded edges (each road piece counts twice, once per direction)."""
    def on(px, py):
        col = np.floor((px - transform.c) / transform.a).astype("int64")
        row = np.floor((py - transform.f) / transform.e).astype("int64")
        inside = (row >= 0) & (row < flood.shape[0]) & (col >= 0) & (col < flood.shape[1])
        out = np.zeros(len(px), dtype=bool)
        out[inside] = flood[row[inside], col[inside]]
        return out

    a, b = g.xy[g.frm], g.xy[g.to]
    mid = (a + b) / 2
    hits = on(a[:, 0], a[:, 1]).astype("int8") + on(b[:, 0], b[:, 1]) + on(mid[:, 0], mid[:, 1])
    g.flooded = (hits >= 2) & ~g.bridge
    return int(g.flooded.sum())


def reach(g: Graph, source: int, limit_s: float, speed_ms: float, allowed: np.ndarray, dry: bool) -> dict[int, float]:
    """node -> seconds from `source`, for every node within `limit_s`, along edges that are `allowed`
    (and not flooded when `dry`). Roads are two-way, so this is also the time from each node to the
    source."""
    dist = {source: 0.0}
    heap = [(0.0, source)]
    indptr, to, length, flooded = g.indptr, g.to, g.length_m, g.flooded
    while heap:
        d, n = heapq.heappop(heap)
        if d > dist.get(n, np.inf):
            continue
        for e in range(indptr[n], indptr[n + 1]):
            if not allowed[e] or (dry and flooded[e]):
                continue
            nd = d + length[e] / speed_ms
            if nd <= limit_s and nd < dist.get(int(to[e]), np.inf):
                dist[int(to[e])] = nd
                heapq.heappush(heap, (nd, int(to[e])))
    return dist


def nearest(tree, points: np.ndarray, max_m: float) -> np.ndarray:
    """Index of the nearest node for each point, or -1 when none is within `max_m`."""
    d, i = tree.query(points, k=1, distance_upper_bound=max_m)
    return np.where(np.isfinite(d), i, -1).astype("int64")


def served(g: Graph, source: int, limit_s: float, speed_ms: float, allowed: np.ndarray,
           houses_at_node: np.ndarray) -> dict:
    """What a site at node `source` serves: the houses within the time limit on the whole network,
    how many of them can still come when the flooded roads are closed, and their mean time then."""
    if source < 0:
        return {"houses": None, "houses_dry": None, "route_dry": None, "mean_minutes_dry": None}
    full = reach(g, source, limit_s, speed_ms, allowed, dry=False)
    dry = reach(g, source, limit_s, speed_ms, allowed, dry=True)
    nodes_full = np.fromiter(full.keys(), dtype="int64", count=len(full))
    nodes_dry = np.fromiter(dry.keys(), dtype="int64", count=len(dry))
    times = np.fromiter(dry.values(), dtype="float64", count=len(dry))
    houses = float(houses_at_node[nodes_full].sum())
    weight = houses_at_node[nodes_dry]
    houses_dry = float(weight.sum())
    return {"houses": round(houses), "houses_dry": round(houses_dry),
            "route_dry": round(houses_dry / houses, 3) if houses >= 1 else None,
            "mean_minutes_dry": round(float((times * weight).sum() / houses_dry / 60), 1) if houses_dry >= 1 else None}
