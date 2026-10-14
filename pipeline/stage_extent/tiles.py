"""The stage bands of every gauge as one PMTiles file, written the way the hazard tiles are
(hazard/tiles.py: pure Python, pmtiles + mapbox-vector-tile).

One layer. A polygon is the land that first goes under water at one stage step of one gauge:
properties `station` (gauge code) and `from_m` (that step, m MSL). The bands of a gauge do not
overlap; the land under water at stage s is every polygon of that gauge with `from_m <= s`.
"""

from __future__ import annotations

import gzip
import logging
from pathlib import Path

import numpy as np

from hazard.tiles import EXTENT, tile_bounds, tiles_for

log = logging.getLogger("stage_extent")


def coarsen_index(index: np.ndarray, factor: int, min_share: float, n: int) -> np.ndarray:
    """Blocks of `factor` x `factor` cells -> one: the lowest band k for which the cells wet at band k
    or lower fill at least `min_share` of the block (0 if even the highest band does not)."""
    if factor <= 1:
        return index
    rows, cols = (-(-index.shape[0] // factor)) * factor, (-(-index.shape[1] // factor)) * factor
    padded = np.zeros((rows, cols), dtype="uint8")
    padded[:index.shape[0], :index.shape[1]] = index
    blocks = padded.reshape(rows // factor, factor, cols // factor, factor)
    out = np.zeros((rows // factor, cols // factor), dtype="uint8")
    for k in range(n, 0, -1):                                  # a lower band overwrites
        share = ((blocks > 0) & (blocks <= k)).mean(axis=(1, 3))
        out[share >= min_share] = k
    return out


def smooth_index(pixels: np.ndarray, n: int, sigma_px: float, cut: float) -> np.ndarray:
    """Rounded band edges: each area "wet at band k or lower" is blurred and cut again; a pixel takes
    the lowest band it still belongs to. The areas are nested and the blur is linear, so they stay
    nested. The outline of the whole reach is kept exactly (nothing is drawn where nothing was)."""
    from scipy import ndimage

    if sigma_px <= 0:
        return pixels
    inside = pixels > 0
    out = np.where(inside, n, 0).astype(pixels.dtype)        # inside the reach, wet at the highest band at the latest
    for k in range(n - 1, 0, -1):                             # a lower band overwrites
        wet = ndimage.gaussian_filter((inside & (pixels <= k)).astype("float32"), sigma_px, mode="nearest") >= cut
        out[wet & inside] = k
    return out


def tile_polygons(pixels: np.ndarray, buffer_px: int, tile_px: int, simplify_px: float) -> dict[int, object]:
    """band -> MultiPolygon in tile units."""
    from rasterio import features
    from rasterio.transform import Affine
    from shapely.geometry import MultiPolygon, shape

    unit = EXTENT / tile_px
    to_tile = Affine(unit, 0, -buffer_px * unit, 0, unit, -buffer_px * unit)
    parts: dict[int, list] = {}
    for geom, value in features.shapes(pixels, mask=pixels > 0, transform=to_tile):
        poly = shape(geom)
        if simplify_px > 0:
            poly = poly.simplify(simplify_px * unit, preserve_topology=True)
            if poly.is_empty:
                continue
        parts.setdefault(int(value), []).extend(poly.geoms if poly.geom_type == "MultiPolygon" else [poly])
    return {k: MultiPolygon(v) for k, v in parts.items()}


def encode(features_: list[dict], layer: str) -> bytes:
    import mapbox_vector_tile

    raw = mapbox_vector_tile.encode([{"name": layer, "features": features_}],
                                    default_options={"extents": EXTENT, "y_coord_down": True})
    return gzip.compress(raw, mtime=0)


def build(gauges: list[dict], dest: Path, *, min_zoom: int, max_zoom: int, tile_px: int, buffer_px: int,
          min_share: float, layer: str, metadata: dict, sigma_px: float = 0.0, simplify_px: float = 0.0,
          smooth_cut: float = 0.5) -> dict:
    """`gauges`: dicts with `code`, `index` (uint8 band raster), `transform`, `crs`, `steps` (the stage
    of band k is steps[k-1]) and `bounds_deg` [w, s, e, n]. Writes the PMTiles file."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer
    from rasterio.transform import Affine, from_bounds
    from rasterio.warp import Resampling, reproject

    tiles: dict[int, list[dict]] = {}
    for g in gauges:
        n = len(g["steps"])
        for z in range(min_zoom, max_zoom + 1):
            factor = 2 ** (max_zoom - z)
            level = coarsen_index(g["index"], factor, min_share, n)
            level_transform = g["transform"] * Affine.scale(factor)
            size = tile_px + 2 * buffer_px
            for _, x, y in tiles_for(tuple(g["bounds_deg"]), z):
                west, south, east, north = tile_bounds(z, x, y)
                pad = (east - west) / tile_px * buffer_px
                pixels = np.zeros((size, size), dtype="uint8")
                reproject(level, pixels, src_transform=level_transform, src_crs=g["crs"], src_nodata=0,
                          dst_transform=from_bounds(west - pad, south - pad, east + pad, north + pad, size, size),
                          dst_crs="EPSG:3857", dst_nodata=0, resampling=Resampling.nearest)
                if not pixels.any():
                    continue
                polygons = tile_polygons(smooth_index(pixels, n, sigma_px, smooth_cut), buffer_px, tile_px, simplify_px)
                feats = [{"geometry": geom, "properties": {"station": g["code"], "from_m": float(g["steps"][k - 1])}}
                         for k, geom in sorted(polygons.items())]
                if feats:
                    tiles.setdefault(zxy_to_tileid(z, x, y), []).extend(feats)
    if not tiles:
        raise SystemExit("No tile has any band polygon.")
    per_zoom: dict[int, dict] = {}
    encoded: dict[int, bytes] = {}
    from pmtiles.tile import tileid_to_zxy

    for tile_id, feats in tiles.items():
        data = encode(feats, layer)
        encoded[tile_id] = data
        z = tileid_to_zxy(tile_id)[0]
        pz = per_zoom.setdefault(z, {"tiles": 0, "kb": 0.0})
        pz["tiles"] += 1
        pz["kb"] += len(data) / 1024
    for pz in per_zoom.values():
        pz["kb"] = round(pz["kb"])
    west = min(g["bounds_deg"][0] for g in gauges)
    south = min(g["bounds_deg"][1] for g in gauges)
    east = max(g["bounds_deg"][2] for g in gauges)
    north = max(g["bounds_deg"][3] for g in gauges)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        writer = Writer(f)
        for tile_id in sorted(encoded):
            writer.write_tile(tile_id, encoded[tile_id])
        writer.finalize(
            {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
             "min_lon_e7": int(west * 1e7), "min_lat_e7": int(south * 1e7), "max_lon_e7": int(east * 1e7),
             "max_lat_e7": int(north * 1e7), "center_zoom": min(max_zoom, min_zoom + 2),
             "center_lon_e7": int((west + east) / 2 * 1e7), "center_lat_e7": int((south + north) / 2 * 1e7)},
            {**metadata, "vector_layers": [{"id": layer, "minzoom": min_zoom, "maxzoom": max_zoom,
                                            "fields": {"station": "String", "from_m": "Number"}}]})
    return {"file": dest.name, "mb": round(dest.stat().st_size / 1e6, 3), "tiles": len(encoded),
            "zooms": dict(sorted(per_zoom.items()))}


def read_tile(path: Path, z: int, x: int, y: int) -> dict | None:
    from hazard.tiles import read_tile as _read

    return _read(path, z, x, y)
