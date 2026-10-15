"""Module 8 part 2: highway lines, their two sides, drainage crossings, the score. Synthetic, no network."""

import numpy as np
import pytest
from scipy.spatial import cKDTree

from highway_paths import crossings, lines, osm, rasters, score
from highway_paths.__main__ import group_counts, ranked

CFG = {
    "crossings": {"min_catchment_km2": 1.0, "opening_m": 100},
    "score": {"asymmetry": {"weight": 0.35, "full_at": 0.25}, "seasons": {"weight": 0.15, "full_at": 4},
              "persistence": {"weight": 0.20, "full_at": 0.05}, "crossing": {"weight": 0.15, "full_at_km2": 100},
              "no_opening": {"weight": 0.15}, "unclear_upstream_factor": 0.5},
    "classes": {"look_first": {"min_score": 0.55, "min_seasons_up": 2},
                "worth_a_look": {"min_score": 0.30, "min_asymmetry": 0.02, "min_persistence": 0.01}},
}


def fig(**kw):
    base = {"upstream": 0, "upstream_agree": True, "asymmetry": 0.0, "seasons_seen": 9, "seasons_up": 0, "seasons_down": 0,
            "persistence": 0.0, "passes_seen": 300, "passes_up": 0, "passes_down": 0, "crossing_km2": None,
            "crossing_opening_m": None, "crossing_opening": None}
    base.update(kw)
    return base


def test_ways_are_joined_end_to_end_and_stop_at_a_junction():
    # 1 -> 2 -> 3 (second way drawn backwards), then a junction at 3 where two ways leave.
    starts, ends = [1, 3, 3, 3], [2, 2, 4, 5]
    chains = lines.join_ways(starts, ends)
    flat = sorted(w for c in chains for w, _ in c)
    assert flat == [0, 1, 2, 3]                                   # every way exactly once
    first = next(c for c in chains if any(w == 0 for w, _ in c))
    assert [w for w, _ in first] == [0, 1] and first[1][1] is True   # way 1 reversed to follow way 0
    assert all(len(c) == 1 for c in chains if c is not first)       # three ways meet at node 3: no joining there


def test_chains_keep_the_way_and_bridge_of_each_segment():
    ways = {"node": np.array([1, 2, 2, 3, 3, 4]), "count": np.array([2, 2, 2]), "bridge": np.array([False, True, False]),
            "kind": np.array(["trunk"] * 3)}
    x = np.array([0.0, 100, 100, 130, 130, 500])
    y = np.zeros(6)
    (chain,) = lines.build_chains(ways, np.ones(3, bool), x, y)
    assert chain.xy[:, 0].tolist() == [0, 100, 130, 500]
    assert chain.way.tolist() == [0, 1, 2] and chain.bridge.tolist() == [False, True, False]


def test_sections_are_cut_with_short_end_pieces_joined():
    assert lines.cut_points(1200, 500, 150).tolist() == [0, 500, 1000, 1200]
    assert lines.cut_points(1100, 500, 150).tolist() == [0, 500, 1100]
    assert lines.cut_points(300, 500, 150).tolist() == [0, 300]
    xy = np.array([[0.0, 0], [100, 0], [100, 100]])
    p = lines.piece(xy, lines.along(xy), 50, 150)
    assert p.tolist() == [[50, 0], [100, 0], [100, 50]]


def test_side_points_are_left_and_right_and_not_across_another_highway():
    road = np.array([[0.0, 0], [200, 0]])                         # eastwards: left is north
    pts, side, tan, off = lines.side_points(road, 20, 30, 300)
    assert len(pts) == 2 * 10 * 14
    assert (pts[side == 0, 1] > 0).all() and (pts[side == 1, 1] < 0).all()
    assert off.min() == 40 and off.max() == 300
    other = np.array([[0.0, 100], [200, 100]])                    # another highway 100 m to the north
    dense = np.vstack([lines.densify(road, 10)[0], lines.densify(other, 10)[0]])
    owner = np.array([0] * 21 + [1] * 21)
    keep = lines.own_side(pts, np.zeros(len(pts), int), cKDTree(dense), owner, 30)
    north = pts[keep & (side == 0)]
    assert north[:, 1].max() < 50                                 # nothing nearer the other road is taken
    assert keep[side == 1].all()                                  # the open south side is whole


def test_a_dual_carriageway_borrows_its_twins_outer_side():
    pts = np.array([[0.0, 60], [0, 150], [400, 150], [0, -60], [0, 10]])
    chain = np.array([1, 1, 1, 1, 0])
    got = lines.borrow(pts, chain, 1, np.array([0.0, 0]), np.array([1.0, 0]), 250, 0, 30, 380)
    assert got.tolist() == [0, 1]                                 # north, within the length; not the far one, not the south


