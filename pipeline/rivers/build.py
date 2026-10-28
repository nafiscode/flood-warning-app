"""Turn the OSM water into one polygon for the river-body tiles.

Closed ways and multipolygon relations are the water areas; `waterway=river|canal|stream` lines are
buffered by a half-width so the narrow channels OSM maps only as a centreline still show. Everything
is unioned in Web Mercator (EPSG:3857) metres, which is also the tiles' own projection; at this
latitude the Web Mercator metre is stretched by under a percent, which does not matter for a context
layer. The polygon/relation stitching is reused from dam_release/osm.py. Data (c) OpenStreetMap, ODbL.
"""

from __future__ import annotations

import logging

from shapely.geometry import LineString, MultiPolygon
from shapely.ops import transform, unary_union

from dam_release.osm import relation_polygon, way_polygon

log = logging.getLogger("rivers")

LINE_CLASSES = ("river", "canal", "stream")


def _closed(el: dict) -> bool:
    g = el.get("geometry") or []
    return len(g) >= 4 and g[0] == g[-1]


def collect(elements: list[dict], half_width_m: dict[str, float]):
    """-> (list of area MultiPolygons in 4326, list of (LineString in 4326, half-width m))."""
    areas, lines = [], []
    for el in elements:
        tags = el.get("tags") or {}
        waterway = tags.get("waterway")
        if el["type"] == "relation":
            try:
                areas.append(relation_polygon(el))
            except Exception as err:                       # a relation that does not close is not an area
                log.debug("relation %s skipped: %s", el.get("id"), err)
        elif waterway in LINE_CLASSES and not _closed(el):
            pts = [(p["lon"], p["lat"]) for p in el.get("geometry") or []]
            if len(pts) >= 2:
                lines.append((LineString(pts), half_width_m.get(waterway, half_width_m["stream"])))
        else:
            try:
                areas.append(way_polygon(el))
            except Exception as err:                       # an open way that is not a line class: skip it
                log.debug("way %s skipped: %s", el.get("id"), err)
    return areas, lines


def _drop_small(geom, min_m2: float):
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    kept = [p for p in polys if p.area >= min_m2]
    return MultiPolygon(kept) if kept else geom


def water_mercator(elements: list[dict], half_width_m: dict[str, float], min_part_m2: float):
    """One (Multi)Polygon of all the water, in EPSG:3857 metres, ready to tile."""
    from pyproj import Transformer

    to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
    areas, lines = collect(elements, half_width_m)
    parts = [transform(to_merc, a) for a in areas]
    for line, half in lines:
        parts.append(transform(to_merc, line).buffer(half, cap_style=1, join_style=1))
    if not parts:
        raise SystemExit("No water in the OSM cache: run `rivers fetch` first.")
    water = _drop_small(unary_union(parts), min_part_m2)
    log.info("water: %d area + %d line features -> %.1f km2", len(areas), len(lines), water.area / 1e6)
    return water
