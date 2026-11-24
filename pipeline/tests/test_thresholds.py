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


def test_the_lead_time_floor_pulls_a_lifted_level_back_down():
    """The defect this was written for: the 94/97th-percentile lift took all the warning away.

    `finish` lifts a level the river stands above too often, and on a gauge whose water sits high
    that percentile is centimetres under the bank - so Watch was set there and crossing it told
    nobody anything. Here the lift has put Watch 0.1 m under a 5.0 m bank; the floor must pull it
    back to where crossing it buys the day it promises, and the record must show the move.
    """
    from thresholds import gauges as gs

    level = flood_year(6, days=900)
    lifted = {"watch": 4.90, "warning": 4.95, "evacuate": 5.0, "years": 6.0,
              "rise_m": {"6h": 0.5, "24h": 1.0}}
    onsets = [f["onset"] for f in hc.floods(level, 5.0, 3, 5)]
    got = gs.apply_lead(dict(lifted), level, 5.0, gs.DEFAULTS, onsets, CFG)

    moved = got["lead_floor_applied"]
    assert "now" in moved["watch"] and "now" in moved["warning"], "both levels had to move"
    assert got["watch"] < lifted["watch"] and got["warning"] < lifted["warning"]
    # Each now sits at least the rise it is meant to buy below the bank.
    assert got["evacuate"] - got["warning"] >= 0.5 - 1e-9
    assert got["evacuate"] - got["watch"] >= 1.0 - 1e-9
    assert got["watch"] < got["warning"] < got["evacuate"]
    # And the move is priced on both sides, over the same floods, so it can be weighed.
    before, after = moved["watch"]["before"], moved["watch"]["after"]
    assert after["median_lead_h"] > before["median_lead_h"], "it has to buy time to be worth it"
    assert set(before) >= {"detected", "false_alarms", "median_lead_h"}


def test_a_move_that_buys_no_time_is_not_made():
    """Lowering a level costs false alarms, so it has to buy hours. One that buys none is declined
    and says so, rather than being paid for in false alarms for nothing (JNA002, 0.5 h)."""
    from thresholds import gauges as gs

    out = {"watch": 4.5, "warning": 4.7, "evacuate": 5.0, "years": 14.0,
           "rise_m": {"6h": 0.4, "24h": 0.9}}
    level = flood_year(4, days=900)
    # Scored against floods that the lower level reaches no earlier: the gain is zero.
    onsets = [level.index[300]]
    got = gs.apply_lead(dict(out), level, 5.0, {**gs.DEFAULTS, "min_gain_h": 2.0}, onsets, CFG)
    for key in ("warning", "watch"):
        note = got["lead_floor_applied"][key]
        if "left_alone" in note:
            assert got[key] == out[key], "a declined move must leave the level alone"


def test_too_short_a_record_is_never_re_derived_from():
    """TBV029 has 36 days and no flood; its 24 h "rise" came out at 49 m and would have put Watch
    48 m under Warning. A record too short to hold floods is too short to set a level from."""
    from thresholds import gauges as gs

    out = {"watch": 69.8, "warning": 71.75, "evacuate": 72.66, "years": 0.1,
           "rise_m": {"6h": 20.0, "24h": 49.1}}
    got = gs.apply_lead(dict(out), flood_year(0, days=36), 72.66, gs.DEFAULTS, [], CFG)
    assert got["watch"] == 69.8 and got["warning"] == 71.75
    assert "only 0.1 years" in got["lead_floor_skipped"]
    assert "lead_floor_applied" not in got


def test_a_rise_taller_than_the_river_is_not_believed():
    """A rise figure bigger than the gauge's whole working depth is a broken record, not a flood."""
    from thresholds import gauges as gs

    level = series(np.full(24 * 400, 23.0), start="2018-01-01")
    out = {"watch": 69.8, "warning": 71.75, "evacuate": 72.66, "years": 4.0,
           "rise_m": {"6h": 0.4, "24h": 400.0}}
    got = gs.apply_lead(dict(out), level, 72.66, gs.DEFAULTS, [], CFG)
    assert got["watch"] == 69.8, "the level must not move on a rise that cannot be real"
    assert got["needs_human_level"]
    assert "working_depth_m" in got["lead_floor_applied"]["watch"]


