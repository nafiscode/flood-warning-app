"""The score, its parts, and the flags that send a volunteer to check a site.

    S = 0.35 freeboard + 0.20 not flooded often + 0.25 dry route + 0.10 travel time + 0.10 capacity

Each part is between 0 and 1. A part nobody knows yet (capacity for nearly every site; the route for
a site away from any mapped road) is left out and the remaining weights are scaled up, so an unknown
neither helps nor hurts; `missing` in the components says which. Nothing is excluded (owner,
12 Oct 2026): a doubtful site keeps its row and carries flags instead.
"""

from __future__ import annotations

import math


def _known(x) -> bool:
    return x is not None and not (isinstance(x, float) and math.isnan(x))


def components(site: dict, cfg: dict, limit_minutes: float) -> dict:
    """The parts of the score for one site (None where unknown)."""
    fb = site.get("freeboard_m")
    freq = site.get("flood_freq")
    minutes = site.get("mean_minutes_dry")
    capacity = site.get("capacity")
    return {
        "freeboard": round(min(max(fb, 0.0), cfg["freeboard"]["full_score_m"]) / cfg["freeboard"]["full_score_m"], 3)
        if _known(fb) else None,
        "not_flooded_often": round(1.0 - min(max(freq, 0.0), 1.0), 3) if _known(freq) else None,
        "route_dry": site.get("route_dry") if _known(site.get("route_dry")) else None,
        "travel_time": round(1.0 - min(minutes / limit_minutes, 1.0), 3) if _known(minutes) else None,
        "capacity": round(min(capacity / 500.0, 1.0), 3) if _known(capacity) else None,
    }


def total(parts: dict, weights: dict) -> tuple[float | None, list[str]]:
    """(score, the parts that were unknown). None when nothing at all is known."""
    known = {k: v for k, v in parts.items() if v is not None}
    missing = sorted(k for k in weights if k not in known)
    weight = sum(weights[k] for k in known)
    if weight <= 0:
        return None, missing
    return round(sum(weights[k] * v for k, v in known.items()) / weight, 3), missing


def flags(site: dict, cfg: dict) -> list[str]:
    """Why a site needs a person's check before anyone relies on it."""
    f, out = cfg["flags"], []
    if f.get("radar_flood") and (site.get("flooded_2024") or site.get("flooded_2025")):
        out.append("radar_flood")
    fb = site.get("freeboard_m")
    if f.get("low_ground") and _known(fb) and fb < cfg["freeboard"]["low_m"]:
        out.append("low_ground")
    if _known(site.get("flood_freq")) and site["flood_freq"] > f["flood_frequency_over"]:
        out.append("floods_often")
    if _known(site.get("route_dry")) and site["route_dry"] < f["route_dry_under"]:
        out.append("route_cut")
    if site.get("houses") is None:
        out.append("no_road_mapped")
    if site.get("freeboard_basis") == "stream":
        out.append("no_flood_edge_near")
    if site.get("fill_m"):
        # Parking on a road's fill: whether cars may stand there is for the road's authority to say.
        out.append(EMBANKMENT_FLAGS.get(site.get("source"), "highway_shoulder"))
    return out


# The flag an embankment point carries, by its source: a main highway, or a smaller road (gap filler).
EMBANKMENT_FLAGS = {"jaga-highway": "highway_shoulder", "jaga-road": "road_shoulder"}