def test_d8_codes_and_crossings():
    dc, dr, ok = crossings.steps(np.array([1, 2, 8, 128, 0]))
    assert dc.tolist() == [1, 1, 0, 0, 0] and dr.tolist() == [-1, 0, 1, -1, 0] and ok.tolist() == [True] * 4 + [False]
    e, n = crossings.flow_vectors(np.array([8, 1]))
    assert (e[0], n[0]) == (0, -1) and np.isclose(e[1], n[1]) and e[1] > 0
    line = np.column_stack([np.arange(0, 201, 10.0), np.zeros(21)])
    tan = np.tile([1.0, 0], (21, 1))
    tree = cKDTree(line)
    cx, cy = np.array([100.0, 100, 260]), np.array([20.0, 40, 20])
    dx, dy = np.array([100.0, 100, 260]), np.array([-10.0, 70, -10])
    idx, x, y, li, side = crossings.find(cx, cy, dx, dy, tree, line, tan, 45)
    assert idx.tolist() == [0] and np.isclose(y[0], 0) and side.tolist() == [0]   # from the left (north)
    keep = crossings.cluster(np.array([3, 3, 3, 4]), np.array([0.0, 50, 500, 0]), np.zeros(4), np.array([2.0, 9, 1, 1]), 90)
    assert keep.tolist() == [1, 2, 3]
    # A path along the road that comes back north is a stream running beside it, not under it.
    codes = np.zeros((5, 5), dtype="int16")
    codes[2, 0], codes[2, 1], codes[2, 2] = 2, 2, 128            # east, east, then north
    assert crossings.trace(codes, 2, 0, 10) == [(2, 1), (2, 2), (1, 2)]
    back = np.array([[110.0, -10], [120, -10], [130, 15]])
    on = np.array([[110.0, -10], [120, -10], [130, -20]])
    owner = np.zeros(21, dtype="int64")
    assert crossings.recrosses(back, tree, line, tan, owner, 0, 0, 45) is True
    assert crossings.recrosses(on, tree, line, tan, owner, 0, 0, 45) is False
    assert crossings.recrosses(back, tree, line, tan, owner, 1, 0, 45) is False       # another line's points
    w = crossings.waterway_crossings([np.array([[50.0, -20], [50, 20]])], [line])
    assert np.allclose(w, [[50, 0]])


def test_strip_reads_match_direct_indexing(tmp_path):
    import rasterio
    from rasterio.transform import from_origin

    data = np.arange(7 * 5, dtype="uint8").reshape(7, 5)
    path = tmp_path / "r.tif"
    with rasterio.open(path, "w", driver="GTiff", width=5, height=7, count=1, dtype="uint8",
                       crs="EPSG:32647", transform=from_origin(1000, 2000, 20, 20)) as dst:
        dst.write(data, 1)
    rows, cols = np.array([0, 6, 3, 3, -1]), np.array([4, 0, 2, 2, 1])
    with rasterio.open(path) as src:
        got = rasters.sample(src, 1, rows, cols, fill=255, strip=2)
    assert got.tolist() == [4, 30, 17, 17, 255]
    x, y = np.array([1010.0, 1090]), np.array([1990.0, 1870])
    assert rasters.sample_path(path, 1, x, y, fill=255).tolist() == [0, data[6, 4]]


def test_pass_files_are_found_on_the_master_lattice():
    from rasterio.transform import from_origin

    master = from_origin(615180, 879840, 20, 20)
    assert rasters.lattice_offset(master, from_origin(776160, 769100, 20, 20)) == (5537, 8049)
    assert rasters.lattice_offset(master, from_origin(776170, 769100, 20, 20)) is None     # half a cell off
    assert rasters.lattice_offset(master, from_origin(615180, 879840, 10, 10)) is None     # another scale


def test_counts_per_side_use_the_flood_codes():
    values = np.array([0, 1, 2, 3, 250, 255], dtype="uint8")     # codes at six distinct cells
    pair_cell = np.array([0, 1, 2, 3, 4, 5, 1])
    pair_group = np.array([0, 0, 0, 0, 0, 0, 1])
    obs, fl = group_counts(values, pair_group, pair_cell, 2, [1, 3])
    assert obs.tolist() == [4, 1] and fl.tolist() == [2, 1]


def test_upstream_side_rules():
    assert score.upstream((0.7, 0.3), (10.0, 12.0), None, 0.1, 0.5)["side"] == 0     # D8 first
    u = score.upstream((0.7, 0.3), (10.0, 12.0), None, 0.1, 0.5)
    assert u["by"] == "d8" and u["agree"] is False
    assert score.upstream((0.5, 0.45), (10.0, 12.0), 1, 0.1, 0.5)["by"] == "crossing"
    assert score.upstream((0.5, 0.45), (10.0, 12.0), None, 0.1, 0.5)["side"] == 1    # then the higher side
    assert score.upstream((0.5, 0.45), (10.0, 10.2), None, 0.1, 0.5)["side"] is None


def test_seasons_count_clearly_wetter_sides_only():
    up = np.array([0.5, 0.3, 0.05, np.nan])
    down = np.array([0.1, 0.25, 0.30, 0.2])
    s = score.seasons(up, down, np.array([50, 30, 5, 0]), np.array([10, 25, 30, 4]), 0.10, 5)
    assert s["seen"] == 3 and s["up_wetter"] == 1 and s["down_wetter"] == 1
    assert np.isclose(s["asymmetry"], (0.4 + 0.05 - 0.25) / 3)
    assert np.isnan(score.share(np.array([3]), np.array([10]), 25))[0]


