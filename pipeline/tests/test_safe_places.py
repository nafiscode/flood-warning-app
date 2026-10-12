"""S4: candidates, the road search, the terrain features and the score. No network, no rasters."""

import json

import numpy as np
import pytest
from rasterio.transform import from_origin

from safe_places import features, osm, roads, score
from safe_places.__main__ import seed_sql, table_row

CFG = {"freeboard": {"full_score_m": 5.0, "low_m": 0.5},
       "weights": {"freeboard": 0.35, "not_flooded_often": 0.20, "route_dry": 0.25, "travel_time": 0.10, "capacity": 0.10},
       "flags": {"radar_flood": True, "low_ground": True, "flood_frequency_over": 0.02, "route_dry_under": 0.5}}


def test_candidates_are_typed_named_and_taken_once():
    assert osm.classify({"amenity": "place_of_worship", "religion": "muslim"}) == "mosque"
    assert osm.classify({"amenity": "place_of_worship", "religion": "buddhist"}) == "temple"
    assert osm.classify({"amenity": "place_of_worship", "religion": "christian"}) == "other"
    assert osm.classify({"building": "mosque"}) == "mosque" and osm.classify({"amenity": "college"}) == "school"
    assert osm.classify({"office": "government"}) == "government" and osm.classify({"amenity": "cafe"}) is None
    assert osm.names({"name": "โรงเรียนบ้านท่าสาป", "name:en": "Ban Tha Sap School"}) == {
        "th": "โรงเรียนบ้านท่าสาป", "en": "Ban Tha Sap School"}
    assert osm.names({"name": "Masjid Jamek"}) == {"en": "Masjid Jamek"} and osm.names({}) == {}
    found = osm.pois([
        {"type": "node", "id": 1, "lat": 6.5, "lon": 101.2, "tags": {"amenity": "school", "name": "A"}},
        {"type": "node", "id": 1, "lat": 6.5, "lon": 101.2, "tags": {"amenity": "school", "name": "A"}},      # twice
        {"type": "way", "id": 2, "center": {"lat": 6.6, "lon": 101.3}, "tags": {"building": "mosque", "name": "B"}},
        {"type": "node", "id": 3, "lat": 6.7, "lon": 101.4, "tags": {"amenity": "school"}},                     # no name
        {"type": "node", "id": 4, "lat": 6.7, "lon": 101.4, "tags": {"amenity": "cafe", "name": "C"}},         # not a candidate
    ])
    assert [(p["osm"], p["type"]) for p in found] == [("node/1", "school"), ("way/2", "mosque")]
    assert found[1]["lat"] == 6.6
    assert list(osm.tiles((100.1, 6.2, 100.9, 6.6))) == [(100.0, 6.0), (100.5, 6.0), (100.0, 6.5), (100.5, 6.5)]
    from shapely.geometry import box

    quarter = list(osm.tiles((100.1, 6.2, 100.9, 6.6), 0.25, box(100.3, 6.3, 100.4, 6.4)))
    assert quarter == [(100.25, 6.25)]                                  # only the tile the area touches


def _graph():
    """A straight road A-B-C-D of 300 m pieces with a footpath D-E; B-C is a ford, C-D a bridge."""
    elements = [
        {"id": 10, "nodes": [1, 2, 3], "geometry": [{"lon": 0, "lat": 0}, {"lon": 300, "lat": 0}, {"lon": 600, "lat": 0}],
         "tags": {"highway": "residential"}},
        {"id": 11, "nodes": [3, 4], "geometry": [{"lon": 600, "lat": 0}, {"lon": 900, "lat": 0}],
         "tags": {"highway": "residential", "bridge": "yes"}},
        {"id": 12, "nodes": [4, 5], "geometry": [{"lon": 900, "lat": 0}, {"lon": 900, "lat": 300}], "tags": {"highway": "footway"}},
        {"id": 13, "nodes": [6, 7], "geometry": [{"lon": 0, "lat": 900}, {"lon": 9, "lat": 900}], "tags": {"highway": "proposed"}},
        {"id": 14, "nodes": [8], "geometry": [{"lon": 0, "lat": 0}], "tags": {"highway": "service"}},            # one point: no way
    ]
    return osm.road_arrays(elements)


