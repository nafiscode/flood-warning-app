"""The overflow zone of a full reservoir (dam_release/spill.py). Offline: no rasters, no network.

Every test here works on a small hand-built grid, so what is checked is the method and not the
elevation model: the walk downstream, where that walk is cut, which land drains into the reach,
how deep the day's volume stands, and the rain archive's accumulating gauges.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from dam_release import spill

# A valley running east: every cell sends its water to the cell on its right (2 = east in the
# hazard module's convention), with the two rows beside it draining into that middle row.
EAST, SOUTH, NORTH = 2, 8, 128


def valley(cols: int = 10) -> np.ndarray:
    """A 3-row grid whose top and bottom rows drain into the middle one, which flows east."""
    pointer = np.full((3, cols), EAST, dtype="int16")
    pointer[0, :] = SOUTH
    pointer[2, :] = NORTH
    return pointer


class TestTrace:
    def test_follows_the_flow_directions_to_the_end_of_the_grid(self):
        pointer = valley()
        accum = np.ones(pointer.shape, dtype="float32")
        path, cut, why = spill.trace(pointer, accum, (1, 0), own_km2=1.0, big_factor=10,
                                     max_cells=100)
        assert [p[1] for p in path] == list(range(10))
        assert all(p[0] == 1 for p in path)
        assert cut == len(path)
        assert "left the window" in why

    def test_stops_where_the_water_joins_a_channel_ten_times_its_size(self):
        pointer = valley()
        accum = np.ones(pointer.shape, dtype="float32")
        accum[1, 5:] = 50.0            # a big channel joins at column 5
        path, cut, why = spill.trace(pointer, accum, (1, 0), own_km2=1.0, big_factor=10,
                                     max_cells=100)
        # The walk itself runs on; only the part that is still this reservoir's own is kept.
        assert len(path) == 10
        assert cut == 6                # columns 0..5, the junction cell included
        assert "50 km2" in why

    def test_a_reservoir_of_its_own_size_does_not_cut_the_reach(self):
        pointer = valley()
        accum = np.ones(pointer.shape, dtype="float32")
        accum[1, 5:] = 50.0
        # The same junction, but this reservoir drains 20 km2: 50 is not ten times that.
        _, cut, why = spill.trace(pointer, accum, (1, 0), own_km2=20.0, big_factor=10,
                                  max_cells=100)
        assert cut == 10
        assert "left the window" in why

    def test_keeps_the_reason_for_the_cut_when_the_walk_runs_on_past_it(self):
        """The cut is why the zone ends; a longer walk afterwards must not overwrite it."""
        pointer = valley(cols=30)
        accum = np.ones(pointer.shape, dtype="float32")
        accum[1, 3:] = 99.0
        _, cut, why = spill.trace(pointer, accum, (1, 0), own_km2=1.0, big_factor=10, max_cells=5)
        assert cut == 4
        assert "99 km2" in why

    def test_a_pointer_that_leads_nowhere_ends_the_path(self):
        pointer = valley()
        pointer[1, 4] = 0
        accum = np.ones(pointer.shape, dtype="float32")
        path, cut, why = spill.trace(pointer, accum, (1, 0), own_km2=1.0, big_factor=10,
                                     max_cells=100)
        assert len(path) == 5
        assert cut == 5
        assert "ran out of flow directions" in why

    def test_a_loop_in_the_flow_directions_cannot_hang_it(self):
        pointer = np.array([[EAST, 32]], dtype="int16")   # east, then west again
        accum = np.ones(pointer.shape, dtype="float32")
        path, _, _ = spill.trace(pointer, accum, (0, 0), own_km2=1.0, big_factor=10,
                                 max_cells=100)
        assert path == [(0, 0), (0, 1)]


class TestDrainsInto:
    def test_takes_the_land_that_drains_into_the_reach_and_nothing_else(self):
        pointer = valley()
        # The reach is the middle row's first six cells.
        reach = np.zeros(pointer.shape, bool)
        reach[1, :6] = True
        inside = spill.drains_into(pointer, reach)
        # The rows beside it drain in above the cut, and the middle row above it does too.
        assert inside[0, :6].all() and inside[2, :6].all()
        # Nothing downstream of the cut drains into the reach: water there has already passed.
        assert not inside[:, 6:].any()

    def test_leaves_out_the_next_valley_over_the_divide(self):
        """A radius would take in the neighbour's valley; the flow directions do not."""
        pointer = np.full((3, 6), EAST, dtype="int16")
        pointer[0, :] = NORTH        # the top row drains away northwards, out of this valley
        pointer[2, :] = NORTH
        reach = np.zeros(pointer.shape, bool)
        reach[1, :] = True
        inside = spill.drains_into(pointer, reach)
        assert inside[1, :].all()
        assert inside[2, :].all()    # drains north into the middle row
        assert not inside[0, :].any()  # drains north out of the grid, not into the reach

    def test_the_catchment_above_the_wall_is_what_drains_into_the_start(self):
        pointer = valley()
        start = np.zeros(pointer.shape, bool)
        start[1, 4] = True
        above = spill.drains_into(pointer, start)
        assert above[1, :5].all()
        assert not above[1, 5:].any()