def test_score_and_class():
    strong = fig(asymmetry=0.3, seasons_up=4, persistence=0.06, crossing_km2=100.0)
    total, parts = score.total(strong, CFG)
    assert total == 1.0 and parts["no_opening"] == 1.0
    assert score.classify(total, strong, CFG) == score.LOOK_FIRST
    opened = fig(asymmetry=0.3, seasons_up=4, persistence=0.06, crossing_km2=100.0, crossing_opening_m=40, crossing_opening="bridge")
    assert score.total(opened, CFG)[0] == pytest.approx(0.85)
    # A crossing with no mapped opening but no difference between the sides is not a sign in the radar.
    only_map = fig(crossing_km2=100.0)
    assert score.total(only_map, CFG)[0] == pytest.approx(0.30)
    assert score.classify(0.30, only_map, CFG) == score.NO_SIGN
    unclear = fig(upstream=None, asymmetry=0.3, seasons_up=4, persistence=0.06)
    assert score.total(unclear, CFG)[0] == pytest.approx(0.35)
    assert score.classify(None, fig(seasons_seen=0, persistence=None), CFG) == score.NOT_SEEN
    assert score.total(fig(seasons_seen=0, persistence=None), CFG)[0] is None
    assert score.crossing_part(10, 1, 100) == pytest.approx(0.5) and score.crossing_part(0.5, 1, 100) == 0
    words = score.reasons(fig(upstream=1, asymmetry=0.2, seasons_up=3, crossing_km2=12.0, upstream_agree=False), CFG)
    assert words[0].startswith("the right (upstream) side was flooded on 20 percentage points more")
    assert any("no mapped bridge, culvert or waterway within 100 m" in w for w in words)
    assert words[-1].startswith("flow directions and ground height disagree")
    far = score.reasons(fig(crossing_km2=12.0, crossing_opening_m=140, crossing_opening="bridge"), CFG)
    assert far[-1].endswith("within 100 m (the nearest, a bridge, is 140 m away)")
    assert score.total(fig(crossing_km2=100.0, crossing_opening_m=140, crossing_opening="bridge"), CFG)[1]["no_opening"] == 1.0


def test_flagged_neighbours_become_one_stretch():
    from highway_paths.__main__ import ranked_stretches, stretches

    def row(i, cls, sc, chain=0, twin=None):
        return {"id": f"S{i:05d}", "index": i, "chain": chain, "class": cls, "score": sc, "length_m": 500,
                "province_code": "94", "twin_section": twin}
    rows = [row(1, "look_first", 0.9), row(2, "worth_a_look", 0.4), row(3, "no_sign", 0.1), row(4, "worth_a_look", 0.35),
            row(10, "look_first", 0.8, chain=1, twin="S00001")]
    found = stretches(rows)
    assert [(x["id"], x["sections"], x["class"], x["km"]) for x in found] == [
        ("R00001", ["S00001", "S00002"], "look_first", 1.0), ("R00004", ["S00004"], "worth_a_look", 0.5),
        ("R00010", ["S00010"], "look_first", 0.5)]
    assert rows[2]["stretch"] is None and rows[1]["stretch"] == "R00001"
    assert [x["id"] for x in ranked_stretches(found)] == ["R00001", "R00004"]     # the other carriageway left out


def test_osm_answer_is_split_into_highways_culverts_and_waterways():
    got = osm.slim([
        {"type": "way", "id": 1, "tags": {"highway": "trunk", "ref": "42", "name": "x", "surface": "asphalt"}},
        {"type": "node", "id": 2, "lat": 6.8, "lon": 101.2, "tags": {"man_made": "culvert"}},
        {"type": "way", "id": 3, "tags": {"waterway": "stream", "tunnel": "culvert"},
         "geometry": [{"lat": 6.8, "lon": 101.2}, {"lat": 6.81, "lon": 101.2}]},
        {"type": "way", "id": 4, "tags": {"waterway": "canal"}, "geometry": [{"lat": 6.8, "lon": 101.2}, {"lat": 6.81, "lon": 101.3}]},
        {"type": "way", "id": 5, "tags": {"waterway": "drain"}, "geometry": [{"lat": 6.8, "lon": 101.2}]},
    ])
    assert got["highways"] == [{"id": 1, "tags": {"highway": "trunk", "ref": "42", "name": "x"}}]
    assert [c["id"] for c in got["culverts"]] == [2, 3] and got["culverts"][0]["points"] == [[101.2, 6.8]]
    assert [w["id"] for w in got["waterways"]] == [4]


def test_ranking_drops_the_twin_of_a_listed_section():
    rows = [{"id": "S1", "score": 0.9, "twin_section": "S2"}, {"id": "S2", "score": 0.8, "twin_section": "S1"},
            {"id": "S3", "score": 0.5, "twin_section": None}, {"id": "S4", "score": None, "twin_section": None}]
    assert [r["id"] for r in ranked(rows)] == ["S1", "S3"]
