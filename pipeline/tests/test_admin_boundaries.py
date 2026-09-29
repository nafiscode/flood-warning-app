"""Offline tests for admin_boundaries: coverage simplification keeps neighbours seamless."""

import geopandas as gpd
import shapely
from shapely.geometry import MultiPolygon, Polygon

from admin_boundaries.__main__ import as_multipolygon, coverage_simplify, sql_str, wkt


def wiggly_square(x0: float) -> Polygon:
    # Two unit squares sharing the edge x = x0 + 1, with many tiny vertices along every side.
    n = 200
    bottom = [(x0 + i / n, 0 + (0.00001 if i % 2 else 0)) for i in range(n)]
    right = [(x0 + 1, i / n) for i in range(n)]
    top = [(x0 + 1 - i / n, 1) for i in range(n)]
    left = [(x0, 1 - i / n) for i in range(n)]
    return Polygon(bottom + right + top + left)


def test_coverage_simplify_keeps_shared_borders_identical():
    gdf = gpd.GeoDataFrame(geometry=[wiggly_square(0), Polygon([(1, 0), (2, 0), (2, 1), (1, 1)])], crs=4326)
    out = coverage_simplify(gdf, 0.001)
    a, b = out.iloc[0], out.iloc[1]
    assert isinstance(a, MultiPolygon) and isinstance(b, MultiPolygon)
    assert shapely.get_num_coordinates(a) < shapely.get_num_coordinates(gdf.geometry.iloc[0])
    assert a.intersection(b).area < 1e-12  # no overlap
    assert abs(shapely.union_all([a, b]).area - 2.0) < 1e-3  # no gap


def test_as_multipolygon_repairs_and_wraps():
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])  # self-intersecting
    fixed = as_multipolygon(bowtie)
    assert fixed.is_valid and fixed.geom_type == "MultiPolygon"


def test_sql_escaping_and_wkt_precision():
    assert sql_str("Ban Na'Kha") == "'Ban Na''Kha'"
    out = wkt(MultiPolygon([Polygon([(101.123456789, 6.1), (101.2, 6.1), (101.2, 6.2)])]))
    assert out == "MULTIPOLYGON (((101.12346 6.1, 101.2 6.1, 101.2 6.2, 101.12346 6.1)))"
