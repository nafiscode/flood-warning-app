"""OpenStreetMap water for the river-body layer: the areas that are water (rivers, canals,
reservoirs, lakes) and the waterway centrelines OSM maps only as lines.

One Overpass request per tile, cached as the raw elements, the way safe_places/osm.py does it;
the `_ask` retry/endpoint logic and the tile walk are reused from there. Data (c) OpenStreetMap
contributors, ODbL.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from pathlib import Path

import httpx

from safe_places.osm import _ask, tiles

log = logging.getLogger("rivers")

# Areas (ways and relations) plus the river/canal/stream centrelines, all with geometry. "out geom"
# prints each way's points and each relation member's points and role, which build.py needs.
QUERY = ('[out:json][timeout:180];('
         'way["natural"="water"]({s},{w},{n},{e});'
         'relation["natural"="water"]({s},{w},{n},{e});'
         'way["water"]({s},{w},{n},{e});'
         'way["waterway"="riverbank"]({s},{w},{n},{e});'
         'way["landuse"="reservoir"]({s},{w},{n},{e});'
         'relation["landuse"="reservoir"]({s},{w},{n},{e});'
         'way["waterway"~"^(river|canal|stream)$"]({s},{w},{n},{e});'
         ');out geom;')


def fetch(bounds, endpoint: str | list[str], user_agent: str, cache: Path, tile_deg: float,
          area=None, pause_s: float = 5.0) -> list[dict]:
    """Make sure every water tile touching `area` is in the cache, then return the unique OSM
    elements (deduplicated across tiles by type and id). A cached run does no network."""
    cache.mkdir(parents=True, exist_ok=True)
    out, seen = [], set()
    with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
        for lon, lat in tiles(bounds, tile_deg, area):
            path = cache / f"water_e{lon:06.2f}n{lat:05.2f}.json.gz"
            if not path.exists():
                data = _ask(client, endpoint, QUERY.format(s=lat, w=lon, n=lat + tile_deg, e=lon + tile_deg), path.name)
                path.write_bytes(gzip.compress(json.dumps(data["elements"]).encode("utf-8")))
                log.info("%s: %d elements", path.name, len(data["elements"]))
                time.sleep(pause_s)
            for el in json.loads(gzip.decompress(path.read_bytes())):
                ref = f"{el['type']}/{el['id']}"
                if ref not in seen:
                    seen.add(ref)
                    out.append(el)
    return out
