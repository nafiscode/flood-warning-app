"""Offline tests for the hazard baseline. The WhiteboxTools test runs the real binary on a tiny DEM."""

import os

import numpy as np
import pytest
import rasterio

from hazard import hand, sources
from hazard.__main__ import load_config


def test_shipped_config_is_valid_and_names_follow_the_box():
    cfg = load_config()
    assert cfg["bbox_deg"] == [99, 5, 103, 9] and cfg["export"]["crs"] == "EPSG:32647"
    assert sources.names(cfg) == {"dem": "jaga_hazard_fabdem_e099n05_e103n09",
                                  "water": "jaga_hazard_jrc_occurrence_e099n05_e103n09"}
    transform, dimensions = sources.grid(cfg)
    assert dimensions == "14400x14400"
    # FABDEM's cell centres lie on whole arc-seconds: the first cell is centred on 99 E, 9 N.
    assert transform[2] + transform[0] / 2 == pytest.approx(99) and transform[5] + transform[4] / 2 == pytest.approx(9)
    assert "CC BY-NC-SA" in cfg["dem"]["attribution"]


def write_dem(path, data, crs="EPSG:32647", scale=30, west=700020.0, north=700020.0, nodata=hand.NODATA):
    profile = dict(driver="GTiff", dtype="float32", count=1, width=data.shape[1], height=data.shape[0], crs=crs,
                   transform=rasterio.Affine(scale, 0, west, 0, -scale, north), nodata=nodata)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype("float32"), 1)


def test_working_grid_is_snapped_and_the_sea_becomes_nodata(tmp_path):
    # One degree-grid tile near Pattani: land rising inland, the sea stored as 0.
    data = np.tile(np.linspace(0, 50, 60, dtype="float32"), (60, 1))
    data[:, :10] = 0
    src = tmp_path / "src.tif"
    step = 1 / 3600
    with rasterio.open(src, "w", driver="GTiff", dtype="float32", count=1, width=60, height=60, crs="EPSG:4326",
                       transform=rasterio.Affine(step, 0, 101.25, 0, -step, 6.9), nodata=-9999) as dst:
        dst.write(data, 1)
    info = hand.to_working_grid(src, tmp_path / "work" / "dem_utm.tif", "EPSG:32647", 30, sea_level_m=0.0)
    with rasterio.open(tmp_path / "work" / "dem_utm.tif") as out:
        assert out.crs.to_epsg() == 32647 and out.res == (30, 30)
        assert out.transform.c % 30 == 0 and out.transform.f % 30 == 0
        band = out.read(1)
    valid = band != hand.NODATA
    assert 0 < info["valid_cells"] == valid.sum() < band.size
    assert band[valid].min() > 0 and info["max_m"] <= 50


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
