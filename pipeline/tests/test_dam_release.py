"""The release path and the grading rules. Offline: no Overpass, no ThaiWater, no database."""

from __future__ import annotations

import math

import pandas as pd
import pytest

from dam_release import build, network, thresholds


def way(wid: int, pts, waterway="river", name=None):
    tags = {"waterway": waterway}
    if name:
        tags["name"] = name
    return {"id": wid, "tags": tags, "pts": [(round(x, 7), round(y, 7)) for x, y in pts]}


# A toy river flowing north: outlet -> two river ways -> the sea, with one tributary joining the
# second way and one ditch too small to count.
def toy() -> dict[int, dict]:
    ways = [
        way(1, [(101.0, 6.00), (101.0, 6.01)]),                 # outlet channel
        way(2, [(101.0, 6.01), (101.0, 6.10)]),                 # main, lower end
        way(3, [(101.0, 6.10), (101.0, 6.20)]),                 # main, to the sea
        way(4, [(100.9, 6.00), (100.95, 6.05), (101.0, 6.10)]), # tributary, ends on the main stem
        way(5, [(100.8, 5.95), (100.9, 6.00)]),                 # its upstream continuation
        way(6, [(101.004, 6.0995), (101.0, 6.10)], "ditch"),    # ~0.5 km: too small to count
    ]
    return {w["id"]: w for w in ways}


class TestWalk:
    def test_follows_the_flow_to_the_end(self):
        chain = network.walk_downstream(toy(), 1)
        assert [w["id"] for w in chain] == [1, 2, 3]

    def test_a_missing_start_is_an_error(self):
        with pytest.raises(KeyError):
            network.walk_downstream(toy(), 999)

    def test_it_never_loops_for_ever(self):
        # A way whose end is its own start would otherwise spin.
        ways = {1: way(1, [(101.0, 6.0), (101.0, 6.1), (101.0, 6.0)])}
        assert len(network.walk_downstream(ways, 1)) == 1

    def test_a_small_gap_is_crossed(self):
        ways = toy()
        # Move way 2's start 10 m off way 1's end: under the 30 m tolerance.
        ways[2] = way(2, [(101.00009, 6.01), (101.0, 6.10)])
        assert [w["id"] for w in network.walk_downstream(ways, 1)] == [1, 2, 3]

    def test_a_wide_gap_is_not_crossed(self):
        ways = toy()
        ways[2] = way(2, [(101.01, 6.01), (101.0, 6.10)])       # about 1.1 km off
        assert [w["id"] for w in network.walk_downstream(ways, 1)] == [1]

    def test_the_bigger_channel_wins_at_a_junction(self):
        ways = toy()
        ways[7] = way(7, [(101.0, 6.01), (101.2, 6.02)], "stream")
        assert 2 in [w["id"] for w in network.walk_downstream(ways, 1)]
        assert 7 not in [w["id"] for w in network.walk_downstream(ways, 1)]


class TestJoined:
    def test_shared_nodes_are_not_repeated(self):
        chain = network.walk_downstream(toy(), 1)
        pts = network.joined(chain)
        assert pts[0] == (101.0, 6.0) and pts[-1] == (101.0, 6.2)
        assert len(pts) == 4                                     # 2 + 2 + 2 minus 2 shared


class TestLowerReaches:
    def test_only_tributaries_with_enough_network(self):
        ways = toy()
        chain = network.walk_downstream(ways, 1)
        tribs = network.lower_reaches(ways, chain, min_network_km=5, reach_km=5)
        assert len(tribs) == 1                                   # the ditch is left out
        assert tribs[0]["osm_way"] == 4

    def test_the_junction_is_placed_along_the_stem(self):
        ways = toy()
        chain = network.walk_downstream(ways, 1)
        trib = network.lower_reaches(ways, chain, min_network_km=5, reach_km=5)[0]
        # The junction is at the start of way 3, about 11 km up from the outlet.
        assert 10.5 < trib["junction_km_from_dam"] < 11.5

    def test_the_reach_is_cut_to_length(self):
        ways = toy()
        chain = network.walk_downstream(ways, 1)
        trib = network.lower_reaches(ways, chain, min_network_km=5, reach_km=5)[0]
        assert trib["reach_km"] == pytest.approx(5.0, abs=0.05)
        # It is the part nearest the river that is kept, so it ends at the junction.
        assert trib["pts"][-1] == (101.0, 6.10)

    def test_a_short_tributary_keeps_what_it_has(self):
        ways = toy()
        chain = network.walk_downstream(ways, 1)
        tribs = network.lower_reaches(ways, chain, min_network_km=5, reach_km=500)
        assert tribs[0]["reach_km"] < 500

    def test_nothing_from_the_main_stem_is_called_a_tributary(self):
        ways = toy()
        chain = network.walk_downstream(ways, 1)
        tribs = network.lower_reaches(ways, chain, min_network_km=0.001, reach_km=5)
        assert {t["osm_way"] for t in tribs}.isdisjoint({1, 2, 3})


