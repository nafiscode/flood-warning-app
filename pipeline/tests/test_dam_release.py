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