def test_the_road_search_respects_time_mode_and_flooded_roads(tmp_path):
    arrays = _graph()
    assert arrays["way_id"].tolist() == [10, 11, 12, 13] and arrays["bridge"].tolist() == [False, True, False, False]
    np.savez_compressed(tmp_path / "roads_a.npz", **arrays)
    np.savez_compressed(tmp_path / "roads_b.npz", **arrays)                                    # the same ways in a second tile
    ways = roads.load_tiles([tmp_path / "roads_a.npz", tmp_path / "roads_b.npz"], ["proposed"])
    assert ways["way_id"].tolist() == [10, 11, 12]
    g = roads.build(ways, lambda lon, lat: (np.asarray(lon, float), np.asarray(lat, float)), ["motorway"], ["footway"])
    assert g.nodes == 5 and len(g.to) == 8 and g.length_m.tolist() == [300.0] * 8
    node = {tuple(xy): i for i, xy in enumerate(g.xy.tolist())}
    a, b, c, d, e = (node[p] for p in ((0.0, 0.0), (300.0, 0.0), (600.0, 0.0), (900.0, 0.0), (900.0, 300.0)))
    on_foot = roads.reach(g, a, 1000, 1.0, g.walk, dry=False)
    assert on_foot == {a: 0.0, b: 300.0, c: 600.0, d: 900.0}                                   # E is 1,200 s away
    assert set(roads.reach(g, a, 5000, 1.0, g.drive, dry=False)) == {a, b, c, d}              # no driving on the footpath
    # Flood over B-C and over the bridge C-D: the first is cut, the bridge stays open.
    flood = np.zeros((40, 40), dtype=bool)
    flood[:, 14:28] = True                                                                     # x from 420 to 840
    transform = from_origin(0, 600, 30, 30)
    assert roads.mark_flooded(g, flood, transform) == 2                                        # B-C, both directions
    touch = np.zeros((40, 40), dtype=bool)
    touch[:, 19:21] = True                                                                     # only B-C's middle is wet
    assert roads.mark_flooded(g, touch, transform) == 0                                        # one point of three: a culvert
    assert roads.mark_flooded(g, flood, transform) == 2
    assert set(roads.reach(g, a, 5000, 1.0, g.walk, dry=True)) == {a, b}
    assert set(roads.reach(g, d, 5000, 1.0, g.walk, dry=True)) == {d, c, e}
    houses = np.zeros(g.nodes)
    houses[[a, b, c, d]] = [10, 20, 30, 40]
    got = roads.served(g, a, 5000, 1.0, g.walk, houses)
    assert got == {"houses": 100, "houses_dry": 30, "route_dry": 0.3, "mean_minutes_dry": pytest.approx(3.3, abs=0.05)}
    assert roads.served(g, -1, 5000, 1.0, g.walk, houses)["route_dry"] is None                 # a site off the network

    from scipy.spatial import cKDTree

    near = roads.nearest(cKDTree(g.xy), np.array([[290.0, 5.0], [5000.0, 5000.0]]), 100)
    assert near.tolist() == [b, -1]


def test_freeboard_comes_from_the_flood_edge_and_parking_is_spaced():
    flood = np.zeros((5, 5), dtype=bool)
    flood[2, 1:4] = True
    land = np.ones((5, 5), dtype=bool)
    land[3, :] = False                                                                         # the sea below the flood
    edge = features.flood_edge(flood, land)
    assert edge.sum() == 3 and edge[2, 2]                                                      # dry land above each cell
    assert not features.flood_edge(flood, np.zeros((5, 5), dtype=bool)).any()                  # no dry land, no edge
    xy = np.array([[0.0, 0.0], [30.0, 0.0], [60.0, 0.0], [5000.0, 0.0]])
    surface = features.water_surface(xy, np.array([2.0, 3.0, 4.0, 50.0]), np.array([[30.0, 10.0], [90000.0, 0.0]]), 3, 2000)
    assert surface[0] == 3.0 and np.isnan(surface[1])
    value, basis = features.freeboard(np.array([5.0, 6.0, np.nan]), np.array([3.0, np.nan, 1.0]))
    assert value[:2].tolist() == [2.0, 6.0] and np.isnan(value[2])
    assert basis.tolist() == ["flood_edge", "stream", "unknown"]
    speck = np.zeros((6, 6), dtype=bool)
    speck[0, 0] = True
    speck[3:6, 3:6] = True
    kept = features.keep_patches(speck, 4)
    assert not kept[0, 0] and kept[3:6, 3:6].all() and features.keep_patches(speck, 1) is speck
    t = from_origin(0, 300, 30, 30)
    r, c, inside = features.cell(t, np.array([45.0, -5.0]), np.array([285.0, 10.0]), (10, 10))
    assert (r[0], c[0], bool(inside[0]), bool(inside[1])) == (0, 1, True, False)
    assert features.sample(np.arange(100.0).reshape(10, 10), r, c, inside).tolist()[0] == 1.0
    assert features.box_sum(np.ones((4, 4)), 1)[1, 1] == 9 and features.box_sum(np.ones((4, 4)), 1)[0, 0] == 4
    ok = np.ones((10, 10), dtype=bool)
    weight = np.zeros((10, 10))
    weight[0, 0], weight[0, 1], weight[9, 9], weight[0, 9] = 9, 8, 7, 6
    tambon = np.ones((10, 10), dtype="uint16")
    tambon[:, 5:] = 2
    picked = features.pick_parking(ok, weight, tambon, 2, 5)
    assert picked[:2] == [(0, 0), (5, 0)] or picked[0] == (0, 0)                               # (0, 1) is too close to (0, 0)
    assert (0, 1) not in picked and (9, 9) in picked and (0, 9) in picked
    assert features.pick_parking(np.zeros((3, 3), dtype=bool), np.zeros((3, 3)), np.ones((3, 3), dtype="uint16"), 3, 1) == []
    # A cell already taken (a highway point) keeps the terrain picks at a distance in its own tambon only.
    again = features.pick_parking(ok, weight, tambon, 2, 5, taken=[(0, 2)])
    assert (0, 0) not in again and (0, 1) not in again and (9, 9) in again