class TestCutFromEnd:
    def test_it_cuts_inside_a_segment(self):
        pts = [(101.0, 6.0), (101.0, 6.1)]                       # about 11 km
        out = network.cut_from_end(pts, 5.5)
        assert out[-1] == pts[-1]
        assert network.length_km(out) == pytest.approx(5.5, abs=0.05)

    def test_a_longer_ask_than_the_line_returns_the_line(self):
        pts = [(101.0, 6.0), (101.0, 6.01)]
        assert network.cut_from_end(pts, 99) == pts


class TestSimplify:
    def test_a_straight_line_loses_its_middle(self):
        pts = [(101.0, 6.0), (101.0, 6.05), (101.0, 6.1)]
        assert len(network.simplify(pts, 10)) == 2

    def test_a_bend_survives(self):
        pts = [(101.0, 6.0), (101.05, 6.05), (101.0, 6.1)]
        assert len(network.simplify(pts, 10)) == 3

    def test_two_points_are_left_alone(self):
        pts = [(101.0, 6.0), (101.0, 6.1)]
        assert network.simplify(pts, 10) == pts


class TestDistance:
    def test_a_tenth_of_a_degree_north_is_about_eleven_km(self):
        assert network.km((101.0, 6.0), (101.0, 6.1)) == pytest.approx(11.06, abs=0.05)

    def test_longitude_is_narrowed_by_the_latitude(self):
        # Near the equator a degree of longitude is still the longer of the two: 111.320 km
        # times cos(6 deg) is 110.71, against 110.574 for a degree of latitude. What matters is
        # that the cosine is applied at all, so compare against the unnarrowed figure.
        east = network.km((101.0, 6.0), (101.1, 6.0))
        assert east == pytest.approx(11.07, abs=0.02)
        assert east < 11.132


# ------------------------------------------------------------------ the grading rules

GRADES = {"turbine_max_cms": 160, "inflow_high_cms": 500, "rise_mcm_per_h": 4.0,
          "rise_window_h": 6, "stale_after_h": 6, "min_consecutive_h": 2}
STORAGE = {"max_mcm": 1589.8, "normal_mcm": 1454.4}


def hours(values: dict) -> pd.DataFrame:
    n = len(next(iter(values.values())))
    index = pd.date_range("2024-11-01", periods=n, freq="h", tz="UTC")
    frame = pd.DataFrame(values, index=index)
    for name in ("dam_inflow_1h", "dam_released_1h", "dam_spilled_1h"):
        frame[name.replace("_1h", "_cms")] = frame[name] * thresholds.MM3_PER_H_TO_CMS
    frame["outflow_cms"] = frame["dam_released_cms"].fillna(0) + frame["dam_spilled_cms"].fillna(0)
    return frame


class TestUnits:
    def test_a_million_cubic_metres_an_hour_is_278_per_second(self):
        assert thresholds.MM3_PER_H_TO_CMS == pytest.approx(277.8, abs=0.1)

    def test_the_2021_peak_converts_to_the_reported_figure(self):
        # 2.333 Mm3/h is the Jan 2021 spill peak; news reported about 648 m3/s.
        assert 2.3334 * thresholds.MM3_PER_H_TO_CMS == pytest.approx(648, abs=2)


class TestConfirmed:
    def test_one_reading_is_not_enough(self):
        mask = pd.Series([False, True, False, False])
        assert list(thresholds.confirmed(mask, 2)) == [False, False, False, False]

    def test_two_in_a_row_count(self):
        mask = pd.Series([False, True, True, False])
        assert list(thresholds.confirmed(mask, 2)) == [False, False, True, False]

    def test_one_means_no_guard(self):
        mask = pd.Series([False, True, False])
        assert list(thresholds.confirmed(mask, 1)) == [False, True, False]


class TestSpells:
    def test_episodes_not_hours(self):
        assert thresholds.spells(pd.Series([True, True, False, True])) == 2

    def test_nothing_is_no_spell(self):
        assert thresholds.spells(pd.Series([False, False])) == 0


