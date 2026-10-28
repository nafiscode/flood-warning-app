"""The river-body layer: OSM elements -> water polygon -> vector PMTiles. Offline and synthetic:
tiny hand-made OSM elements, no network and no files from out/."""

from __future__ import annotations

from shapely.geometry import box

from hazard.tiles import tiles_for
from rivers import build, tiles

HALF = {"river": 8.0, "canal": 4.0, "stream": 2.5}


def _ring(w, s, e, n):
    """A closed way's geometry (first point repeated), in Overpass 'out geom' shape."""
    pts = [(w, s), (e, s), (e, n), (w, n), (w, s)]
    return [{"lon": lon, "lat": lat} for lon, lat in pts]


def _line(coords):
    return [{"lon": lon, "lat": lat} for lon, lat in coords]


def test_collect_splits_areas_from_waterway_lines():
    elements = [
        {"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": _ring(101.30, 6.50, 101.31, 6.51)},
        {"type": "way", "id": 2, "tags": {"waterway": "river"}, "geometry": _line([(101.32, 6.50), (101.34, 6.51)])},
        {"type": "way", "id": 3, "tags": {"waterway": "riverbank"}, "geometry": _ring(101.35, 6.50, 101.36, 6.51)},
    ]
    areas, lines = build.collect(elements, HALF)
    assert len(areas) == 2                      # the lake and the (closed) riverbank are areas
    assert len(lines) == 1 and lines[0][1] == 8.0   # the river centreline is a line at the river half-width


def test_water_mercator_unions_areas_and_buffered_lines():
    elements = [
        {"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": _ring(101.30, 6.50, 101.305, 6.505)},
        {"type": "way", "id": 2, "tags": {"waterway": "river"}, "geometry": _line([(101.32, 6.50), (101.34, 6.50)])},
    ]
    water = build.water_mercator(elements, HALF, min_part_m2=50.0)
    assert not water.is_empty and water.area > 0
    # The 2 km river line buffered by 8 m each side is ~32 000 m2, far above the 50 m2 floor.
    assert water.area > 10_000


def test_build_writes_a_readable_pmtiles(tmp_path):
    elements = [
        {"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": _ring(101.30, 6.50, 101.32, 6.52)},
        {"type": "way", "id": 2, "tags": {"waterway": "canal"}, "geometry": _line([(101.31, 6.50), (101.33, 6.53)])},
    ]
    water = build.water_mercator(elements, HALF, min_part_m2=50.0)
    bounds_deg = (101.29, 6.49, 101.34, 6.54)
    dest = tmp_path / "river-body_test.pmtiles"
    stats = tiles.build(water, bounds_deg, dest, min_zoom=11, max_zoom=13, layer="river",
                        metadata={"name": "test"}, simplify_px=0.4)
    assert dest.is_file() and stats["tiles"] > 0
    got = [tiles.read_tile(dest, z, x, y) for z, x, y in tiles_for(bounds_deg, 13)]
    decoded = [t for t in got if t]
    assert decoded, "no tile decoded at zoom 13"
    assert any("river" in t for t in decoded)


def test_build_refuses_when_nothing_is_in_the_box(tmp_path):
    # Water in Yala, bounds over the sea off the coast: no tile has a polygon.
    water = build.water_mercator(
        [{"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": _ring(101.30, 6.50, 101.31, 6.51)}],
        HALF, min_part_m2=50.0)
    assert box(*water.bounds).area > 0
    try:
        tiles.build(water, (90.0, 1.0, 90.1, 1.1), tmp_path / "empty.pmtiles",
                    min_zoom=11, max_zoom=12, layer="river", metadata={})
    except SystemExit:
        return
    raise AssertionError("build should raise SystemExit when no tile has water")
