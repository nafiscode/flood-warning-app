"""What OpenStreetMap knows about the dam: the reservoir outline and the waterway network.

Data (c) OpenStreetMap contributors, ODbL. The river comes from the cache the hazard module
already filled, so only the reservoir needs a request, and that one is cached too.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import linemerge, polygonize, unary_union

log = logging.getLogger("dam_release")

Coord = tuple[float, float]


def load_waterways(cache: Path) -> dict[int, dict]:
    """Every waterway way in the cache, by OSM id. Coordinates are rounded to 7 decimals so that
    ways meeting at a shared node compare equal, which is how the walk downstream finds them."""
    if not cache.is_dir():
        raise FileNotFoundError(
            f"no OSM waterway cache at {cache}. Run `uv run python -m hazard streams-compare` "
            "once to fill it, or point waterway_cache at a folder that has it."
        )
    ways: dict[int, dict] = {}
    for path in sorted(cache.glob("waterways_*.json")):
        for el in json.loads(path.read_text(encoding="utf-8"))["elements"]:
            geometry = el.get("geometry") or []
            if len(geometry) < 2:
                continue
            ways[el["id"]] = {
                "id": el["id"],
                "tags": el.get("tags", {}),
                "pts": [(round(p["lon"], 7), round(p["lat"], 7)) for p in geometry],
            }
    if not ways:
        raise FileNotFoundError(f"the OSM waterway cache at {cache} holds no ways.")
    log.info("osm: %d waterway ways from %s", len(ways), cache)
    return ways


def fetch_relation(relation_id: int, endpoint: str, user_agent: str, cache: Path,
                   attempts: int = 4) -> dict:
    """One OSM relation with the geometry of every member, cached as the raw answer.

    Overpass answers 429 and 504 often enough that this has to retry (the hazard module meets the
    same thing); an incomplete answer arrives as a 200 with a "remark", which is an error here.
    """
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"relation_{relation_id}.json"
    if not path.exists():
        # "out geom" prints the tags AND the members with their geometry; "out tags geom" is
        # tags mode and silently leaves the members out, which looks like an empty relation.
        query = f"[out:json][timeout:180];relation({relation_id});out geom;"
        with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
            for attempt in range(attempts):
                answer = client.post(endpoint, data={"data": query})
                if answer.status_code == 200 and answer.text.lstrip().startswith("{"):
                    break
                log.warning("overpass %s for relation %s, retrying", answer.status_code, relation_id)
                time.sleep(30 * (attempt + 1))
            answer.raise_for_status()
            payload = answer.json()
            if "remark" in payload:
                raise RuntimeError(f"overpass gave an incomplete answer: {payload['remark']}")
            path.write_text(answer.text, encoding="utf-8")
    payload = json.loads(path.read_text(encoding="utf-8"))
    elements = payload.get("elements") or []
    if not elements:
        raise RuntimeError(f"OSM relation {relation_id} is empty or gone.")
    return elements[0]


def relation_polygon(relation: dict) -> MultiPolygon:
    """An OSM multipolygon relation as one shape: the outer rings with their islands cut out.

    The members arrive as open line pieces that have to be stitched into rings first, which is
    what linemerge and polygonize do. An island is kept only where it really sits inside an outer
    ring, so a mis-tagged member cannot punch a hole through the middle of the reservoir.
    """
    def rings(role: str) -> list[Polygon]:
        lines = [
            [(p["lon"], p["lat"]) for p in member.get("geometry") or []]
            for member in relation.get("members", [])
            if (member.get("role") or "") == role and len(member.get("geometry") or []) >= 2
        ]
        if not lines:
            return []
        merged = linemerge(lines)
        pieces = merged.geoms if merged.geom_type == "MultiLineString" else [merged]
        return [p for p in polygonize(pieces)]

    outers = rings("outer")
    if not outers:
        raise RuntimeError("the reservoir relation has no outer ring that closes.")
    inners = rings("inner")
    shape = unary_union(outers)
    for island in inners:
        if shape.contains(island.representative_point()):
            shape = shape.difference(island)
    if shape.geom_type == "Polygon":
        shape = MultiPolygon([shape])
    log.info("osm: reservoir from %d outer and %d inner rings, %.1f km2",
             len(outers), len(inners), area_km2(shape))
    return shape


def area_km2(shape) -> float:
    """Rough area of a shape given in degrees, good enough for a log line and a check."""
    import math
    lat = shape.centroid.y
    return shape.area * (111.32 ** 2) * math.cos(math.radians(lat))