class TestEvidence:
    def test_a_quiet_record_fires_nothing(self):
        data = hours({"dam_storage": [700.0] * 12, "dam_level": [99.0] * 12,
                      "dam_inflow_1h": [0.1] * 12, "dam_released_1h": [0.15] * 12,
                      "dam_spilled_1h": [0.0] * 12})
        found = thresholds.evidence(data, GRADES, STORAGE)
        assert found["tiers"]["releasing_hours"] == 0
        assert found["tiers"]["watchful_hours"] == 0
        assert found["spill"]["hours"] == 0

    def test_a_spill_is_a_release(self):
        spill = [0.0] * 6 + [1.0] * 6
        data = hours({"dam_storage": [1500.0] * 12, "dam_level": [113.0] * 12,
                      "dam_inflow_1h": [0.1] * 12, "dam_released_1h": [0.5] * 12,
                      "dam_spilled_1h": spill})
        found = thresholds.evidence(data, GRADES, STORAGE)
        assert found["spill"]["hours"] == 6
        assert found["tiers"]["releasing_hours"] == 5          # the first hour awaits confirming
        assert found["tiers"]["releasing_spells"] == 1

    def test_a_single_impossible_hour_is_held_back(self):
        # The 26 Jun 2015 reading: a huge outflow for one hour, no spill.
        released = [0.15] * 5 + [7.0] + [0.15] * 6
        data = hours({"dam_storage": [700.0] * 12, "dam_level": [99.0] * 12,
                      "dam_inflow_1h": [0.1] * 12, "dam_released_1h": released,
                      "dam_spilled_1h": [0.0] * 12})
        found = thresholds.evidence(data, GRADES, STORAGE)
        assert found["outflow_cms"]["hours_above_turbine_max"] == 1
        assert found["tiers"]["releasing_hours"] == 0
        assert found["tiers"]["single_readings_held_back"] == 1

    def test_storage_above_normal_high_is_watchful_not_releasing(self):
        data = hours({"dam_storage": [1460.0] * 12, "dam_level": [114.0] * 12,
                      "dam_inflow_1h": [0.1] * 12, "dam_released_1h": [0.15] * 12,
                      "dam_spilled_1h": [0.0] * 12})
        found = thresholds.evidence(data, GRADES, STORAGE)
        assert found["tiers"]["watchful_hours"] == 11
        assert found["tiers"]["releasing_hours"] == 0

    def test_percent_full_uses_the_full_reservoir(self):
        data = hours({"dam_storage": [794.9] * 12, "dam_level": [99.0] * 12,
                      "dam_inflow_1h": [0.1] * 12, "dam_released_1h": [0.15] * 12,
                      "dam_spilled_1h": [0.0] * 12})
        found = thresholds.evidence(data, GRADES, STORAGE)
        assert found["storage_mcm"]["percent_full_now"] == pytest.approx(50.0, abs=0.1)


# ------------------------------------------------------------------ the seed it writes

