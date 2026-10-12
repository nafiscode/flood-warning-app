"""OpenStreetMap for the safe places: the candidate buildings and the road network.

One Overpass request per tile, cached: half a degree for the buildings, a quarter for the roads
(the public servers time out on anything larger), and only the tiles that touch the provinces. A road tile is turned into compact arrays the
moment it arrives (the raw answer for a town is tens of megabytes and this laptop is short of
memory), so the cache holds `roads_*.npz`, not JSON. Data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from pathlib import Path

import httpx
import numpy as np

log = logging.getLogger("safe_places")
TILE = 0.5
ROAD_TILE = 0.25

POI_QUERY = ('[out:json][timeout:180];('
             'nwr["amenity"~"^(school|college|university|place_of_worship|townhall|community_centre)$"]({s},{w},{n},{e});'
             'nwr["office"="government"]({s},{w},{n},{e});'
             'nwr["building"~"^(school|mosque|temple|government|public|civic)$"]({s},{w},{n},{e});'
             ');out center tags;')
ROAD_QUERY = '[out:json][timeout:120];way["highway"]({s},{w},{n},{e});out body geom;'


def tiles(bounds: tuple[float, float, float, float], size: float = TILE, area=None):
    """South-west corners (lon, lat) of the tiles of `size` degrees covering [west, south, east,
    north]; with `area` (a shapely geometry) only the tiles that touch it."""
    w, s, e, n = bounds
    lon0, lat0 = np.floor(w / size) * size, np.floor(s / size) * size
    for lat in np.arange(lat0, n, size):
        for lon in np.arange(lon0, e, size):
            lon, lat = round(float(lon), 2), round(float(lat), 2)
            if area is not None:
                from shapely.geometry import box

                if not area.intersects(box(lon, lat, lon + size, lat + size)):
                    continue
            yield lon, lat


def _ask(client: httpx.Client, endpoints: str | list[str], query: str, label: str, rounds: int = 8) -> dict:
    """Ask each Overpass server in turn until one gives a complete answer. The public servers are
    often busy (504, 429), and a busy one says so quickly, so moving on is faster than waiting."""
    urls = [endpoints] if isinstance(endpoints, str) else list(endpoints)
    for attempt in range(rounds):
        for url in urls:
            host = url.split("/")[2]
            try:
                r = client.post(url, data={"data": query})
            except httpx.HTTPError as err:
                log.warning("%s: %s for %s", host, type(err).__name__, label)
                continue
            if r.status_code != 200:
                log.warning("%s: %s for %s", host, r.status_code, label)
                continue
            try:
                data = r.json()
            except ValueError:
                log.warning("%s: not JSON for %s", host, label)
                continue
            if "remark" in data:              # a timeout or a memory limit, reported inside a 200 answer
                log.warning("%s: incomplete answer for %s: %s", host, label, str(data["remark"])[:80])
                continue
            return data
        time.sleep(min(30 * (attempt + 1), 120))
    raise RuntimeError(f"No Overpass server answered for {label} after {rounds} rounds.")


def classify(tags: dict) -> str | None:
    """A candidate's type as the safe_places table names it, or None when the tags do not say."""
    amenity, building = tags.get("amenity"), tags.get("building")
    if amenity == "place_of_worship" or building in ("mosque", "temple"):
        religion = tags.get("religion")
        if religion == "muslim" or building == "mosque":
            return "mosque"
        if religion == "buddhist" or building == "temple":
            return "temple"
        return "other"
    if amenity in ("school", "college", "university") or building == "school":
        return "school"
    if amenity in ("townhall", "community_centre") or tags.get("office") == "government" or building in (
            "government", "public", "civic"):
        return "government"
    return None


