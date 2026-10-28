"""The river-body polygon as one PMTiles file, vector tiles for MapLibre, no external tools.

The geometry comes in Web Mercator metres (EPSG:3857). For each tile it is clipped to the tile
(plus a small buffer) and its metres are mapped to the tile's own 0..EXTENT grid with y running
down, the way hazard/tiles.py encodes its polygons. Pure Python: pmtiles + mapbox-vector-tile.
One layer, no properties: every piece is water, drawn in one colour.
"""

from __future__ import annotations

import gzip
import logging
from pathlib import Path

from hazard.tiles import EXTENT, WORLD, tile_bounds, tiles_for

log = logging.getLogger("rivers")


def _polys(geom) -> list:
    """Flatten a geometry to its polygon pieces (a clip can leave points or lines on an edge)."""
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        out = []
        for g in geom.geoms:
            out += _polys(g)
        return out
    return []


def encode(geoms: list, layer: str) -> bytes:
    import mapbox_vector_tile

    feats = [{"geometry": g, "properties": {}} for g in geoms]
    raw = mapbox_vector_tile.encode([{"name": layer, "features": feats}],
                                    default_options={"extents": EXTENT, "y_coord_down": True})
    return gzip.compress(raw, mtime=0)


def build(geom_merc, bounds_deg, dest: Path, *, min_zoom: int, max_zoom: int, layer: str, metadata: dict,
          simplify_px: float = 0.4, buffer_frac: float = 0.05) -> dict:
    """Write the PMTiles file from a (Multi)Polygon in EPSG:3857 metres. Returns counts and sizes."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer
    from shapely.affinity import affine_transform
    from shapely.geometry import box
    from shapely.prepared import prep

    tiles: dict[int, bytes] = {}
    per_zoom = {}
    for z in range(min_zoom, max_zoom + 1):
        tile_m = 2 * WORLD / 2 ** z
        tol = tile_m / EXTENT * simplify_px
        g = geom_merc.simplify(tol, preserve_topology=True) if tol > 0 else geom_merc
        if g.is_empty:
            per_zoom[z] = {"tiles": 0, "kb": 0}
            continue
        ready = prep(g)
        count = size = 0
        for _, x, y in tiles_for(bounds_deg, z):
            west, south, east, north = tile_bounds(z, x, y)
            pad = tile_m * buffer_frac
            clip = box(west - pad, south - pad, east + pad, north + pad)
            if not ready.intersects(clip):
                continue
            geoms = _polys(g.intersection(clip))
            if not geoms:
                continue
            s = EXTENT / tile_m
            matrix = [s, 0, 0, -s, -s * west, s * north]   # mercator metres -> tile units (0..EXTENT), y down
            data = encode([affine_transform(gm, matrix) for gm in geoms], layer)
            tiles[zxy_to_tileid(z, x, y)] = data
            count += 1
            size += len(data)
        per_zoom[z] = {"tiles": count, "kb": round(size / 1024)}
        log.info("zoom %d: %d tiles, %d kB", z, count, size // 1024)
    if not tiles:
        raise SystemExit("No tile has any water polygon: check the build and the bounds.")
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
            {**metadata, "vector_layers": [{"id": layer, "minzoom": min_zoom, "maxzoom": max_zoom, "fields": {}}]})
    return {"file": dest.name, "mb": round(dest.stat().st_size / 1e6, 3), "tiles": len(tiles), "zooms": per_zoom}


def read_tile(path: Path, z: int, x: int, y: int) -> dict | None:
    from hazard.tiles import read_tile as _read

    return _read(path, z, x, y)
