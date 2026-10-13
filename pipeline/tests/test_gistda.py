"""GISTDA comparison: the download's bookkeeping, the burn and the counting. No network, no rasters."""

import json

import numpy as np
import pytest
from rasterio.transform import from_origin

from gistda import compare, fetch


def square(x0, y0, x1, y1, **props):
    return {"type": "Feature", "id": "a", "properties": props,
            "geometry": {"type": "MultiPolygon", "coordinates": [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]]}}


def test_slim_keeps_only_what_the_comparison_uses():
    f = square(0, 0, 1, 1, tb_idn=940701, freq=2, area_rai=1.5, y_2014=1, y_2020=1, pv_tn="จ.ปัตตานี", _createdBy="x")
    f["links"] = [{"href": "https://example.invalid/?api_key=SECRET"}]
    out = fetch.slim(f)
    assert set(out) == {"type", "id", "geometry", "properties"}
    assert out["properties"] == {"tb_idn": 940701, "freq": 2, "area_rai": 1.5, "y_2014": 1, "y_2020": 1}
    assert "SECRET" not in json.dumps(out)


class FakeClient:
    """Serves `total` features in pages and records what was asked."""

    def __init__(self, total, fail_first=0):
        self.total, self.asked, self.fail = total, [], fail_first

    def get(self, url, params):
        self.asked.append((params["offset"], params["limit"]))

        class R:
            status_code = 200

        r = R()
        if self.fail:
            self.fail -= 1
            r.status_code = 503
            return r
        n = max(min(params["limit"], self.total - params["offset"]), 0)
        r.json = lambda: {"numberMatched": self.total, "links": [{"href": "?api_key=SECRET"}],
                          "features": [square(0, 0, 1, 1, y_2020=1) for _ in range(n)]}
        return r


def test_a_province_is_fetched_in_pages_and_an_interrupted_run_carries_on(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)
    client = FakeClient(5)
    assert fetch.fetch_province(client, "u", tmp_path, "95", 2, 0) == 5
    folder = tmp_path / "flood_freq" / "95"
    assert [p.name for p in fetch.pages(tmp_path, "95")] == ["0000000.json.gz", "0000002.json.gz", "0000004.json.gz"]
    assert [len(fetch.read_page(p)) for p in fetch.pages(tmp_path, "95")] == [2, 2, 1]
    assert all(b"SECRET" not in p.read_bytes() for p in folder.iterdir())
    # finished: nothing is asked again
    again = FakeClient(5)
    assert fetch.fetch_province(again, "u", tmp_path, "95", 2, 0) == 5 and again.asked == []
    # interrupted after the first page: only the total and the missing pages are asked for
    (folder / "done.json").unlink()
    fetch.page_path(folder, 2).unlink()
    fetch.page_path(folder, 4).unlink()
    with pytest.raises(SystemExit):
        fetch.pages(tmp_path, "95")
    resumed = FakeClient(5, fail_first=1)
    assert fetch.fetch_province(resumed, "u", tmp_path, "95", 2, 0) == 5
    assert resumed.asked == [(0, 1), (0, 1), (2, 2), (4, 2)]


def test_year_bits_and_counts():
    assert compare.year_bits({"y_2011": 1, "y_2013": 1, "y_2024": 1, "y_2025": 1}, 2011, 2024) == 0b10000000000101
    assert compare.year_bits({"y_2011": 0}, 2011, 2024) == 0
    bits = np.array([[0b101, 0b10, 0]], dtype=np.uint16)                  # 2011+2013, 2012, none
    assert compare.count_years(bits, 2011, 2011, 2013).tolist() == [[2, 1, 0]]
    assert compare.count_years(bits, 2011, 2012, 2013).tolist() == [[1, 1, 0]]


def test_burn_uses_cell_centres_and_keeps_every_polygons_years():
    transform = from_origin(0, 100, 10, 10)                               # 10 x 10 cells of 10 m
    grid = np.zeros((10, 10), dtype=np.uint16)
    page = [square(0, 60, 40, 100, y_2011=1),                             # rows 0-3, cols 0-3
            square(20, 60, 60, 100, y_2012=1),                            # rows 0-3, cols 2-5: overlaps the first
            square(71, 1, 74, 4, y_2011=1),                               # covers no cell centre
            square(80, 0, 100, 20, y_2010=1)]                             # no year in range: not burned
    burned = compare.burn(grid, transform, page, lambda x, y: (x, y), 2011, 2024)
    assert burned == 3
    assert (grid[0:4, 0:2] == 1).all() and (grid[0:4, 2:4] == 3).all() and (grid[0:4, 4:6] == 2).all()
    assert int((grid > 0).sum()) == 24
    # a second page adds to the first
    compare.burn(grid, transform, [square(0, 0, 100, 10, y_2024=1)], lambda x, y: (x, y), 2011, 2024)
    assert (grid[9] == 1 << 13).all() and int((grid > 0).sum()) == 34


def test_near_agreement_and_cross():
    m = np.zeros((5, 5), dtype=bool)
    m[2, 2] = True
    assert int(compare.near(m, 1).sum()) == 9 and compare.near(m, 0) is m
    a = compare.agreement(ours=100, theirs=50, both=25, cell_km2=0.01, ours_near=40, theirs_near=30)
    assert a == {"ours_km2": 1.0, "theirs_km2": 0.5, "both_km2": 0.2, "theirs_also_ours_pct": 50.0,
                 "ours_also_theirs_pct": 25.0, "csi": 0.2, "ours_near_theirs_pct": 40.0, "theirs_near_ours_pct": 60.0}
    empty = compare.agreement(0, 0, 0, 0.01)
    assert empty["csi"] is None and empty["theirs_also_ours_pct"] is None
    ours, theirs = np.array([[0, 1, 2, 2]]), np.array([[0, 0, 1, 2]])
    where = np.array([[True, True, True, False]])
    assert compare.cross(ours, theirs, where, 3, 3).tolist() == [[1, 0, 0], [1, 0, 0], [0, 1, 0]]