class TestFill:
    """The day's volume, standing level above the channel's own surface."""

    @staticmethod
    def flat_valley():
        """A 1 km reach, 30 m cells: a flat floor one metre above the channel on both sides."""
        har = np.array([
            [3.0, 3.0, 3.0, 3.0, 3.0],
            [1.0, 1.0, 1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0, 1.0, 1.0],
            [3.0, 3.0, 3.0, 3.0, 3.0],
        ], dtype="float32")
        channel = np.zeros(har.shape, bool)
        channel[2, :] = True
        corridor = np.ones(har.shape, bool)
        return har, corridor, channel

    def test_a_deeper_band_holds_more_water_and_covers_more_land(self):
        har, corridor, channel = self.flat_valley()
        low, low_mask = spill.held_mcm(har, corridor, channel, 0.5, 30.0, 2.0)
        high, high_mask = spill.held_mcm(har, corridor, channel, 1.5, 30.0, 2.0)
        assert high > low
        assert high_mask.sum() > low_mask.sum()

    def test_the_fill_finds_the_depth_that_holds_the_volume(self):
        har, corridor, channel = self.flat_valley()
        # The channel row alone, 5 cells of 900 m2, holds 0.00405 Mm3 at 0.9 m.
        target = 0.9 * 5 * 900 / 1e6
        depth, mask, held, bound = spill.fill_to_volume(har, corridor, channel, target, 30.0, 2.0,
                                                        0.05, 5.0)
        assert bound == ""
        assert held == pytest.approx(target, rel=0.02)
        assert 0.0 < depth < 1.0
        assert mask[2, :].all()

    def test_a_valley_wide_enough_still_gets_a_band_that_can_be_drawn(self):
        har, corridor, channel = self.flat_valley()
        depth, _, _, bound = spill.fill_to_volume(har, corridor, channel, 0.000001, 30.0, 2.0,
                                                  0.3, 5.0)
        assert depth == 0.3
        assert "smallest band" in bound

    def test_a_gorge_is_cut_at_the_ceiling_rather_than_drawn_as_a_wall_of_water(self):
        har, corridor, channel = self.flat_valley()
        depth, _, _, bound = spill.fill_to_volume(har, corridor, channel, 1000.0, 30.0, 2.0,
                                                  0.3, 2.0)
        assert depth == 2.0
        assert "deepest band" in bound

    def test_land_cut_off_from_the_channel_is_left_out(self):
        har, corridor, channel = self.flat_valley()
        har[:, 2] = 9.0                      # a ridge across the valley
        har[2, 2] = 0.0                      # the channel still runs through it
        _, mask = spill.held_mcm(har, corridor, channel, 1.5, 30.0, 2.0)
        # Low land beyond the ridge is still reached, because the channel joins the two sides.
        assert mask[1, 0] and mask[1, 4]
        # But the ridge itself is not in the band.
        assert not mask[0, 2]

    def test_one_pit_in_the_model_cannot_swallow_the_whole_volume(self):
        har, corridor, channel = self.flat_valley()
        har[1, 2] = -40.0                    # a sink forty metres deep
        held, _ = spill.held_mcm(har, corridor, channel, 0.5, 30.0, 2.0)
        # Floored at two metres below the channel: the pit contributes 2.5 m, not 40.5 m.
        assert held < 0.01
        deep = (0.5 + 2.0) * 900 / 1e6
        assert held > deep * 0.9

    def test_a_cell_outside_the_corridor_holds_nothing(self):
        har, corridor, channel = self.flat_valley()
        corridor[:] = False
        corridor[2, :] = True                # only the channel row drains into the reach
        _, mask = spill.held_mcm(har, corridor, channel, 1.5, 30.0, 2.0)
        assert mask[2, :].all()
        assert not mask[1, :].any()