class TestSeedWriting:
    def test_a_quote_in_a_name_cannot_break_the_sql(self):
        assert build._sql_text("O'Hara") == "'O''Hara'"

    def test_thai_survives_as_json(self):
        out = build._sql_json({"th": "เขื่อนบางลาง"})
        assert "เขื่อนบางลาง" in out and out.endswith("::jsonb")

    def test_a_line_becomes_wkt(self):
        assert build._wkt_line([(101.0, 6.0), (101.1, 6.1)]) == \
            "LINESTRING (101.000000 6.000000, 101.100000 6.100000)"

    def test_a_multipolygon_keeps_its_islands(self):
        from shapely.geometry import MultiPolygon, Polygon
        outer = [(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]
        hole = [(0.2, 0.2), (0.2, 0.4), (0.4, 0.4), (0.4, 0.2), (0.2, 0.2)]
        wkt = build._wkt_multipolygon(MultiPolygon([Polygon(outer, [hole])]))
        assert wkt.startswith("MULTIPOLYGON (((") and wkt.count("), (") == 1


# --------------------------------------------------------------------------- travel times

def _hours(values, start="2024-03-01"):
    import pandas as pd

    return pd.Series([float(v) for v in values], index=pd.date_range(start, periods=len(values), freq="1h", tz="UTC"))


def test_a_pulse_is_found_at_the_lag_it_was_given():
    import numpy as np

    from dam_release import travel

    rng = np.random.default_rng(1)
    steps = np.repeat(rng.choice([0.0, 80.0, 160.0], size=60), 12)          # the turbines, 30 days
    outflow = _hours(steps)
    level = _hours(np.concatenate([np.full(5, steps[0]), steps[:-5]]) / 100 + 40)   # the same shape 5 hours later
    fit = travel.best_lag(outflow, level, 24)
    assert fit["lag_h"] == 5 and fit["r"] > 0.9
    rows = travel.pulse_lags(outflow, level, [3], 24, 0.25)
    assert [r["lag_h"] for r in rows] == [5] and rows[0]["month"] == "2024-03"
    assert travel.pulse_lags(outflow, level, [7], 24, 0.25) == []           # not a month that was asked for
    assert travel.best_lag(outflow, _hours(np.full(len(steps), 40.0)), 24) is None   # a flat gauge says nothing


def test_flood_lags_are_front_to_front_and_peak_to_peak_and_a_broken_sensor_is_dropped():
    import numpy as np

    from dam_release import travel

    base = np.full(24 * 40, 10.0)
    hump = np.concatenate([np.linspace(0, 3, 12), np.linspace(3, 0, 60)])    # rises for 12 h, falls for 60
    up, down = base.copy(), base.copy()
    up[400:400 + len(hump)] += hump
    down[409:409 + len(hump)] += hump * 0.8                                   # nine hours later, lower
    rows = travel.event_lags(_hours(up), _hours(down), quantile=0.95, gap_days=8, min_rise_m=1.0, max_h=48)
    assert len(rows) == 1 and rows[0]["rise_m"] == 3.0
    assert rows[0]["peak_lag_h"] == 9 and abs(rows[0]["front_lag_h"] - 9) <= 1
    assert travel.event_lags(_hours(up), _hours(down), quantile=0.95, gap_days=8, min_rise_m=5.0, max_h=48) == []
    up[100] = 99.0                                                            # one impossible reading
    kept = travel.event_lags(_hours(up), _hours(down), quantile=0.95, gap_days=8, min_rise_m=1.0, max_h=48, max_up_m=30)
    assert len(kept) == 1 and kept[0]["rise_m"] == 3.0
    s = travel.spread([4, 6, 8, -3, None])
    assert s["n"] == 3 and s["median"] == 6 and s["dropped_negative"] == 1 and travel.spread([-1, None]) is None


def test_arrival_goes_by_river_distance_and_the_warning_takes_the_margin_off():
    from shapely.geometry import box

    from dam_release import travel

    anchors = [{"km": 0, "earliest_h": 0, "latest_h": 0, "peak_earliest_h": 0, "peak_latest_h": 0},
               {"km": 20, "earliest_h": 3, "latest_h": 4, "peak_earliest_h": 3, "peak_latest_h": 4},
               {"km": 80, "earliest_h": 9, "latest_h": 18, "peak_earliest_h": 15, "peak_latest_h": 26}]
    assert travel.arrival(10, anchors, "earliest_h") == 1.5 and travel.arrival(50, anchors, "latest_h") == 11.0
    assert travel.arrival(-5, anchors, "latest_h") == 0 and travel.arrival(90, anchors, "earliest_h") == 10.0
    assert travel.warn_from(9.0, 0.2) == 7.0 and travel.warn_from(3.9, 0.2) == 3.0   # rounded down, never up
    rows = travel.table({"b": {"km": 50, "via": "main"}, "a": {"km": 20, "via": "tributary"}}, anchors, 0.2)
    assert [r["tambon_code"] for r in rows] == ["a", "b"]                    # in order down the river
    assert rows[1] == {"tambon_code": "b", "via": "main", "km_from_dam": 50, "warn_from_h": 4.5, "earliest_h": 6.0,
                       "latest_h": 11.0, "peak_earliest_h": 9, "peak_latest_h": 15}
    assert all(r["warn_from_h"] <= r["earliest_h"] <= r["latest_h"] for r in rows)
    # A river running north along 101 E: a tambon is entered where the river first touches it.
    river = [(101.0, 6.0 + i * 0.01) for i in range(51)]
    km, off = travel.river_km(river, (101.001, 6.25))
    assert 27 < km < 28.5 and 100 < off < 120
    entry = travel.tambon_entry_km(river, [{"code": "x", "geometry": box(100.9, 6.2, 101.1, 6.3)},
                                           {"code": "y", "geometry": box(102.0, 6.0, 102.1, 6.1)}])
    assert list(entry) == ["x"] and 21.5 < entry["x"] < 22.7
    sql = travel.seed_sql("bang_lang", "gauges-test", rows, {"note": "it's a range"})
    assert sql.count("('bang_lang', 'gauges-test', ") == 2 and "it''s a range" in sql
    assert sql.startswith("-- Generated by pipeline/dam_release")


# --- the zone -------------------------------------------------------------------------------

import numpy as np

from dam_release import zone


def test_falling_never_rises_and_keeps_the_mean_of_a_pit():
    out = zone.falling(np.array([10.0, 9.0, 4.0, 8.0, 7.0, 6.0]))
    assert np.all(np.diff(out) <= 1e-9)
    assert out[0] == 10.0 and out[1] == 9.0
    # one pit does not drag the rest of the river down to its own depth
    assert out[-1] > 4.0
    assert math.isclose(out.sum(), 44.0)


def test_river_surface_fills_empty_stretches_and_falls():
    chain = np.array([0.0, 100.0, 2100.0, 2200.0])
    height = np.array([20.0, 22.0, 10.0, 12.0])
    centres, surf = zone.river_surface(chain, height, 3000.0, 1000.0, 0.0)
    assert list(centres) == [500.0, 1500.0, 2500.0]
    assert surf[0] == 20.0 and surf[2] == 10.0 and surf[0] >= surf[1] >= surf[2]


def toy_valley():
    """A river down column 2 of a 7 x 7 grid; a low field at column 5 behind a ridge at column 4."""
    dem = np.full((7, 7), 5.0, "float32")
    dem[:, 2] = 1.0
    dem[:, 1] = 1.5
    dem[:, 3] = 1.8
    dem[:, 4] = 9.0
    dem[:, 5] = 1.2
    river = np.zeros((7, 7), bool)
    river[:, 2] = True
    chain = np.zeros((7, 7), "float32")
    chain[:, 2] = np.arange(7) * 30.0
    return dem, river, chain


def test_zone_takes_the_joined_low_land_and_leaves_the_field_behind_the_ridge():
    dem, river, chain = toy_valley()
    har, dist, _ = zone.height_above_river(dem, river, chain, np.array([0.0, 180.0]), np.array([1.0, 1.0]), 30.0)
    z = zone.zone(har, dist, river, 1.0, 1000.0)
    assert z[:, 1].all() and z[:, 3].all()
    assert not z[:, 5].any()          # as low as the bank, but not joined to the river
    assert not z[:, 4].any()
    # a distance limit cuts the zone however low the land is
    assert not zone.zone(har, dist, river, 1.0, 20.0)[:, 1].any()
    # one limit per cell works as one number does
    assert (zone.zone(har, dist, river, np.full(dem.shape, 1.0), 1000.0) == z).all()


def test_recorded_rise_is_floored_where_the_model_stands_above_the_gauge():
    at, rise = zone.recorded_rise(
        [{"chain_m": 1000.0, "peak_m": 41.0}, {"chain_m": 5000.0, "peak_m": 19.0}],
        np.array([0.0, 6000.0]), np.array([48.0, 12.0]), 1.0)
    assert list(at) == [1000.0, 5000.0]
    assert rise[0] == 1.0 and math.isclose(rise[1], 1.0)
    at, rise = zone.recorded_rise([{"chain_m": 3000.0, "peak_m": 34.5}], np.array([0.0, 6000.0]), np.array([48.0, 12.0]), 1.0)
    assert math.isclose(rise[0], 4.5)


def test_by_tambon_counts_area_buildings_and_the_nearest_river_point():
    dem, river, chain = toy_valley()
    har, dist, chain_all = zone.height_above_river(dem, river, chain, np.array([0.0, 180.0]), np.array([1.0, 1.0]), 30.0)
    inner = zone.zone(har, dist, river, 0.6, 1000.0)
    outer = zone.zone(har, dist, river, 1.0, 1000.0)
    index = np.ones((7, 7), "uint16")
    index[4:, :] = 2
    index[:, 5:] = 3
    rows = zone.by_tambon(index, 3, inner, outer, chain_all, np.ones((7, 7), "float32"), np.ones((7, 7), bool), 0.09)
    assert rows[2] is None                       # nothing of the third tambon is in the zone
    assert rows[0]["km_from_dam"] == 0.0 and rows[1]["km_from_dam"] == 0.1
    assert rows[0]["zone_buildings"] == 8 and rows[0]["outer_buildings"] == 12
    assert rows[0]["outer_km2"] > rows[0]["zone_km2"]
