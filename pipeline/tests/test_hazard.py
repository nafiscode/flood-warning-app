"""Offline tests for the hazard baseline. The WhiteboxTools test runs the real binary on a tiny DEM."""

import os

import numpy as np
import pytest
import rasterio

from hazard import compare, hand, sources
from hazard.__main__ import load_config


def test_shipped_config_is_valid_and_names_follow_the_box():
    cfg = load_config()
    assert cfg["bbox_deg"] == [99, 5, 103, 9] and cfg["export"]["crs"] == "EPSG:32647"
    assert cfg["hand"]["stream_thresholds_cells"] == sorted(cfg["hand"]["stream_thresholds_cells"])
    assert sources.names(cfg) == {"dem": "jaga_hazard_fabdem_e099n05_e103n09",
                                  "water": "jaga_hazard_jrc_occurrence_e099n05_e103n09"}
    transform, dimensions = sources.grid(cfg)
    assert dimensions == "14400x14400"
    # FABDEM's cell centres lie on whole arc-seconds: the first cell is centred on 99 E, 9 N.
    assert transform[2] + transform[0] / 2 == pytest.approx(99) and transform[5] + transform[4] / 2 == pytest.approx(9)
    assert "CC BY-NC-SA" in cfg["dem"]["attribution"]


def test_stream_scores_count_mapped_water_found_and_streams_explained():
    streams = np.zeros((20, 20), dtype=bool)
    streams[:, 5] = True                               # one modelled stream down column 5
    river = np.zeros_like(streams)
    river[:, 7] = True                                 # a mapped river two cells away: found
    canal = np.zeros_like(streams)
    canal[10, 10:20] = True                            # a canal the model does not follow
    grown = compare.dilate(streams, 2)
    assert grown[:, 3:8].all() and not grown[:, 8:].any() and not grown[:, :3].any()
    s = compare.score(streams, {"river": river, "canal": canal}, tolerance_cells=2)
    assert s["stream_cells"] == 20 and s["found"]["river"] == {"cells": 20, "share": 1.0}
    assert s["found"]["canal"]["share"] == 0.0 and s["explained"] == 1.0
    assert compare.score(streams, {"river": river}, tolerance_cells=1)["found"]["river"]["share"] == 0.0
    top = np.zeros_like(streams)
    top[:5] = True                                     # scores restricted to an area
    inside = compare.score(streams, {"canal": canal, "none": np.zeros_like(streams)}, 2, within=top)
    assert inside["stream_cells"] == 5 and inside["found"]["canal"]["cells"] == 0
    assert inside["found"]["none"]["share"] is None and inside["explained"] == 0.0


def test_downslope_paths_follow_the_pointer_until_it_ends():
    pointer = np.zeros((5, 6), dtype="float32")
    pointer[0, :5] = 2                                 # row 0 flows east ...
    pointer[0, 5] = 8                                  # ... then south down the last column
    pointer[1:4, 5] = 8                                # and stops at the bottom cell (0)
    pointer[2, 0:3] = -32768                           # nodata never moves
    seeds = np.zeros(pointer.shape, dtype=bool)
    seeds[0, 2] = seeds[2, 1] = True
    paths = hand.downslope_paths(pointer, seeds)
    assert paths[0, 2:].all() and paths[:, 5].all() and paths[2, 1]
    assert paths.sum() == 4 + 4 + 1 and not paths[0, :2].any()


def test_hand_follows_the_flow_to_the_stream_and_uses_sea_level_on_the_coast():
    # 1 x 7 strip flowing east: land, land, stream, | land, land flowing east to the sea (nodata) | sea
    surface = np.array([[12.0, 9.0, 5.0, hand.NODATA, 3.0, 1.0, hand.NODATA]], dtype="float32")
    pointer = np.array([[2, 2, 0, hand.NODATA, 2, 2, hand.NODATA]], dtype="float32")
    streams = np.array([[0, 0, 1, 0, 0, 0, 0]], dtype=bool)
    sea = np.array([[0, 0, 0, 0, 0, 0, 1]], dtype=bool)
    h = hand.hand_from_flow(pointer, streams, surface, sea)
    assert h[0, :3].tolist() == [7.0, 4.0, 0.0]                  # height above the stream cell they drain to
    assert h[0, 4:6].tolist() == [3.0, 1.0]                      # no stream on the way: height above sea level
    assert h[0, 3] == hand.NODATA and h[0, 6] == hand.NODATA
    # The same coastal cells with no sea beside the end of their path (the edge of the window): no value.
    assert (hand.hand_from_flow(pointer, streams, surface, np.zeros_like(sea))[0, 4:6] == hand.NODATA).all()
    # A stream cell higher than the land draining to it (burned routing over an unburned surface): 0, not negative.
    surface[0, 1] = 4.0
    assert hand.hand_from_flow(pointer, streams, surface, sea)[0, 1] == 0.0
    # A path that would step off the east edge of the grid does not wrap to the next row.
    wrap = hand.hand_from_flow(np.array([[2, 2], [0, 0]], dtype="float32"), np.array([[0, 0], [1, 0]], dtype=bool),
                               np.array([[5.0, 4.0], [1.0, 1.0]], dtype="float32"), np.zeros((2, 2), dtype=bool))
    assert wrap[0, 1] == hand.NODATA and wrap[1, 0] == 0.0


