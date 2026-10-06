"""Score each candidate stream network against mapped water, to choose the stream threshold.

Mapped water:
  OpenStreetMap waterways (river, canal, stream, drain), fetched once from Overpass and cached
  JRC surface-water occurrence above a set percentage, where the DEM has land

For every threshold and every class of mapped water, on the working grid:
  found      share of the mapped cells that have a modelled stream within `tolerance_cells`
  explained  share of the modelled stream cells that have mapped water of any class within the same
             distance (a lower bound: OSM maps far from every headwater stream)

A low threshold finds more of the mapped water and explains less of itself; the table shows where
the first stops improving. Lowland canals and drains are reported separately because a D8 network
on a 30 m DEM cannot follow them and should not be judged by them.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio import features
from rasterio.warp import Resampling, reproject, transform_geom

log = logging.getLogger("hazard")
OVERPASS_QUERY = '[out:json][timeout:180];way["waterway"~"^({classes})$"]({s},{w},{n},{e});out tags geom;'


def dilate(mask: np.ndarray, cells: int) -> np.ndarray:
    """Grow a boolean mask by `cells` in every direction (a square of side 2 * cells + 1)."""
    out = mask.copy()
    for _ in range(cells):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        out = grown.copy()
        out[:, 1:] |= grown[:, :-1]
        out[:, :-1] |= grown[:, 1:]
    return out


def score(streams: np.ndarray, mapped: dict[str, np.ndarray], tolerance_cells: int,
          within: np.ndarray | None = None) -> dict:
    """`found` per mapped class and `explained` for the modelled streams (see the module text)."""
    near_streams = dilate(streams, tolerance_cells)
    any_mapped = np.zeros_like(streams)
    out = {"stream_cells": int((streams & within).sum() if within is not None else streams.sum()), "found": {}}
    for name, cells in mapped.items():
        any_mapped |= cells
        target = cells & within if within is not None else cells
        n = int(target.sum())
        out["found"][name] = {"cells": n, "share": round(float((target & near_streams).sum()) / n, 4) if n else None}
    mine = streams & within if within is not None else streams
    n = int(mine.sum())
    out["explained"] = round(float((mine & dilate(any_mapped, tolerance_cells)).sum()) / n, 4) if n else None
    return out


def fetch_waterways(bbox_deg: list[float], classes: list[str], endpoint: str, user_agent: str, cache: Path,
                    pause_s: float = 5.0) -> list[dict]:
    """OSM waterway ways inside the box as GeoJSON-like features, one Overpass request per whole
    degree tile, cached per tile. Data © OpenStreetMap contributors, ODbL."""
    w, s, e, n = bbox_deg
    cache.mkdir(parents=True, exist_ok=True)
    out, seen = [], set()
    with httpx.Client(timeout=240, headers={"User-Agent": user_agent}) as client:
        for lat in range(int(np.floor(s)), int(np.ceil(n))):
            for lon in range(int(np.floor(w)), int(np.ceil(e))):
                path = cache / f"waterways_e{lon:03d}n{lat:02d}.json"
                if not path.exists():
                    query = OVERPASS_QUERY.format(classes="|".join(classes), s=max(lat, s), w=max(lon, w),
                                                  n=min(lat + 1, n), e=min(lon + 1, e))
                    for attempt in range(4):
                        r = client.post(endpoint, data={"data": query})
                        if r.status_code == 200:
                            break
                        log.warning("Overpass %s for %s, retrying", r.status_code, path.name)
                        time.sleep(30 * (attempt + 1))
                    r.raise_for_status()
                    if "remark" in r.json():          # Overpass reports a timeout inside a 200 answer
                        raise RuntimeError(f"Overpass gave an incomplete answer for {path.name}: {r.json()['remark']}")
                    path.write_text(r.text, encoding="utf-8")
                    time.sleep(pause_s)
                for el in json.loads(path.read_text(encoding="utf-8"))["elements"]:
                    if el["id"] in seen or len(el.get("geometry", [])) < 2:
                        continue
                    seen.add(el["id"])
                    out.append({"class": el["tags"]["waterway"],
                                "geometry": {"type": "LineString",
                                             "coordinates": [(p["lon"], p["lat"]) for p in el["geometry"]]}})
    return out


def rasterize_classes(ways: list[dict], crs: str, transform, shape: tuple[int, int]) -> dict[str, np.ndarray]:
    out = {}
    for name in sorted({w["class"] for w in ways}):
        geoms = [transform_geom("EPSG:4326", crs, w["geometry"]) for w in ways if w["class"] == name]
        out[name] = features.rasterize(geoms, out_shape=shape, transform=transform, fill=0, default_value=1,
                                       all_touched=True, dtype="uint8").astype(bool)
    return out


def on_grid(src_path: Path, crs: str, transform, shape: tuple[int, int]) -> np.ndarray:
    """A source raster resampled (nearest) to the working grid."""
    data = np.zeros(shape, dtype="uint8")
    with rasterio.open(src_path) as src:
        reproject(rasterio.band(src, 1), data, dst_transform=transform, dst_crs=crs, dst_nodata=0,
                  resampling=Resampling.nearest)
    return data


def compare(work: Path, thresholds: list[int], ways: list[dict], water_path: Path, min_occurrence_pct: int,
            tolerance_cells: int, area_geometry: dict | None = None) -> dict:
    """The score table for every threshold: whole grid and, if given, inside `area_geometry` (EPSG:4326)."""
    with rasterio.open(work / "dem_utm.tif") as src:
        land = src.read(1) != src.nodata
        crs, transform, shape = src.crs.to_string(), src.transform, src.shape
    mapped = {f"osm {k}": v & land for k, v in rasterize_classes(ways, crs, transform, shape).items()}
    mapped[f"jrc water over {min_occurrence_pct}%"] = (on_grid(water_path, crs, transform, shape) > min_occurrence_pct) & land
    within = None
    if area_geometry is not None:
        within = features.rasterize([transform_geom("EPSG:4326", crs, area_geometry)], out_shape=shape,
                                    transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)
    result = {"tolerance_cells": tolerance_cells, "land_cells": int(land.sum()),
              "osm_ways": len(ways), "thresholds": {}}
    for n in thresholds:
        with rasterio.open(work / f"streams_{n}.tif") as src:
            band = src.read(1)
            streams = (band > 0) & (band != src.nodata) if src.nodata is not None else band > 0
        entry = {"window": score(streams, mapped, tolerance_cells)}
        if within is not None:
            entry["area"] = score(streams, mapped, tolerance_cells, within)
        result["thresholds"][str(n)] = entry
        log.info("threshold %d: %s", n, entry.get("area", entry["window"]))
    return result
