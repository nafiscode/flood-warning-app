"""OpenStreetMap for the highway paths: the main highways' names and numbers, the mapped culverts, and
the waterways that pass under the highways.

The road cache of the safe places (`out/safe_places/osm/roads_*.npz`) holds the highway lines but
not their tags, and nothing about culverts. One more Overpass request per quarter-degree tile that
carries a main highway fills the gap, through the same servers, pacing and retries as
`safe_places.osm`, cached per tile as gzipped JSON (only the fields used here). Data (c)
OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from pathlib import Path

import httpx

from safe_places.osm import ROAD_TILE, _ask

log = logging.getLogger("highway_paths")

# Three groups in one answer, told apart by their tags:
#   the main highways (tags only: their geometry is already in the road cache),
#   anything tagged as a culvert,
#   waterway lines within `near_m` of a main highway (where a stream or a drain is mapped passing the road).
QUERY = ('[out:json][timeout:180];'
         'way["highway"~"^(motorway|trunk|primary)(_link)?$"]({s},{w},{n},{e})->.h;'
         '.h out tags;'
         '('
         'nwr["man_made"="culvert"]({s},{w},{n},{e});'
         'nwr["tunnel"="culvert"]({s},{w},{n},{e});'
         'nwr["culvert"="yes"]({s},{w},{n},{e});'
         ');out tags geom;'
         'way["waterway"](around.h:{near_m});out tags geom;')

HIGHWAY_TAGS = ("highway", "ref", "name", "name:en", "name:th", "oneway", "bridge", "layer")
WATER_TAGS = ("waterway", "tunnel", "culvert", "man_made", "bridge", "layer", "name")


def is_culvert(tags: dict) -> bool:
    return (tags.get("man_made") == "culvert" or tags.get("tunnel") == "culvert"
            or tags.get("culvert") in ("yes", "box", "pipe"))


def slim(elements: list[dict]) -> dict[str, list[dict]]:
    """The answer as three lists: `highways` (id + tags), `culverts` and `waterways` (id, tags and
    the points as [lon, lat] pairs). An element can only be in one list; a waterway tagged as a
    culvert goes to the culverts."""
    out: dict[str, list[dict]] = {"highways": [], "culverts": [], "waterways": []}
    for el in elements:
        tags = el.get("tags") or {}
        if el["type"] == "node":
            points = [[el["lon"], el["lat"]]] if "lon" in el else []
        else:
            points = [[p["lon"], p["lat"]] for p in (el.get("geometry") or []) if p]
        hw = tags.get("highway", "")
        if el["type"] == "way" and hw.split("_")[0] in ("motorway", "trunk", "primary") and not is_culvert(tags):
            out["highways"].append({"id": el["id"], "tags": {k: tags[k] for k in HIGHWAY_TAGS if k in tags}})
        elif is_culvert(tags):
            if points:
                out["culverts"].append({"type": el["type"], "id": el["id"], "points": points,
                                        "tags": {k: tags[k] for k in WATER_TAGS if k in tags}})
        elif tags.get("waterway") and len(points) >= 2:
            out["waterways"].append({"id": el["id"], "points": points,
                                     "tags": {k: tags[k] for k in WATER_TAGS if k in tags}})
    return out


def tile_name(lon: float, lat: float) -> str:
    return f"paths_e{lon:06.2f}n{lat:05.2f}.json.gz"


def fetch(corners: list[tuple[float, float]], endpoints: list[str], user_agent: str, cache: Path, near_m: int = 60,
          pause_s: float = 5.0, rounds: int = 8) -> dict:
    """Make sure every tile in `corners` (south-west corners, quarter degrees) is in the cache.
    A tile no server would answer is skipped and named in the result; the rest of the run goes on
    without it."""
    cache.mkdir(parents=True, exist_ok=True)
    done, failed = [], []
    with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
        for lon, lat in corners:
            path = cache / tile_name(lon, lat)
            if path.exists():
                done.append(path.name)
                continue
            query = QUERY.format(s=lat, w=lon, n=lat + ROAD_TILE, e=lon + ROAD_TILE, near_m=near_m)
            try:
                data = _ask(client, endpoints, query, path.name, rounds=rounds)
            except RuntimeError as err:
                log.warning("%s", err)
                failed.append(path.name)
                continue
            got = slim(data["elements"])
            path.write_bytes(gzip.compress(json.dumps(got).encode("utf-8")))
            log.info("%s: %d highways, %d culverts, %d waterways", path.name, len(got["highways"]),
                     len(got["culverts"]), len(got["waterways"]))
            done.append(path.name)
            time.sleep(pause_s)
    return {"tiles": len(done), "failed": failed}


def load(cache: Path) -> dict[str, list[dict]]:
    """Everything cached, each element once (an element crossing a tile edge is in both tiles)."""
    out: dict[str, list[dict]] = {"highways": [], "culverts": [], "waterways": []}
    seen: set[tuple[str, str, int]] = set()
    for path in sorted(cache.glob("paths_*.json.gz")):
        got = json.loads(gzip.decompress(path.read_bytes()))
        for group, items in got.items():
            for item in items:
                key = (group, item.get("type", "way"), item["id"])
                if key not in seen:
                    seen.add(key)
                    out[group].append(item)
    return out