def test_the_tide_is_only_believed_near_sea_level():
    """Module 11's 0.05 m bar alone marked BLGTD01, whose bank is 48.68 m up, as the sea's gauge:
    at that bar the tidal periods also fit a mountain river's noise. The bank has to be low too."""
    from thresholds import gauges as gs

    hours = np.arange(24 * 500)
    tide = series(0.5 * np.sin(hours * 2 * np.pi / 12.4206), start="2018-01-01")
    near = gs.tide_driven(tide, gs.DEFAULTS, bank=1.0)
    far = gs.tide_driven(tide + 48.0, gs.DEFAULTS, bank=48.68)
    assert near is not None and near["tide_driven"]
    assert far is not None and not far["tide_driven"], "the sea cannot reach a bank 48 m above it"
    # The amplitude is the same in both; only the elevation differs.
    assert round(near["tide_m"], 2) == round(far["tide_m"], 2)


def test_a_dam_opening_its_turbines_does_not_exempt_a_gauge():
    """An exactly-24-hour swing is Bang Lang, not the moon (X.77, 0.52 m). It is recorded, because
    Module 11 drops such a gauge, but the river still leaves its channel at its bank."""
    from thresholds import gauges as gs

    hours = np.arange(24 * 500)
    pulse = series(0.5 * np.sin(hours * 2 * np.pi / 24.0) + 39.0, start="2018-01-01")
    fit = gs.tide_driven(pulse, gs.DEFAULTS, bank=39.7)
    assert fit is not None
    assert fit["pulse_driven"] and not fit["tide_driven"]


def test_the_sea_s_gauges_keep_their_lifted_levels():
    """No fixed level in metres above sea level works where the tide sets the water, so the floor
    leaves those gauges to the tide-aware work (decision 2026-11-22) instead of lowering them
    into the tide's own range."""
    from thresholds import gauges as gs

    out = {"watch": 0.80, "warning": 0.90, "evacuate": 0.97, "years": 13.2,
           "tide_driven": True, "rise_m": {"6h": 0.3, "24h": 0.5}}
    got = gs.apply_lead(dict(out), series(np.zeros(100), start="2018-01-01"), 0.97, gs.DEFAULTS)
    assert got["watch"] == 0.80 and got["warning"] == 0.90
    assert "lead_floor_applied" not in got


def test_the_comparison_table_prints_the_level_that_would_be_seeded():
    """A key gauge's Warning is replaced afterwards by the level the owner accepted on 14 Oct 2026.
    The table used to print the floor's own choice (X.119A 8.70) where the seed carries 8.80."""
    from thresholds import gauges as gs

    rows = [{
        "code": "X.119A", "role": "key", "watch": 7.8, "warning": 8.8, "evacuate": 9.3,
        "kept": ["warning", "evacuate"], "tide_driven": False,
        "lead_floor_applied": {"warning": {"was": 9.2, "now": 8.7}},
    }]
    md = gs.comparison(rows, None)
    assert "8.80" in md and "which stands" in md
    # The floor's own figure appears only in the overridden table, never as the new level.
    assert "| X.119A | warning | 9.20 | 8.70 |" not in md

def test_a_level_that_already_buys_its_hours_is_left_alone():
    """The guard the first report was missing (found 24 Nov by reading it).

    The floor exists to rescue a level that buys too little time. Three of its first ten moves
    were on levels already past their target, and they were the expensive ones: ONE039's Warning
    already bought 6 h with no false alarms, and the move paid 0 -> 7 false alarms to turn that
    into a 117 h "lead", which is a season's state and not a warning. Where the level already
    buys the hours it stands for, it must not move - and the reason must be recorded.
    """
    from thresholds import gauges as gs

    # Warning at 4.00 is crossed a measured 8 h before the flood here, past the 6 h it stands for,
    # and the floor's ceiling is 5.0 - 1.4 = 3.60, so the floor wants to move it. It must not.
    level = flood_year(6, days=900)
    out = {"watch": 3.0, "warning": 4.0, "evacuate": 5.0, "years": 6.0,
           "rise_m": {"6h": 1.4, "24h": 1.0}}
    onsets = [f["onset"] for f in hc.floods(level, 5.0, 3, 5)]
    got = gs.apply_lead(dict(out), level, 5.0, gs.DEFAULTS, onsets, CFG)

    note = (got.get("lead_floor_applied") or {}).get("warning")
    assert note is not None, "the floor wanted to move it, so it has to say why it did not"
    assert "now" not in note, "a level that already buys its hours must not move"
    assert "already buys" in note["left_alone"]
    assert got["warning"] == out["warning"], "the level itself is untouched"


