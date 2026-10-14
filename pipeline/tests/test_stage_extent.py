"""The stage-to-extent library (S6): radar names and grids, the reach, pairing, the z0 fit, the bands
and the tiles. Offline and synthetic: tiny arrays, no rasters from out/."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stage_extent import bands, calibrate, radar, reach


# --------------------------------------------------------------------------- radar

def test_scene_names_one_pass_at_its_finest_and_only_the_chosen_hash():
    names = ["jaga_sar_scene_20241129T1126Z_S1A_A172_20m_c97e0bf.tif",
             "jaga_sar_scene_20241129T1126Z_S1A_A172_10m_c97e0bf.tif",
             "jaga_sar_scene_20241129T1126Z_S1A_A172_10m_cd222f1.tif",
             "jaga_sar_scene_20171006T1134Z_S1A_A070_20m_c97e0bf.tif",
             "jaga_sar_max_event_c97e0bf.tif"]
    picked = radar.pick_scenes(names, "c97e0bf")
    assert [(s["time"].year, s["res_m"]) for s in picked] == [(2017, 20), (2024, 10)]
    assert picked[1]["time"] == pd.Timestamp("2024-11-29 11:26", tz="UTC") and picked[1]["orbit"] == "A172"
    assert radar.season_of(pd.Timestamp("2025-01-16", tz="UTC")) == 2024
    assert radar.season_of(pd.Timestamp("2025-09-30", tz="UTC")) == 2025


def test_twenty_metre_pixels_are_split_exactly_where_a_thirty_metre_cell_cuts_them():
    # 3 x 3 radar pixels of 20 m = 2 x 2 cells of 30 m. Top-left cell: one whole pixel, two halves and a quarter.
    codes = np.array([[1, 0, 0],
                      [0, 0, 0],
                      [250, 255, 3]], dtype="uint8")
    known, share = radar.aggregate(codes, 20, 30, (1, 3), (0, 2))
    assert known[0, 0] == pytest.approx(1.0) and share[0, 0] == pytest.approx(4 / 9)
    # Bottom-right cell: a row of 0 (three tenths), two of 255 (unknown) and four of 3 (flooded).
    assert known[1, 1] == pytest.approx(7 / 9) and share[1, 1] == pytest.approx(4 / 7)
    obs = radar.classify(known, share, 0.5, 0.5)
    assert obs.dtype == np.int8 and obs[0, 0] == 0
    k10, s10 = radar.aggregate(np.full((3, 3), 2, dtype="uint8"), 10, 30, (1, 3), (0, 2))   # VH only counts as dry
    assert k10[0, 0] == 1.0 and s10[0, 0] == 0.0
    assert radar.classify(np.array([[0.4]]), np.array([[1.0]]), 0.5, 0.5)[0, 0] == -1        # too little seen


def test_radar_window_lines_up_or_refuses():
    from rasterio.transform import from_origin

    target = from_origin(555000, 941340, 30, 30)
    radar20 = from_origin(615180, 879840, 20, 20)
    r, c, h, w = radar.radar_window(target, 2050, 2006, 4, 6, radar20)
    assert (r, c, h, w) == (0, 0, 6, 9)
    with pytest.raises(ValueError):
        radar.radar_window(target, 2051, 2006, 4, 6, radar20)          # 30 m off a 20 m edge


# --------------------------------------------------------------------------- reach

def _valley():
    """A 5 x 7 grid: the main river runs east along row 2 and ends in a pit at (2, 6); rows 0-1 drain
    south onto it, rows 3-4 north. Water passes most of it towards the east."""
    p = np.zeros((5, 7), dtype="int16")
    p[2, :6] = 2               # east along the river
    p[0:2, :] = 8              # south
    p[3:5, :] = 128            # north
    accum = np.ones((5, 7), dtype="float32")
    accum[2, :] = np.arange(10, 17)
    return p, accum


def test_stem_follows_the_river_down_and_the_largest_inflow_up():
    p, accum = _valley()
    mask, cells = reach.stem(p, accum, 2, 3, up_m=60, down_m=60, cell_m=30)
    assert [(r, c) for r, c, _ in cells] == [(2, 1), (2, 2), (2, 3), (2, 4), (2, 5)]
    assert cells[0][2] == pytest.approx(-0.06) and cells[-1][2] == pytest.approx(0.06)
    assert mask.sum() == 5


def test_height_above_the_stem_and_the_tributary_allowance():
    p, accum = _valley()
    mask, _ = reach.stem(p, accum, 2, 3, 60, 60, 30)
    surface = np.array([[9, 8, 9, 9, 9, 9, 9],
                        [6, 5, 6, 6, 6, 6, 6],
                        [3, 3, 2, 2, 1, 1, 0],
                        [5, 5, 5, 5, 5, 5, 5],
                        [7, 7, 7, 7, 7, 7, 7]], dtype="float32")
    above = reach.height_above_stem(p, mask, surface)
    assert above[1, 2] == pytest.approx(4.0) and above[0, 1] == pytest.approx(5.0)
    assert above[0, 0] == pytest.approx(6.0)                         # (2, 0) is not stem, but drains onto it
    assert np.isnan(above[0, 6]) and np.isnan(above[2, 6])           # past the stem's lower end
    hand = np.full(surface.shape, 0.5, dtype="float32")               # every cell near some stream
    assert reach.reach_height(hand, above)[1, 2] == pytest.approx(4.0)
    assert reach.reach_height(hand, above, 2.0)[1, 2] == pytest.approx(2.0)
    assert reach.reach_height(hand, above, 10.0)[1, 2] == pytest.approx(0.5)     # HAND is the floor
    assert np.isnan(reach.reach_height(hand, above)[0, 6])
    built = reach.built_up(np.pad(np.ones((3, 3)), 3), 3, 0.5)
    assert built[4, 4] and not built[0, 0]


# --------------------------------------------------------------------------- pairing and z0

def test_the_nearest_reading_within_the_tolerance_or_nothing():
    idx = pd.date_range("2024-11-29 10:00", periods=4, freq="1h", tz="UTC")
    level = pd.Series([1.0, np.nan, 3.0, 4.0], index=idx)
    assert calibrate.stage_at(level, pd.Timestamp("2024-11-29 11:26", tz="UTC"), 1.0) == (3.0, 0.57)
    assert calibrate.stage_at(level, pd.Timestamp("2024-11-29 16:30", tz="UTC"), 1.0) is None


def _passes(z0_true: float, stages: list[float], noise: float = 0.0, seed: int = 1):
    """Synthetic passes over heights 0..6 m: the radar sees wet exactly where h < s - z0 (some cells flipped)."""
    rng = np.random.default_rng(seed)
    h = np.linspace(0, 6, 600, dtype="float32").reshape(20, 30)
    scored = np.ones(h.shape, bool)
    f, d = [], []
    for s in stages:
        obs = (h < s - z0_true).astype("int8")
        flip = rng.random(h.shape) < noise
        obs[flip] = 1 - obs[flip]
        a, b = calibrate.histograms(h, obs, scored, 0.05, 8.0)
        f.append(a), d.append(b)
    return np.array(f), np.array(d), np.array(stages, dtype="float64")


def test_the_fit_finds_the_offset_and_scores_it():
    f, d, st = _passes(13.0, [14.0, 15.5, 17.0])
    z0s = np.round(np.arange(10.0, 16.0, 0.05), 4)
    z0, curve = calibrate.best_z0(f, d, st, z0s, 0.05)
    assert z0 == pytest.approx(13.0, abs=0.051) and curve.max() == pytest.approx(1.0)
    m = calibrate.score(f, d, st, 13.0, 0.05)
    assert m["csi"] == 1.0 and m["false_alarm_ratio"] == 0.0 and m["bias"] == 1.0
    low = calibrate.score(f, d, st, 14.0, 0.05)                      # too high an offset: misses, no false alarms
    assert low["hit_rate"] < 1 and low["false_alarm_ratio"] == 0.0 and low["bias"] < 1
    c = calibrate.ceiling(f, d, st, 13.0, 0.05)
    assert c["mean_csi_at_z0"] == pytest.approx(1.0) and c["mean_csi_best_cut_per_pass"] == pytest.approx(1.0)


def test_cells_above_the_top_bin_are_never_wet_and_metrics_handle_empty():
    h = np.array([[0.1, 9.0]], dtype="float32")
    f, d = calibrate.histograms(h, np.array([[1, 1]], dtype="int8"), np.ones(h.shape, bool), 0.5, 2.0)
    assert f.tolist() == [1, 0, 0, 0, 1]
    tp, fp, fn = calibrate.counts(f[None, :], d[None, :], np.array([100.0]), np.array([0.0]), 0.5)
    assert (tp[0], fp[0], fn[0]) == (1, 0, 1)                          # 9 m stays dry even at a 100 m depth
    assert calibrate.metrics(0, 0, 0)["csi"] is None


def test_leave_one_season_out_pools_the_held_out_counts():
    f, d, st = _passes(13.0, [14.0, 15.0, 16.0, 17.0], noise=0.05)
    seasons = np.array([2020, 2020, 2021, 2022])
    z0s = np.round(np.arange(10.0, 16.0, 0.05), 4)
    lo = calibrate.leave_one_out(seasons, f, d, st, z0s, 0.05)
    assert [x["group"] for x in lo["folds"]] == [2020, 2021, 2022]
    assert all(abs(x["z0"] - 13.0) < 0.5 for x in lo["folds"])
    assert lo["pooled"]["tp"] == sum(x["tp"] for x in lo["folds"])
    assert 0.5 < lo["pooled"]["csi"] < 1.0
    one = calibrate.leave_one_out(np.array([2025]), f[:1], d[:1], st[:1], z0s, 0.05)
    assert one["folds"][0]["z0"] is None and one["pooled"]["csi"] is None


# --------------------------------------------------------------------------- bands

def test_steps_bands_and_the_lookup():
    st = bands.steps(16.5, 18.97, 0.25, 2.0, 1.0)
    assert st[0] == 14.5 and st[-1] == 20.0 and len(st) == 23
    h = np.array([[0.0, 0.1, 1.0, 5.0, np.nan]], dtype="float32")
    idx = bands.band_index(h, 15.35, st)
    # 15.35 + 0 is wet from the first step above 15.35 (15.5); + 1.0 = 16.35 -> 16.5; 20.35 never; NaN never
    assert idx.tolist() == [[5, 5, 9, 0, 0]] and st[4] == 15.5 and st[8] == 16.5
    assert bands.band_index(np.array([[0.0]]), 10.0, st)[0, 0] == 1          # wet below the lowest step
    rows = bands.lookup(idx, st, 0.09, np.array([[1, 2, 3, 4, 5]], dtype="float32"))
    by = {r["stage_m"]: r for r in rows}
    assert by[15.25]["area_km2"] == 0 and by[15.5]["area_km2"] == pytest.approx(0.18) and by[15.5]["buildings"] == 3
    assert by[20.0]["area_km2"] == pytest.approx(0.27) and by[20.0]["buildings"] == 6


# --------------------------------------------------------------------------- tiles

def test_bands_coarsen_and_smooth_without_crossing():
    from stage_extent import tiles

    block = np.array([[1, 3, 0, 0], [3, 3, 0, 0], [2, 2, 2, 0], [2, 2, 0, 0]], dtype="uint8")
    assert tiles.coarsen_index(block, 2, 0.25, 3).tolist() == [[1, 0], [2, 2]]
    assert tiles.coarsen_index(block, 4, 0.5, 3).tolist() == [[3]]
    grid = np.zeros((40, 40), dtype="uint8")
    grid[5:35, 5:35] = 3
    grid[10:30, 10:30] = 2
    grid[15:25, 15:25] = 1
    grid[7, 20] = 1                                                     # a stray low pixel
    sm = tiles.smooth_index(grid, 3, 1.5, 0.4)
    assert sm[20, 20] == 1 and sm[12, 20] == 2 and sm[0, 0] == 0 and sm[7, 20] == 3
    assert ((sm > 0) == (grid > 0)).all()                               # the outline of the reach is kept


def test_one_file_for_every_gauge_with_station_and_stage(tmp_path):
    from rasterio.transform import array_bounds, from_origin
    from rasterio.warp import transform as warp_xy
    from rasterio.warp import transform_bounds

    from hazard.tiles import tiles_for
    from stage_extent import tiles

    idx = np.zeros((120, 120), dtype="uint8")
    idx[40:80, 20:100] = 2
    idx[50:70, 40:80] = 1
    st = np.array([16.0, 16.25])
    t = from_origin(745000, 762000, 30, 30)
    bounds = transform_bounds("EPSG:32647", "EPSG:4326", *array_bounds(120, 120, t))
    gauges = [{"code": "X.40A", "index": idx, "transform": t, "crs": "EPSG:32647", "steps": st, "bounds_deg": list(bounds)}]
    out = tiles.build(gauges, tmp_path / "s.pmtiles", min_zoom=9, max_zoom=11, tile_px=512, buffer_px=4,
                      min_share=0.25, layer="stage_extent", metadata={"name": "test"}, sigma_px=1.0, smooth_cut=0.4)
    assert out["tiles"] >= 3 and 11 in out["zooms"]
    lon, lat = warp_xy("EPSG:32647", "EPSG:4326", [745000 + 60 * 30], [762000 - 60 * 30])
    z, x, y = tiles_for((lon[0], lat[0], lon[0], lat[0]), 11)[0]
    layer = tiles.read_tile(tmp_path / "s.pmtiles", z, x, y)["stage_extent"]
    props = {(f["properties"]["station"], f["properties"]["from_m"]) for f in layer["features"]}
    assert props == {("X.40A", 16.0), ("X.40A", 16.25)}