def test_the_score_leaves_out_what_is_unknown_and_flags_never_remove_a_site():
    site = {"freeboard_m": 2.5, "flood_freq": 0.1, "route_dry": 0.8, "mean_minutes_dry": 15.0, "capacity": None,
            "flooded_2024": True, "flooded_2025": False, "houses": 400, "freeboard_basis": "flood_edge", "radar_blind": False}
    parts = score.components(site, CFG, 30)
    assert parts == {"freeboard": 0.5, "not_flooded_often": 0.9, "route_dry": 0.8, "travel_time": 0.5, "capacity": None}
    total, missing = score.total(parts, CFG["weights"])
    assert missing == ["capacity"]
    assert total == pytest.approx((0.35 * 0.5 + 0.20 * 0.9 + 0.25 * 0.8 + 0.10 * 0.5) / 0.90, abs=0.001)
    assert score.flags(site, CFG) == ["radar_flood", "floods_often"]
    low = {"freeboard_m": -1.0, "flood_freq": None, "route_dry": 0.2, "mean_minutes_dry": None, "houses": None,
           "freeboard_basis": "stream", "radar_blind": True}
    assert score.components(low, CFG, 30)["freeboard"] == 0.0
    assert score.flags(low, CFG) == ["low_ground", "route_cut", "no_road_mapped", "no_flood_edge_near"]
    assert score.total({k: None for k in CFG["weights"]}, CFG["weights"])[0] is None
    assert score.components({"freeboard_m": 99.0, "capacity": 5000}, CFG, 30)["freeboard"] == 1.0
    assert score.flags({"fill_m": 2.0, "houses": 10}, CFG) == ["highway_shoulder"]


def test_the_table_row_starts_unverified_and_the_seed_only_replaces_its_own_rows():
    s = {"name": {"th": "มัสยิด", "en": "It's a mosque"}, "type": "mosque", "lon": 101.25, "lat": 6.87, "tambon": "940101",
         "elevation_m": 4.2, "freeboard_m": None, "flood_freq": 0.0, "flooded_2024": False, "flooded_2025": True, "score": 0.61,
         "score_components": {"parts": {}, "flags": ["radar_flood"]}, "capacity": None, "parking": False, "source": "osm",
         "osm": "node/7"}
    row = table_row(s)
    assert row["verification_status"] == "unverified" and row["status"] == "unknown"
    assert row["facilities"] == {"source": "osm", "osm": "node/7"}
    sql = seed_sql([s])
    assert "delete from public.safe_places where verification_status = 'unverified'" in sql
    assert "facilities->>'source' in ('osm', 'jaga-terrain', 'jaga-highway', 'official-list')" in sql
    assert "It''s a mosque" in sql and "st_makepoint(101.25, 6.87)" in sql and ", null, " in sql
    assert json.loads(sql.split("'::jsonb")[0].split("('")[-1].replace("''", "'"))["th"] == "มัสยิด"
    assert "insert into" not in seed_sql([])