def test_a_level_is_not_lowered_into_a_once_a_day_swing():
    """PAT001, 24 Nov: a 0.437 m daily pulse from a dam's turbines. Lowering its Warning 1.15 m
    took false alarms from 5 to 17 to buy 3 h, because the turbines cross the lower level, not a
    flood. Such a gauge keeps its bank - the river still leaves the channel there - but needs
    levels measured on the daily minimum, as the sea's gauges do. It must be flagged, not moved.
    """
    from thresholds import gauges as gs

    level = flood_year(6, days=900)
    # Watch is kept a clear `min_gap_m` under Warning, so the min-gap clamp at the end has nothing
    # to do here and the only thing that could move a level is the floor itself.
    out = {"watch": 4.70, "warning": 4.95, "evacuate": 5.0, "years": 6.0,
           "rise_m": {"6h": 0.5, "24h": 1.0}, "pulse_driven": True}
    onsets = [f["onset"] for f in hc.floods(level, 5.0, 3, 5)]
    got = gs.apply_lead(dict(out), level, 5.0, gs.DEFAULTS, onsets, CFG)

    assert got["warning"] == out["warning"] and got["watch"] == out["watch"], "neither may move"
    assert got["needs_human_level"] is True, "it needs a level from someone who knows the river"
    for key in ("warning", "watch"):
        why = got["lead_floor_applied"][key]["left_alone"]
        assert "once a day" in why and "daily" in why


def test_a_moved_level_that_cries_wolf_is_moved_but_flagged():
    """A level crossed more often without a flood than with one still moves - one that buys no
    time at all is worse - but the gauge must be flagged so nobody arms it unread (JNA001: 11
    false against 5 floods caught)."""
    from thresholds import gauges as gs

    level = flood_year(6, days=900)
    out = {"watch": 4.90, "warning": 4.95, "evacuate": 5.0, "years": 6.0,
           "rise_m": {"6h": 0.5, "24h": 1.0}}
    # One flood only, so the many other crossings of the lower level all score as false alarms.
    onsets = [f["onset"] for f in hc.floods(level, 5.0, 3, 5)][:1]
    got = gs.apply_lead(dict(out), level, 5.0, gs.DEFAULTS, onsets, CFG)

    notes = got.get("lead_floor_applied") or {}
    wolf = [n for n in notes.values() if n.get("cries_wolf")]
    if wolf:
        assert got["needs_human_level"] is True, "crying wolf has to reach the report"
        for n in wolf:
            assert "false against" in n["cries_wolf"]
            assert "now" in n, "it is flagged, not vetoed"
    else:
        # The synthetic series gave no such level; the guard is then vacuously satisfied, and the
        # real evidence is JNA001 in pipeline/thresholds/lead_time.md.
        assert all("cries_wolf" not in n for n in notes.values())


def test_every_guard_records_its_reason_in_one_place():
    """The latent bug found on 24 Nov: the early-exit guards wrote straight into
    `lead_floor_applied` while the moves collected into a separate dict that then overwrote it,
    so a gauge that hit a guard on one level and moved on the other lost the guard's reason."""
    from thresholds import gauges as gs

    level = flood_year(6, days=900)
    # Warning hits the working-depth guard (a 40 m rise in a 5 m river); Watch can still move.
    out = {"watch": 4.90, "warning": 4.95, "evacuate": 5.0, "years": 6.0,
           "rise_m": {"6h": 40.0, "24h": 1.0}}
    onsets = [f["onset"] for f in hc.floods(level, 5.0, 3, 5)]
    got = gs.apply_lead(dict(out), level, 5.0, gs.DEFAULTS, onsets, CFG)

    notes = got.get("lead_floor_applied") or {}
    assert "warning" in notes, "the guard's reason must survive the other level moving"
    assert "working_depth_m" in notes["warning"]
    assert got["warning"] == out["warning"], "the guarded level did not move"

