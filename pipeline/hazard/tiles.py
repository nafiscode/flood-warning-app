"""The hazard classes as vector tiles in one PMTiles file, for MapLibre. No external tools.

One layer, `hazard`, with the classes Low, Medium and High as polygons (`class` 2, 3, 4 and `name`).
Minimal is not drawn: a place without a polygon is Minimal or outside the four provinces, and the app
has to say so in words (a blank map must never read as "no risk").

How a tile is made: the class raster is brought to the tile's own pixel grid, finer than the
raster's 30 m cells, the classes are smoothed there, and the edges between them become the
polygons. For the zooms above the deepest one the raster is first coarsened; a coarse cell takes
the highest class that covers at least `min_share` of it, so a narrow floodplain neither vanishes
nor swallows its surroundings.

Smoothing (owner, 12 Oct 2026: the layer looked like a grid). For each class the area "this class
or higher" is blurred by about one data cell and cut again at one half, which rounds the square
corners of the cells without moving an edge by more than about a cell; then the outlines are
simplified by a fraction of a pixel. The smooth outline is drawing, not knowledge: the data is
still one value per 30 m cell, and the layer's note in the app has to keep saying it is an estimate.
"""

from __future__ import annotations

import gzip
import logging
import math
from pathlib import Path

import numpy as np

from .classes import HIGH, LOW, MEDIUM, NAMES

log = logging.getLogger("hazard")
WORLD = 20037508.342789244          # half the width of the Web Mercator square, metres
EXTENT = 4096
DRAWN = (LOW, MEDIUM, HIGH)