class TestDailyRain:
    """ThaiWater's daily rain, and the stations that report a running total instead."""

    @staticmethod
    def frame(values):
        return pd.DataFrame({
            "ts": pd.date_range("2025-11-20", periods=len(values), freq="D", tz="UTC"),
            "value": [float(v) for v in values],
        })

    def test_differences_a_gauge_that_reports_a_running_total(self):
        # Station 855 at Sadao, 20-25 November 2025, as the archive holds it.
        cleaned = spill.daily_rain(self.frame([164.2, 333.2, 454.6, 719.2, 980.4, 1035.0]),
                                   250.0, 3)
        got = [round(v, 1) for v in cleaned["value"]]
        assert got == [164.2, 169.0, 121.4, 264.6, 261.2, 54.6]
        # And the biggest day is now a figure rain can actually deliver.
        assert cleaned["value"].max() < 300

    def test_leaves_a_gauge_that_simply_rained_hard_alone(self):
        # Real daily rain goes up and down; nothing here is a running total.
        values = [120.0, 40.0, 260.0, 90.0, 180.0]
        cleaned = spill.daily_rain(self.frame(values), 250.0, 3)
        assert [round(v, 1) for v in cleaned["value"]] == values

    def test_a_short_rise_is_not_an_accumulation(self):
        # Two days rising, and never near the figure that marks a running total.
        values = [10.0, 20.0, 30.0, 5.0]
        cleaned = spill.daily_rain(self.frame(values), 250.0, 3)
        assert [round(v, 1) for v in cleaned["value"]] == values

    def test_never_returns_a_negative_day(self):
        cleaned = spill.daily_rain(self.frame([300.0, 310.0, 320.0, 1.0]), 250.0, 3)
        assert (cleaned["value"] >= 0).all()


class TestArrivals:
    def test_the_fast_speed_gives_the_earliest_and_the_slow_one_the_latest(self):
        rows = spill.arrival_rows({"901601": {"km": 7.2, "via": "main"}}, [0.5, 2.0], 0.2)
        assert len(rows) == 1
        row = rows[0]
        # 7.2 km at 2 m/s is 1 hour; at 0.5 m/s, 4 hours.
        assert row["earliest_h"] == pytest.approx(1.0, abs=0.05)
        assert row["latest_h"] == pytest.approx(4.0, abs=0.05)
        # The warning counts down to the earliest with the safety margin taken off.
        assert row["warn_from_h"] <= row["earliest_h"]
        # Nothing is measured about the peak, so it is given the same window, not a made-up one.
        assert (row["peak_earliest_h"], row["peak_latest_h"]) == (row["earliest_h"],
                                                                  row["latest_h"])

    def test_orders_the_places_by_how_far_down_the_reach_they_are(self):
        rows = spill.arrival_rows({
            "b": {"km": 9.0, "via": "main"},
            "a": {"km": 1.0, "via": "tributary"},
        }, [0.5, 2.0], 0.2)
        assert [r["tambon_code"] for r in rows] == ["a", "b"]
        assert rows[0]["earliest_h"] <= rows[1]["earliest_h"]