def test_rivers_are_burned_into_the_dem_for_routing_only(tmp_path):
    dem = np.full((20, 20), 50.0)
    dem[0, 0] = hand.NODATA
    write_dem(tmp_path / "dem.tif", dem)
    with rasterio.open(tmp_path / "dem.tif") as src:
        x0, y0 = src.transform * (0.5, 10.5)
        x1, y1 = src.transform * (19.5, 10.5)
        from pyproj import Transformer
        lon, lat = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True).transform([x0, x1], [y0, y1])
    river = {"type": "LineString", "coordinates": list(zip(lon, lat))}
    cells = hand.burn_rivers(tmp_path / "dem.tif", tmp_path / "burned" / "dem_utm.tif", [river], 10)
    with rasterio.open(tmp_path / "burned" / "dem_utm.tif") as src:
        burned = src.read(1)
    assert 18 <= cells <= 22 and (burned[10, 1:19] == 40).all() and (burned[5] == 50).all() and burned[0, 0] == hand.NODATA


def write_dem(path, data, crs="EPSG:32647", scale=30, west=700020.0, north=700020.0, nodata=hand.NODATA):
    profile = dict(driver="GTiff", dtype="float32", count=1, width=data.shape[1], height=data.shape[0], crs=crs,
                   transform=rasterio.Affine(scale, 0, west, 0, -scale, north), nodata=nodata)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype("float32"), 1)


def test_working_grid_is_snapped_and_the_sea_becomes_nodata(tmp_path):
    # One degree-grid tile near Pattani: land rising inland, the sea stored as 0.
    data = np.tile(np.linspace(0, 50, 60, dtype="float32"), (60, 1))
    data[:, :10] = 0
    data[4:7, 29:32] = -4              # land below sea level stays land
    data[50:, 50:] = np.nan            # an all-sea tile comes as missing
    src = tmp_path / "src.tif"
    step = 1 / 3600
    with rasterio.open(src, "w", driver="GTiff", dtype="float32", count=1, width=60, height=60, crs="EPSG:4326",
                       transform=rasterio.Affine(step, 0, 101.25, 0, -step, 6.9), nodata=-9999) as dst:
        dst.write(data, 1)
    info = hand.to_working_grid(src, tmp_path / "work" / "dem_utm.tif", "EPSG:32647", 30, sea_value_m=0.0)
    with rasterio.open(tmp_path / "work" / "dem_utm.tif") as out:
        assert out.crs.to_epsg() == 32647 and out.res == (30, 30)
        assert out.transform.c % 30 == 0 and out.transform.f % 30 == 0
        assert out.tags(ns="IMAGE_STRUCTURE").get("PREDICTOR", "1") == "1"      # WhiteboxTools cannot read 3
        band = out.read(1)
    valid = band != hand.NODATA
    assert 0 < info["valid_cells"] == valid.sum() < band.size
    assert info["min_m"] < 0 and info["max_m"] <= 50
    assert not np.isnan(band).any() and (band[valid] != 0).all()
    part = hand.to_working_grid(src, tmp_path / "work" / "part.tif", "EPSG:32647", 30, sea_value_m=0.0,
                                bbox_deg=[101.25, 6.9 - 30 * step, 101.25 + 30 * step, 6.9])
    assert part["width"] < info["width"] and part["height"] < info["height"] and part["min_m"] < 0
    assert not valid[:, :5].any() and not valid[-5:, -5:].any() and valid[20:40, 20:40].all()


# The whitebox package downloads its binary on first use; CI does not depend on that download.
@pytest.mark.skipif(bool(os.environ.get("CI")), reason="needs the WhiteboxTools binary (downloaded on first use)")
def test_hand_is_zero_on_the_stream_and_rises_up_the_valley_sides(tmp_path):
    # A V-shaped valley sloping south: the stream runs down the middle column.
    rows, cols = 60, 41
    y, x = np.mgrid[0:rows, 0:cols]
    dem = 100 - 0.5 * y + 2.0 * np.abs(x - cols // 2)
    dem[30, cols // 2] -= 3            # a pit on the stream line: must be breached, not left as a sink
    write_dem(tmp_path / "dem_utm.tif", dem)
    hand.condition(tmp_path, breach_dist_cells=20, breach_max_cost=None)
    streams, hand_path = hand.hand_for_threshold(tmp_path, 100)
    with rasterio.open(hand_path) as src:
        h = src.read(1)
    with rasterio.open(streams) as src:
        s = src.read(1)
        s_nodata = src.nodata
    on_stream = (s != s_nodata) & (s > 0)
    mid = cols // 2
    assert on_stream[40:55, mid].all() and not on_stream[40:55, mid + 5].any()
    assert np.abs(h[45, mid]) < 1e-3
    # Ten cells up the side of the valley the ground is 20 m above the stream it drains to, give or take
    # the down-valley slope along the flow path.
    assert 15 < h[45, mid + 10] < 21 and 15 < h[45, mid - 10] < 21
    assert h[45, mid + 15] > h[45, mid + 5]
    # Our reading of the tool's pointer codes: a path from the valley side reaches the stream and follows it south.
    with rasterio.open(tmp_path / "d8_pointer.tif") as src:
        pointer = src.read(1)
    seeds = np.zeros(pointer.shape, dtype=bool)
    seeds[10, mid + 10] = True
    paths = hand.downslope_paths(pointer, seeds)
    assert paths[50:56, mid].all() and not paths[:10].any() and not paths[:, :mid].any()