def coarsen(cls: np.ndarray, factor: int, min_share: float) -> np.ndarray:
    """Blocks of `factor` x `factor` cells -> one cell: the highest class k for which the cells of
    class k or higher fill at least `min_share` of the block (0 if not even class 1 does)."""
    if factor <= 1:
        return cls
    rows, cols = (-(-cls.shape[0] // factor)) * factor, (-(-cls.shape[1] // factor)) * factor
    padded = np.zeros((rows, cols), dtype="uint8")
    padded[:cls.shape[0], :cls.shape[1]] = cls
    blocks = padded.reshape(rows // factor, factor, cols // factor, factor)
    out = np.zeros((rows // factor, cols // factor), dtype="uint8")
    for k in sorted(NAMES):                                   # 1..4: a later, higher class overwrites
        share = (blocks >= k).mean(axis=(1, 3))
        out[share >= min_share] = k
    return out


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile in Web Mercator metres."""
    size = 2 * WORLD / 2 ** z
    return -WORLD + x * size, WORLD - (y + 1) * size, -WORLD + (x + 1) * size, WORLD - y * size


def tiles_for(bounds_deg: tuple[float, float, float, float], z: int) -> list[tuple[int, int, int]]:
    """Every tile of zoom z that touches the box [west, south, east, north] in degrees."""
    def col(lon: float) -> int:
        return int(min(max((lon + 180) / 360 * 2 ** z, 0), 2 ** z - 1))

    def row(lat: float) -> int:
        r = math.radians(lat)
        return int(min(max((1 - math.asinh(math.tan(r)) / math.pi) / 2 * 2 ** z, 0), 2 ** z - 1))

    west, south, east, north = bounds_deg
    return [(z, x, y) for x in range(col(west), col(east) + 1) for y in range(row(north), row(south) + 1)]


def smooth(pixels: np.ndarray, sigma_px: float, cut: float = 0.5) -> np.ndarray:
    """The class grid with rounded edges: each area "class k or higher" is blurred and cut again, and
    a pixel's class is the highest k it still belongs to. The areas are nested and the blur is
    linear, so they stay nested. Land keeps its outline: only the classes above the lowest are
    smoothed, and nothing is drawn where there was no land.

    `cut` is where the blurred area is cut. One half would be the neutral choice for a large
    patch, but these classes are thin and speckled, and at one half a blur wears them away (High
    lost 11 % of its area and Medium 17 % in the first build). A lower cut gives that area back; it
    is set so that each class keeps its area, and erring high rather than low."""
    from scipy import ndimage

    if sigma_px <= 0:
        return pixels
    land = pixels > 0
    out = land.astype(pixels.dtype)                           # 1 on land, 0 elsewhere
    for k in sorted(NAMES)[1:]:                               # 2..4
        inside = ndimage.gaussian_filter((pixels >= k).astype("float32"), sigma_px, mode="nearest") >= cut
        out[inside & land] = k
    return out


def tile_polygons(pixels: np.ndarray, buffer_px: int, tile_px: int, simplify_px: float = 0.0) -> dict[int, object]:
    """class -> MultiPolygon in tile units (0..EXTENT, y down) from the tile's pixel grid, which
    carries `buffer_px` extra pixels on every side. `simplify_px` takes the pixel steps out of the
    outlines (a fraction of a pixel, so neighbours do not visibly part)."""
    from rasterio import features
    from rasterio.transform import Affine
    from shapely.geometry import MultiPolygon, shape

    unit = EXTENT / tile_px
    to_tile = Affine(unit, 0, -buffer_px * unit, 0, unit, -buffer_px * unit)
    parts: dict[int, list] = {}
    for geom, value in features.shapes(pixels, mask=np.isin(pixels, DRAWN), transform=to_tile):
        poly = shape(geom)
        if simplify_px > 0:
            poly = poly.simplify(simplify_px * unit, preserve_topology=True)
            if poly.is_empty:
                continue
        parts.setdefault(int(value), []).extend(poly.geoms if poly.geom_type == "MultiPolygon" else [poly])
    return {k: MultiPolygon(v) for k, v in parts.items()}


def encode(polygons: dict[int, object]) -> bytes:
    import mapbox_vector_tile

    feats = [{"geometry": geom, "properties": {"class": k, "name": NAMES[k]}} for k, geom in sorted(polygons.items())]
    raw = mapbox_vector_tile.encode([{"name": "hazard", "features": feats}],
                                    default_options={"extents": EXTENT, "y_coord_down": True})
    return gzip.compress(raw, mtime=0)


def build(class_path: Path, dest: Path, bounds_deg: tuple[float, float, float, float], *, min_zoom: int,
          max_zoom: int, tile_px: int, buffer_px: int, min_share: float, metadata: dict, sigma_px: float = 0.0,
          simplify_px: float = 0.0, smooth_cut: float = 0.5) -> dict:
    """Write the PMTiles file. Returns counts and sizes."""
    import rasterio
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer
    from rasterio.transform import Affine, from_bounds
    from rasterio.warp import Resampling, reproject

    with rasterio.open(class_path) as src:
        cls, src_transform, src_crs = src.read(1), src.transform, src.crs
    tiles: dict[int, bytes] = {}
    per_zoom = {}
    for z in range(min_zoom, max_zoom + 1):
        factor = 2 ** (max_zoom - z)
        level = coarsen(cls, factor, min_share)
        level_transform = src_transform * Affine.scale(factor)
        n = tile_px + 2 * buffer_px
        count = size = 0
        for _, x, y in tiles_for(bounds_deg, z):
            west, south, east, north = tile_bounds(z, x, y)
            pad = (east - west) / tile_px * buffer_px
            pixels = np.zeros((n, n), dtype="uint8")
            reproject(level, pixels, src_transform=level_transform, src_crs=src_crs, src_nodata=0,
                      dst_transform=from_bounds(west - pad, south - pad, east + pad, north + pad, n, n),
                      dst_crs="EPSG:3857", dst_nodata=0, resampling=Resampling.nearest)
            polygons = tile_polygons(smooth(pixels, sigma_px, smooth_cut), buffer_px, tile_px, simplify_px)
            if not polygons:
                continue
            data = encode(polygons)
            tiles[zxy_to_tileid(z, x, y)] = data
            count += 1
            size += len(data)
        per_zoom[z] = {"tiles": count, "kb": round(size / 1024)}
        log.info("zoom %d: %d tiles, %d kB", z, count, size // 1024)
    if not tiles:
        raise SystemExit("No tile has any class polygon: check the class raster and the bounds.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    west, south, east, north = bounds_deg
    with open(dest, "wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(
            {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
             "min_lon_e7": int(west * 1e7), "min_lat_e7": int(south * 1e7), "max_lon_e7": int(east * 1e7),
             "max_lat_e7": int(north * 1e7), "center_zoom": min(max_zoom, min_zoom + 3),
             "center_lon_e7": int((west + east) / 2 * 1e7), "center_lat_e7": int((south + north) / 2 * 1e7)},
            {**metadata, "vector_layers": [{"id": "hazard", "minzoom": min_zoom, "maxzoom": max_zoom,
                                            "fields": {"class": "Number", "name": "String"}}]})
    return {"file": dest.name, "mb": round(dest.stat().st_size / 1e6, 2), "tiles": len(tiles), "zooms": per_zoom}


def read_tile(path: Path, z: int, x: int, y: int) -> dict | None:
    """One tile decoded (for checks and tests): {layer: {...}} or None when the file has no such tile."""
    import mapbox_vector_tile
    from pmtiles.reader import MmapSource, Reader

    with open(path, "rb") as f:
        data = Reader(MmapSource(f)).get(z, x, y)
    return mapbox_vector_tile.decode(gzip.decompress(data)) if data else None
