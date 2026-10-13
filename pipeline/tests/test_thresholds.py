"""The hindcast's arithmetic and the catchment trace. Offline: no Earth Engine, no network."""

from __future__ import annotations

import numpy as np
import pandas as pd

from thresholds import basins
from thresholds import hindcast as hc


def series(values, start="2024-11-01"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="1h", tz="UTC"), dtype=float)


def test_upstream_follows_the_pointers_back_from_the_outlet():
    # Two valleys. Left: everything flows east along row 1 to (1, 3). Right column drains south.
    p = np.zeros((3, 5), "int16")
    p[1, 0:3] = 2          # east
    p[0, 0:3] = 8          # south, into row 1
    p[2, 0:3] = 128        # north, into row 1
    p[:, 4] = 8            # a separate stream running south
    p[0, 3] = 2            # joins the separate stream
    mask = basins.upstream(p, 1, 3)
    assert mask[1, :4].all() and mask[0, :3].all() and mask[2, :3].all()
    assert not mask[:, 4].any() and not mask[0, 3]
    assert int(mask.sum()) == 10


def test_snap_moves_a_gauge_onto_the_stream():
    accum = np.ones((9, 9), "float32")
    accum[2, 6] = 500
    assert basins.snap(accum, 4, 4, 3) == (2, 6)
    assert basins.snap(accum, 4, 4, 1) != (2, 6)


def test_floods_need_the_minimum_hours_and_merge_across_a_short_dip():
    level = series([1, 1, 5, 5, 5, 1, 5, 5, 1, 1] + [1] * 200 + [5, 5, 1, 1])
    found = hc.floods(level, 5.0, min_hours=3, gap_days=2)
    assert len(found) == 1                      # the two-hour spell at the end is too short
    f = found[0]
    assert f["onset"] == level.index[2] and f["end"] == level.index[7]
    assert f["hours_over"] == 5 and f["peak_m"] == 5.0


def test_season_of_names_a_season_by_its_first_year():
    assert hc.season_of(pd.Timestamp("2024-11-28", tz="UTC")) == 2024
    assert hc.season_of(pd.Timestamp("2025-01-15", tz="UTC")) == 2024
    assert hc.season_of(pd.Timestamp("2025-06-01", tz="UTC")) is None


def test_rolling_sum_is_missing_when_too_much_rain_is_missing():
    rain = series([1.0] * 48)
    assert hc.rolling_sum(rain, 24).iloc[-1] == 24.0
    gappy = rain.copy()
    gappy.iloc[30:40] = np.nan
    assert np.isnan(hc.rolling_sum(gappy, 24).iloc[45])


def test_before_reads_the_signal_at_each_lead():
    sig = series(np.arange(100.0))
    onset = sig.index[80]
    assert hc.before(sig, onset, [72, 24, 6]) == {72: 8.0, 24: 56.0, 6: 74.0}
    assert hc.before(sig, sig.index[10], [72])[72] is None


def test_score_counts_hits_false_alarms_and_unjudged_ones():
    idx = pd.date_range("2024-11-01", periods=24 * 40, freq="1h", tz="UTC")
    onset = idx[24 * 10]
    alarms = [(idx[24 * 9], idx[24 * 9 + 5]),        # a day before the flood: hit, lead 24 h
              (idx[24 * 20], idx[24 * 20 + 3]),      # nothing follows: false
              (idx[24 * 30], idx[24 * 30 + 3])]      # the gauge was silent: unjudged
    judged = pd.Series(True, index=idx)
    judged.iloc[24 * 29:] = False
    s = hc.score(alarms, [onset], hit_window_h=48, judged=judged)
    assert (s["hits"], s["false_alarms"], s["unjudged_alarms"]) == (1, 1, 1)
    assert s["detected"] == 1 and s["missed"] == 0 and s["pod"] == 1.0 and s["far"] == 0.5
    assert s["median_lead_h"] == 24.0
    assert s["csi"] == 0.5
    # an alarm that starts after the flood began does not detect it
    late = hc.score([(idx[24 * 10 + 2], idx[24 * 11])], [onset], 48, judged)
    assert late["detected"] == 0 and late["missed"] == 1 and late["false_alarms"] == 1


def test_choose_takes_the_best_balance_among_the_timely_candidates():
    def row(threshold, detected, false, lead):
        return {"threshold": threshold, "floods": 4, "detected": detected, "missed": 4 - detected, "false_alarms": false,
                "csi": round(detected / (4 + false), 2), "median_lead_h": lead, "shortest_lead_h": lead}

    rows = [row(100, 4, 6, 40), row(150, 4, 2, 30), row(200, 3, 0, 20), row(180, 4, 0, 2)]
    assert hc.choose(rows, min_lead_h=12)["threshold"] == 200      # 3 of 4 with no false alarm beats 4 of 4 with two
    assert hc.choose(rows, min_lead_h=0)["threshold"] == 180       # perfect, but only two hours ahead
    assert hc.choose(rows, min_lead_h=25)["threshold"] == 150
    assert hc.choose([row(300, 0, 0, None)], 0) is None
