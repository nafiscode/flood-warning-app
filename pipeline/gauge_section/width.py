"""How wide the river is at a gauge, measured across the water OpenStreetMap has digitised.

The measurement, for one station:

  1. Find the nearest waterway **centreline** (`waterway=river|canal|stream`) within
     `max_reach_m`. It gives the direction of the channel there; a station sits on the bank, not
     in the water, so its own point cannot give one.
  2. Use only the water **areas** OSM has digitised - `natural=water`, `water=*`,
     `waterway=riverbank`, `landuse=reservoir`. The buffered centrelines the river-body layer
     draws for narrow channels are a drawing with a made-up half-width (rivers/METHODS.md: "the
     true width is unknown"), so a station whose river OSM maps only as a line gets **no width at
     all** rather than a width of 16 m that nobody measured.
  3. Cast a transect across the channel at the nearest point on the centreline, perpendicular to
     the line there, and take the length of the piece of water that point falls in.
  4. Do that at five places a little way apart along the line and take the **median**, so one
     junction, one jetty or one ox-bow cannot decide the answer.

What the number is: the width of the water surface OSM's mappers digitised, from imagery taken at
an unknown river level. It is not the bank-to-bank width and it is not a survey. The app says so.
"""

from __future__ import annotations

import logging
import math

from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

log = logging.getLogger("gauge_section")


def scale(lat_deg: float) -> float:
    """Mercator metres are stretched by 1/cos(latitude); every length is corrected by this."""
    return math.cos(math.radians(lat_deg))


class Water:
    """The OSM water of the four provinces, ready to be asked about one point at a time."""

    def __init__(self, areas: list, centrelines: list[LineString]):
        self.areas = areas
        self.centrelines = centrelines
        self.area_tree = STRtree(areas) if areas else None
        self.line_tree = STRtree(centrelines) if centrelines else None

    def near_areas(self, point: Point, reach: float):
        if self.area_tree is None:
            return None
        found = [self.areas[int(i)] for i in self.area_tree.query(point.buffer(reach))]
        return unary_union(found) if found else None

    def near_lines(self, point: Point, reach: float) -> list[LineString]:
        if self.line_tree is None:
            return []
        found = [self.centrelines[int(i)] for i in self.line_tree.query(point.buffer(reach))]
        return [c for c in found if c.distance(point) <= reach]


def prepare(elements: list[dict], half_width_m: dict[str, float]) -> Water:
    """The rivers module's OSM cache, as areas and centrelines in EPSG:3857."""
    from pyproj import Transformer
    from shapely.ops import transform

    from rivers.build import collect

    to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
    areas, lines = collect(elements, half_width_m)
    # The areas as they were digitised; the buffered lines are deliberately left out (see above).
    area_parts = [transform(to_merc, a) for a in areas if not a.is_empty]
    centre = [transform(to_merc, line) for line, _half in lines if line.length > 0]
    log.info("water: %d digitised areas, %d centrelines", len(area_parts), len(centre))
    return Water(area_parts, centre)


def _tangent(line: LineString, distance: float) -> tuple[float, float]:
    """The line's direction a little either side of `distance` along it, as a unit vector."""
    step = min(25.0, max(line.length / 20, 1.0))
    a = line.interpolate(max(distance - step, 0))
    b = line.interpolate(min(distance + step, line.length))
    dx, dy = b.x - a.x, b.y - a.y
    norm = math.hypot(dx, dy)
    return (1.0, 0.0) if norm == 0 else (dx / norm, dy / norm)


def _across(water, line: LineString, distance: float, reach_m: float) -> float | None:
    """The width of the water across the channel at `distance` along `line`, Mercator metres."""
    here = line.interpolate(distance)
    dx, dy = _tangent(line, distance)
    transect = LineString([(here.x + dy * reach_m, here.y - dx * reach_m),
                           (here.x - dy * reach_m, here.y + dx * reach_m)])
    wet = transect.intersection(water)
    if wet.is_empty:
        return None
    pieces = [p for p in (wet.geoms if isinstance(wet, MultiLineString) else [wet])
              if isinstance(p, LineString) and p.length > 0]
    if not pieces:
        return None
    # The piece the channel itself is in, not another branch the transect happens to cross.
    piece = min(pieces, key=lambda p: p.distance(here))
    return piece.length if piece.distance(here) <= 5.0 else None


def measure(water: Water, point: Point, lat_deg: float, *, max_reach_m: float = 150.0,
            transect_m: float = 2000.0, step_m: float = 40.0, samples: int = 5,
            least_samples: int = 3) -> dict | None:
    """The river's width at one station, in true metres, or None when it cannot be measured.

    `point` is the station in EPSG:3857. None means exactly that - not known - and the app then
    draws its own schematic channel and says the width is not known.
    """
    k = scale(lat_deg)
    reach = max_reach_m / k
    lines = water.near_lines(point, reach)
    if not lines:
        return None
    line = min(lines, key=lambda c: c.distance(point))
    here = water.near_areas(point, reach)
    if here is None or here.distance(point) > reach:
        # The station's river is mapped as a centreline only: no digitised width to measure.
        return None
    # A window of water wide enough for the transect, so one point's measurement is local.
    window = water.near_areas(point, transect_m / k)
    at = line.project(point)
    widths, places = [], []
    for i in range(samples):
        offset = (i - (samples - 1) / 2) * (step_m / k)
        d = at + offset
        if d < 0 or d > line.length:
            continue
        w = _across(window, line, d, transect_m / k)
        if w is not None:
            widths.append(w * k)
            places.append(round(offset * k))
    # A median of one is not a median: a station whose transects mostly found no water is one the
    # mapping cannot answer for, and it is left without a width.
    if len(widths) < least_samples:
        return None
    widths.sort()
    mid = len(widths) // 2
    median = widths[mid] if len(widths) % 2 else (widths[mid - 1] + widths[mid]) / 2
    return {
        "width_m": round(median, 1),
        "samples": len(widths),
        "spread_m": round(widths[-1] - widths[0], 1),
        "offsets_m": places,
        "line_distance_m": round(line.distance(point) * k, 1),
        "area_distance_m": round(here.distance(point) * k, 1),
    }
