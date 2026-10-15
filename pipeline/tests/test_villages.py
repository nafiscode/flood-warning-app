"""The hazard classes per village (hazard/villages.py)."""

import numpy as np
import shapely
from affine import Affine

from hazard import villages


def test_names_match_without_prefix_brackets_or_spaces():
    assert villages.norm_name("บ้านยามูแรแน (บือราแง)") == "ยามูแรแน"
    assert villages.norm_name("บ. ควนนา") == "ควนนา"
    assert villages.norm_name("บ้าน ทุ่ง รี") == "ทุ่งรี"
    assert villages.norm_name(None) == ""


def test_the_2012_layer_wins_where_it_has_points_and_osm_fills_the_rest():
    dopa = [{"id": "v12:1", "name_th": "บ้านก", "tambon": "940101", "public": False}]
    osm = [{"id": "osm:1", "name_th": "บ้านข", "tambon": "940101"},
           {"id": "osm:2", "name_th": "บ้านค", "tambon": "940102"},
           {"id": "osm:3", "name_th": "บ้านง", "tambon": None}]
    chosen = villages.choose(dopa, osm)
    assert [(c["id"], c["source"], c["public"]) for c in chosen] == [
        ("v12:1", "dopa2012", False), ("osm:2", "osm", True)]


def test_a_2012_village_osm_also_has_nearby_is_public_with_osm_names():
    crs = "EPSG:32647"
    dopa = [{"id": "v12:1", "name_th": "บ้านยูโย", "lon": 101.27, "lat": 6.88},
            {"id": "v12:2", "name_th": "บ้านไกล", "lon": 101.30, "lat": 6.90}]
    osm = [{"id": "osm:9", "name_th": "ยูโย", "name_en": "Ban Yuyo", "lon": 101.275, "lat": 6.88},
           {"id": "osm:8", "name_th": "บ้านไกล", "name_en": None, "lon": 101.40, "lat": 6.90}]
    assert villages.match_osm(dopa, osm, crs, 1500) == 1
    assert dopa[0]["public"] and dopa[0]["name_en"] == "Ban Yuyo" and dopa[0]["osm_id"] == "osm:9"
    assert dopa[1]["public"] is False   # same name, but 11 km away


def test_each_cell_goes_to_the_nearest_village_of_its_tambon():
    # A 4 x 6 grid of 30 m cells; two villages at the left and right ends; all of it one tambon.
    transform = Affine(30, 0, 500000, 0, -30, 760000)
    cls = np.array([[1, 1, 4, 4, 3, 3]] * 4, dtype="uint8")
    buildings = np.ones((4, 6), dtype="float32")
    from pyproj import Transformer
    to_ll = Transformer.from_crs("EPSG:32647", "EPSG:4326", always_xy=True)
    lon0, lat0 = to_ll.transform(500015, 759940)
    lon1, lat1 = to_ll.transform(500165, 759940)
    box = shapely.box(*to_ll.transform(499990, 759870), *to_ll.transform(500190, 760010))
    tambon = {"code": "940101", "geometry": box}
    vs = [{"tambon": "940101", "lon": lon0, "lat": lat0}, {"tambon": "940101", "lon": lon1, "lat": lat1}]
    rows = villages.summarise(vs, [tambon], cls, buildings, transform, "EPSG:32647", 0.0009,
                              lambda t, r, c: np.ones((r[1] - r[0], c[1] - c[0]), dtype=bool))
    # Left village: columns 0-2 (minimal, minimal, high); right: columns 3-5 (high, medium, medium).
    assert rows[0]["buildings"] == 12 and rows[0]["high_buildings"] == 4 and rows[0]["minimal_buildings"] == 8
    assert rows[1]["high_buildings"] == 4 and rows[1]["medium_buildings"] == 8
    assert rows[1]["buildings_medium_or_high_pct"] == 100.0
    assert rows[0]["buildings_medium_or_high_pct"] == round(100 * 4 / 12, 1)


def test_the_seed_quotes_names_and_replaces_the_table():
    vs = [{"id": "v12:1", "source": "dopa2012", "public": False, "tambon": "940101", "name_th": "บ้านโต๊ะ'ยา",
           "lon": 101.27, "lat": 6.88}]
    rows = [{"land_km2": 1.0, "buildings": 5, "high_buildings": 1, "medium_buildings": 1, "low_buildings": 1,
             "minimal_buildings": 2, "buildings_medium_or_high_pct": 40.0}]
    sql = villages.seed_sql(vs, rows, "c97e0bf")
    assert "delete from public.villages;" in sql
    assert "'บ้านโต๊ะ''ยา'" in sql and "false" in sql and "st_makepoint(101.270000, 6.880000)" in sql
