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


CFG = {"flood": {"min_hours": 3, "gap_days": 5}, "alarm": {"merge_gap_h": 48, "hit_window_h": 120}}


def flood_year(n_floods: int, base: float = 2.0, bank: float = 5.0, days: int = 400) -> pd.Series:
    """A quiet river at `base` with `n_floods` slow rises over `bank` (20 h up, 10 h over, down)."""
    v = base + 0.1 * np.sin(np.arange(days * 24) * 2 * np.pi / 24)
    for k in range(n_floods):
        t0 = 24 * 30 * (k + 1)
        up = np.linspace(base, bank + 0.5, 30)
        v[t0:t0 + 30] = up
        v[t0 + 30:t0 + 40] = bank + 0.5
        v[t0 + 40:t0 + 70] = up[::-1]
    return series(v, start="2018-01-01")


def test_gauge_levels_rise_from_watch_to_evacuate_at_the_bank():
    from thresholds import gauges as gs

    level = pd.concat([flood_year(5), flood_year(0, days=800).shift(400 * 24, freq="1h")])
    out = gs.suggest(level, 5.0, CFG)
    assert out["evacuate"] == 5.0
    assert out["watch"] < out["warning"] < out["evacuate"]
    assert out["floods"] == 5


def test_gauge_levels_fall_back_to_rises_with_too_few_floods():
    from thresholds import gauges as gs

    out = gs.suggest(flood_year(1, days=1200), 5.0, CFG)
    assert out["warning_method"] == "rise" and out["watch_method"] == "rise"
    assert out["watch"] < out["warning"] < out["evacuate"]


def test_a_level_the_river_sits_above_for_weeks_is_lifted():
    from thresholds import gauges as gs

    # A tidal gauge: up and down by a metre twice a day, bank just over the high tide.
    hours = np.arange(24 * 800)
    tide = 0.6 * np.sin(hours * 2 * np.pi / 12.4)
    out = gs.suggest(series(tide, start="2018-01-01"), 0.7, CFG)
    assert gs.share_above(series(tide, start="2018-01-01"), out["warning"]) <= 0.031
    assert out["bank_suspect"]


def test_tide_split_and_match_find_a_lagged_damped_tide():
    from thresholds import tide

    hours = np.arange(24 * 60)
    sea = series(0.5 * np.sin(hours * 2 * np.pi / 12.42) + 0.1 * np.sin(hours * 2 * np.pi / (24 * 15)))
    # A lake: half the range, two hours late, and a river on top that rises slowly.
    lake = series(0.25 * np.sin((hours - 2) * 2 * np.pi / 12.42) + np.linspace(0, 1, len(hours)))
    m_tide, _ = tide.split(sea)
    g_tide, _ = tide.split(lake)
    best = tide.best_match(m_tide, g_tide)
    assert best["lag_h"] == 2 and best["r"] > 0.95
    assert 0.45 < best["spread_ratio"] < 0.55
    assert tide.verdict({"tidal": best}) == "tidal, follows the model"


def test_tide_over_bank_counts_hours_the_tide_alone_explains():
    from thresholds import tide

    hours = np.arange(24 * 20)
    level = series(0.9 + 0.4 * np.sin(hours * 2 * np.pi / 12.42))
    out = tide.tide_over_bank(level, 1.2)
    assert out["hours_over"] > 0 and out["tide_only"] == out["hours_over"]


def test_forecast_ahead_and_behind_sum_the_right_hours():
    from thresholds import forecast as fc

    rain = series([1.0] * 100)
    rain.iloc[50] = 11.0
    # From hour 0 the next 72 hours hold hour 50: 71 x 1 + 11.
    assert fc.ahead(rain).iloc[0] == 82.0
    # Hours 0 to 71 hold hour 50 too; before 65 hours of record there is no total yet.
    assert fc.behind(rain).iloc[71] == 82.0
    assert pd.isna(fc.behind(rain).iloc[40])


def test_forecast_check_scores_a_rule_that_sees_the_flood_coming():
    from thresholds import forecast as fc

    idx = pd.date_range("2024-11-01", periods=24 * 30, freq="1h", tz="UTC")
    day3 = pd.Series(0.0, index=idx)
    day3["2024-11-20":"2024-11-22"] = 3.0          # 216 mm forecast for these three days
    forecast = pd.DataFrame({"day1": day3, "day2": day3, "day3": day3})
    observed = pd.Series(0.0, index=idx)
    observed["2024-11-20":"2024-11-22"] = 4.0
    onset = pd.Timestamp("2024-11-22 18:00", tz="UTC")
    out = fc.zone_check(forecast, observed, [onset], 180.0, [(idx[0], idx[-1])],
                        {"merge_gap_h": 48, "hit_window_h": 120})
    assert out["forecast_rule"]["detected"] == 1
    assert out["forecast_rule"]["median_lead_h"] > out["observed_rule"]["median_lead_h"]
    assert out["floods"][0]["forecast_day1_mm"] == 198.0
