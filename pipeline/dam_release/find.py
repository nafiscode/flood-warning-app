"""Which OSM channel carries water away from a reservoir.

Bang Lang's outlet way was read off a map by hand, which is fine for one dam. The owner asked on
14 Oct 2026 for every reservoir that matters to the flood in the four provinces, and picking five
more by eye is how a wrong channel gets into a warning. This proposes the candidates instead, from
the waterway network the hazard module has already cached, and prints what each one would mean:
how far the walk gets, which way it heads, and where it ends.

It decides nothing. The choice goes into config.yaml by hand, and the walk itself (network.py) is
what the seed is built from.
"""

from __future__ import annotations

import logging

from . import network

log = logging.getLogger("dam_release")

#: How far from the dam a candidate outlet may start. A reservoir's own outflow is mapped within a
#: few hundred metres of the wall; beyond a couple of kilometres it is some other stream.
SEARCH_KM = 2.5
#: A channel shorter than this leads nowhere worth warning about, however near the dam it starts.
MIN_CHAIN_KM = 3.0


def bearing(a: network.Coord, b: network.Coord) -> str:
    """Rough compass direction from a to b, for reading the candidates against a map."""
    import math

    deg = (math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) + 360) % 360
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round(deg / 45) % 8]


def candidates(ways: dict[int, dict], point: network.Coord, limit: int = 6) -> list[dict]:
    """The ways that could be the outlet, best first.

    A candidate is a way whose **first** node is near the dam - first, because an OSM waterway is
    drawn in the direction the water flows, so a way that starts here is a way that leaves here.
    They are ranked by how far the walk downstream from them gets, because the release follows the
    channel that goes somewhere, and a 400 m ditch beside the wall does not.
    """
    near = [
        (network.km(point, way["pts"][0]), way)
        for way in ways.values()
        if network.km(point, way["pts"][0]) <= SEARCH_KM
    ]
    out: list[dict] = []
    for start_km, way in sorted(near, key=lambda pair: pair[0]):
        chain = network.walk_downstream(ways, way["id"])
        line = network.joined(chain)
        length = network.length_km(line)
        if length < MIN_CHAIN_KM:
            continue
        tags = way.get("tags", {})
        out.append(
            {
                "way": way["id"],
                "class": tags.get("waterway", "?"),
                "name": tags.get("name") or tags.get("name:th") or "",
                "starts_km_from_dam": round(start_km, 2),
                "heads": bearing(line[0], line[min(len(line) - 1, 20)]),
                "chain_ways": len(chain),
                "chain_km": round(length, 1),
                "ends_at": [round(line[-1][0], 4), round(line[-1][1], 4)],
            }
        )
    out.sort(key=lambda c: -c["chain_km"])
    return out[:limit]
