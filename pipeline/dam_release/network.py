"""The path released water takes: down the river from the dam, and the lower reaches of the
streams that join it.

The walk follows the direction each way is drawn in, which for an OSM waterway is the direction
the water flows. Connectivity is by coordinate: ways that meet share a node, so their endpoints
are the same numbers. A gap of a few metres is tolerated, because a river split across two
ways is sometimes drawn with one node a hair out.

Nothing here invents geometry. Where OSM has not mapped a channel - the Bang Lang spillway's own
channel, for one - there is no line, and the caller shows a point instead of a guess.
"""

from __future__ import annotations

import collections
import logging
import math

from shapely.geometry import LineString

log = logging.getLogger("dam_release")

Coord = tuple[float, float]
# Which waterway to prefer when more than one leaves a junction: the bigger channel carries the
# release. Anything unlisted comes last.
CLASS_RANK = {"river": 0, "canal": 1, "stream": 2, "ditch": 3, "drain": 4}
# Two endpoints this close are the same place (metres).
JOIN_TOLERANCE_M = 30.0


def km(a: Coord, b: Coord) -> float:
    """Distance in kilometres between two lon/lat pairs, flat-earth at this latitude. The service
    area spans 2.5 degrees, where this is accurate to well under a percent - and every use here
    is a length or a tolerance, never a position."""
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.320 * math.cos(lat), (a[1] - b[1]) * 110.574)


def length_km(pts: list[Coord]) -> float:
    return sum(km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def _by_first_point(ways: dict[int, dict]) -> dict[Coord, list[dict]]:
    index: dict[Coord, list[dict]] = collections.defaultdict(list)
    for way in ways.values():
        index[way["pts"][0]].append(way)
    return index


def _by_last_point(ways: dict[int, dict], skip: set[int]) -> dict[Coord, list[dict]]:
    index: dict[Coord, list[dict]] = collections.defaultdict(list)
    for way in ways.values():
        if way["id"] not in skip:
            index[way["pts"][-1]].append(way)
    return index


def _best(candidates: list[dict]) -> dict:
    """The channel a release would follow: the largest class, and among equals the longest."""
    return sorted(candidates,
                  key=lambda w: (CLASS_RANK.get(w["tags"].get("waterway"), 9),
                                 -length_km(w["pts"])))[0]


def walk_downstream(ways: dict[int, dict], start_id: int, max_steps: int = 500) -> list[dict]:
    """The chain of ways from `start_id` to wherever the mapped network ends - for the Pattani
    River, the sea. Stops at a dead end rather than guessing across it."""
    if start_id not in ways:
        raise KeyError(f"OSM way {start_id} is not in the waterway cache.")
    downstream = _by_first_point(ways)
    chain: list[dict] = []
    seen: set[int] = set()
    current: dict | None = ways[start_id]
    while current is not None and current["id"] not in seen and len(chain) < max_steps:
        seen.add(current["id"])
        chain.append(current)
        tail = current["pts"][-1]
        candidates = [w for w in downstream.get(tail, []) if w["id"] not in seen]
        if not candidates:
            candidates = [w for w in ways.values()
                          if w["id"] not in seen and km(w["pts"][0], tail) * 1000 < JOIN_TOLERANCE_M]
        current = _best(candidates) if candidates else None
    return chain


def joined(chain: list[dict]) -> list[Coord]:
    """One line through a chain of ways, without repeating the shared nodes."""
    out: list[Coord] = []
    for way in chain:
        out += way["pts"] if not out else way["pts"][1:]
    return out


def network_km(start: dict, incoming: dict[Coord, list[dict]], seen: set[int]) -> float:
    """How long the whole mapped network above a way is. Used to leave out the ditches: a
    tributary with a kilometre of network behind it cannot back up water worth drawing."""
    total = length_km(start["pts"])
    stack = [start["pts"][0]]
    while stack:
        point = stack.pop()
        for way in incoming.get(point, []):
            if way["id"] in seen:
                continue
            seen.add(way["id"])
            total += length_km(way["pts"])
            stack.append(way["pts"][0])
    return total


def cut_from_end(pts: list[Coord], keep_km: float) -> list[Coord]:
    """The last `keep_km` of a line, measured back from its end, cut mid-segment if need be."""
    if keep_km <= 0 or len(pts) < 2:
        return pts[-2:] if len(pts) >= 2 else pts
    out = [pts[-1]]
    left = keep_km
    for i in range(len(pts) - 1, 0, -1):
        step = km(pts[i - 1], pts[i])
        if step <= left or step == 0:
            out.append(pts[i - 1])
            left -= step
            continue
        share = left / step
        out.append((pts[i][0] + (pts[i - 1][0] - pts[i][0]) * share,
                    pts[i][1] + (pts[i - 1][1] - pts[i][1]) * share))
        break
    out.reverse()
    return out


def lower_reaches(ways: dict[int, dict], main: list[dict], min_network_km: float,
                  reach_km: float) -> list[dict]:
    """The lower reach of every stream that joins the main stem (spec section 15).

    A tributary is a way that *ends* on the main stem, so the water in it runs into the river.
    From the junction the reach is followed back upstream for `reach_km`, through as many ways as
    that takes, because a mapped tributary is often cut into several.
    """
    main_ids = {way["id"] for way in main}
    main_pts = joined(main)
    on_main = {point: index for index, point in enumerate(main_pts)}
    # Distance of each point of the main stem from the dam, so a junction can be placed.
    from_dam = [0.0]
    for i in range(len(main_pts) - 1):
        from_dam.append(from_dam[-1] + km(main_pts[i], main_pts[i + 1]))
    incoming = _by_last_point(ways, main_ids)

    out: list[dict] = []
    for point, index in on_main.items():
        for mouth in incoming.get(point, []):
            counted = {mouth["id"]}
            whole = network_km(mouth, incoming, counted)
            if whole < min_network_km:
                continue
            # Walk back up the biggest channel until the reach is long enough.
            chain = [mouth]
            have = length_km(mouth["pts"])
            used = {mouth["id"]}
            while have < reach_km:
                above = [w for w in incoming.get(chain[0]["pts"][0], []) if w["id"] not in used]
                if not above:
                    break
                nxt = _best(above)
                used.add(nxt["id"])
                chain.insert(0, nxt)
                have += length_km(nxt["pts"])
            pts = cut_from_end(joined(chain), reach_km)
            out.append({
                "pts": pts,
                "network_km": round(whole, 2),
                "reach_km": round(length_km(pts), 2),
                "junction_km_from_dam": round(from_dam[index], 2),
                "waterway": mouth["tags"].get("waterway"),
                "osm_name": mouth["tags"].get("name") or None,
                "osm_way": mouth["id"],
            })
    out.sort(key=lambda t: t["junction_km_from_dam"])
    log.info("network: %d tributaries with %.0f km or more of network", len(out), min_network_km)
    return out


def simplify(pts: list[Coord], metres: float) -> list[Coord]:
    """Drop the points that say nothing, keeping the line within `metres` of the original."""
    if len(pts) < 3:
        return pts
    degrees = metres / 111_320.0
    line = LineString(pts).simplify(degrees, preserve_topology=False)
    return [(round(x, 6), round(y, 6)) for x, y in line.coords]