def names(tags: dict) -> dict:
    """{"th", "ms", "en"} from the name tags; the plain `name` is taken as Thai when it has Thai letters."""
    out = {k: tags[f"name:{k}"] for k in ("th", "ms", "en") if tags.get(f"name:{k}")}
    plain = tags.get("name")
    if plain:
        thai = any("฀" <= ch <= "๿" for ch in plain)
        out.setdefault("th" if thai else "en", plain)
    return out


def pois(elements: list[dict]) -> list[dict]:
    """Named candidates from Overpass elements: one per OSM object, at its point or centre."""
    out, seen = [], set()
    for el in elements:
        ref = f"{el['type']}/{el['id']}"
        tags = el.get("tags") or {}
        kind, name = classify(tags), names(tags)
        pos = el if "lat" in el else el.get("center")
        if ref in seen or not kind or not name or not pos:
            continue
        seen.add(ref)
        out.append({"osm": ref, "type": kind, "name": name, "lon": float(pos["lon"]), "lat": float(pos["lat"])})
    return out


def fetch_pois(bounds, endpoint: str | list[str], user_agent: str, cache: Path, pause_s: float = 5.0) -> list[dict]:
    cache.mkdir(parents=True, exist_ok=True)
    out, seen = [], set()
    with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
        for lon, lat in tiles(bounds):
            path = cache / f"pois_e{lon:05.1f}n{lat:04.1f}.json.gz"
            if not path.exists():
                data = _ask(client, endpoint, POI_QUERY.format(s=lat, w=lon, n=lat + TILE, e=lon + TILE), path.name)
                path.write_bytes(gzip.compress(json.dumps(data["elements"]).encode("utf-8")))
                time.sleep(pause_s)
            for p in pois(json.loads(gzip.decompress(path.read_bytes()))):
                if p["osm"] not in seen:
                    seen.add(p["osm"])
                    out.append(p)
    return out


def road_arrays(elements: list[dict]) -> dict[str, np.ndarray]:
    """Ways as flat arrays: per way its OSM id, highway class, bridge flag and the slice of its
    points; per point the OSM node id and its position."""
    way_id, kind, bridge, start, node, lon, lat = [], [], [], [0], [], [], []
    for el in elements:
        ids, geom = el.get("nodes") or [], el.get("geometry") or []
        tags = el.get("tags") or {}
        if len(ids) < 2 or len(ids) != len(geom) or tags.get("area") == "yes":
            continue
        way_id.append(el["id"])
        kind.append(tags.get("highway", ""))
        bridge.append(tags.get("bridge", "no") != "no" or tags.get("tunnel", "no") != "no")
        node += ids
        lon += [p["lon"] for p in geom]
        lat += [p["lat"] for p in geom]
        start.append(len(node))
    return {"way_id": np.array(way_id, dtype="int64"), "kind": np.array(kind, dtype="U16"),
            "bridge": np.array(bridge, dtype=bool), "start": np.array(start, dtype="int64"),
            "node": np.array(node, dtype="int64"), "lon": np.array(lon, dtype="float64"),
            "lat": np.array(lat, dtype="float64")}


def fetch_roads(bounds, endpoint: str | list[str], user_agent: str, cache: Path, area=None,
                pause_s: float = 5.0) -> list[Path]:
    """Make sure every road tile that touches `area` is in the cache; returns the tile files."""
    cache.mkdir(parents=True, exist_ok=True)
    paths = []
    with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
        for lon, lat in tiles(bounds, ROAD_TILE, area):
            path = cache / f"roads_e{lon:06.2f}n{lat:05.2f}.npz"
            if not path.exists():
                data = _ask(client, endpoint, ROAD_QUERY.format(s=lat, w=lon, n=lat + ROAD_TILE, e=lon + ROAD_TILE), path.name)
                arrays = road_arrays(data["elements"])
                del data
                np.savez_compressed(path, **arrays)
                log.info("%s: %d ways, %d points", path.name, len(arrays["way_id"]), len(arrays["node"]))
                time.sleep(pause_s)
            paths.append(path)
    return paths
