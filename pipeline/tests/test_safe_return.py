"""The safe-return window (Module 5): events, the fall back below a level, censoring, the spread per
gauge and the seed. Offline and synthetic: short made-up series, nothing from data/ or out/."""

from __future__ import annotations

import numpy as np
import pandas as pd

from safe_return import output, recession

OPTS = {"min_hours": 3, "stay_below_h": 12, "bridge_h": 3, "peak_guard_h": 6, "max_above_bank_m": 4.0,
        "season_start_month": 10}


def series(values, start="2024-11-20"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="1h", tz="UTC"), dtype=float)


def flood(rise, peak, fall, before=30, after=40, low=1.0):
    """Low water, a straight rise to `peak` over `rise` hours, a straight fall over `fall` hours, low water."""
    up = np.linspace(low, peak, rise + 1)[1:]
    down = np.linspace(peak, low, fall + 1)[1:]
    return [low] * before + list(up) + list(down) + [low] * after


def test_clean_drops_broken_readings_and_bridges_only_short_gaps():
    v = [1.0, 2.0, np.nan, np.nan, 5.0, 30.0, 6.0] + [np.nan] * 5 + [9.0]
    s = recession.clean(series(v), bank_m=5.0, max_above_bank_m=4.0, bridge_h=3)
    out = s.to_numpy()
    assert out[2] == 3.0 and out[3] == 4.0            # two missing hours bridged by a straight line
    assert out[5] == 5.5                              # 30 m is a broken sensor: dropped, then bridged
    assert np.isnan(out[7:12]).all()                  # a five-hour gap stays a gap, edges included
    assert out[12] == 9.0


def test_groups_merge_short_dips_and_need_a_long_enough_spell():
    on = np.array([0, 1, 1, 1, 0, 0, 1, 1, 0] + [0] * 20 + [1, 1, 0] + [0] * 20, bool)
    g = recession.groups(on, stay_below_h=12, min_hours=3)
    assert g == [(1, 7)]                              # dip of 2 h merged; the 2-hour spell later is too short


def test_a_dip_shorter_than_the_stay_is_not_a_return():
    level = np.array([5, 5, 2, 2, 2, 5, 5, 2] + [2] * 12, dtype=float)
    pos, known, censored = recession.stays_below(level, 0, 4.0, 6)
    assert (pos, censored) == (7, False)              # the three-hour dip at 2-4 did not last six hours


def test_durations_run_from_the_peak_to_staying_below():
    # A straight fall from 6 m to 1 m in 20 hours: 0.25 m an hour.
    lv = series(flood(rise=10, peak=6.0, fall=20))
    evs = recession.events(lv, warning_m=4.0, bank_m=5.0, opts=OPTS)
    assert len(evs) == 1
    e = evs[0]
    assert e["peak_m"] == 6.0 and e["over_bank"] and e["dropped"] is None
    # Exactly 5.0 m four hours after the peak (still at the bank), below it at five; below 4 m at nine.
    assert e["to_bank_h"] == 5.0 and e["to_warning_h"] == 9.0
    assert not e["to_bank_censored"] and not e["to_warning_censored"]
    # Hours at or above 5 m: 5.0 and 5.5 on the rise, the peak, 5.75 .. 5.0 on the fall.
    assert e["above_bank_h"] == 7
    assert e["season"] == 2024


def test_an_event_below_the_bank_has_no_time_to_bank():
    e = recession.events(series(flood(rise=6, peak=4.8, fall=12)), 4.0, 5.0, OPTS)[0]
    assert not e["over_bank"] and e["to_bank_h"] is None and e["above_bank_h"] == 0
    assert e["to_warning_h"] is not None


def test_a_gap_in_the_fall_censors_and_a_gap_at_the_peak_drops():
    v = flood(rise=10, peak=6.0, fall=40)            # 0.125 m an hour: at or above the bank for 8 hours
    peak = 30 + 9
    falling = list(v)
    for i in range(peak + 7, peak + 17):             # ten missing hours while still above the bank
        falling[i] = np.nan
    e = recession.events(series(falling), 4.0, 5.0, OPTS)[0]
    assert e["dropped"] is None
    assert e["to_bank_censored"] and e["to_warning_censored"]
    assert e["to_bank_h"] == 6.0                     # a lower bound: still above when the record stopped
    at_peak = list(v)
    for i in range(peak + 2, peak + 7):
        at_peak[i] = np.nan
    assert recession.events(series(at_peak), 4.0, 5.0, OPTS)[0]["dropped"] == "gap_at_peak"


def test_a_record_ending_above_is_censored_and_one_starting_above_is_dropped():
    v = flood(rise=10, peak=6.0, fall=30, after=0)[: 30 + 10 + 8]
    e = recession.events(series(v), 4.0, 5.0, OPTS)[0]
    assert e["to_warning_censored"] and e["to_bank_censored"]
    starts_high = [5.5, 5.4, 5.2, 4.8, 4.2] + [1.0] * 30
    assert recession.events(series(starts_high), 4.0, 5.0, OPTS)[0]["dropped"] == "starts_in_gap"


def test_two_floods_a_day_apart_are_two_events_and_a_double_peak_is_one():
    two = flood(rise=5, peak=6.0, fall=10, after=24) + flood(rise=5, peak=5.5, fall=10, before=0)
    assert len(recession.events(series(two), 4.0, 5.0, OPTS)) == 2
    double = flood(rise=5, peak=6.0, fall=3, after=0, low=3.5) + flood(rise=3, peak=6.5, fall=10, before=2, low=3.5)
    evs = recession.events(series(double), 4.0, 5.0, OPTS)
    assert len(evs) == 1 and evs[0]["peak_m"] == 6.5


def test_an_event_outside_the_flood_months_is_dropped():
    v = flood(rise=10, peak=6.0, fall=20)
    april = recession.events(series(v, start="2026-04-01"), 4.0, 5.0, {**OPTS, "months": [10, 11, 12, 1, 2]})
    assert april[0]["dropped"] == "off_season" and april[0]["to_bank_h"] is None
    november = recession.events(series(v), 4.0, 5.0, {**OPTS, "months": [10, 11, 12, 1, 2]})
    assert november[0]["dropped"] is None
    known = recession.events(series(v), 4.0, 5.0, {**OPTS, "exclude": [("2024-11-20", "2024-11-25")]})
    assert known[0]["dropped"] == "excluded"


def test_summary_counts_censored_apart_and_gives_no_range_under_the_minimum():
    def ev(tb, tw, cens=False, over=True, drop=None):
        return {"dropped": drop, "over_bank": over, "to_bank_h": tb, "to_bank_censored": cens,
                "to_warning_h": tw, "to_warning_censored": cens, "above_bank_h": 10, "season": 2024}
    evs = [ev(10, 20), ev(20, 30), ev(30, 40), ev(40, 50), ev(99, 99, cens=True), ev(None, None, drop="gap_at_peak")]
    s = recession.summarise(evs, min_events=3)
    assert s["events"] == 5 and s["censored"] == 1 and s["dropped"] == {"gap_at_peak": 1}
    assert s["to_bank_h"]["p50"] == 25.0 and s["to_bank_h"]["max"] == 40.0     # the censored 99 is left out
    assert s["to_warning_range"] == {"low_h": 27, "high_h": 43, "text": "27–43 h"}
    with_short = recession.summarise(evs + [ev(None, 2, over=False)] * 3, min_events=3)
    assert with_short["to_warning_h"]["p50"] == 20.0                 # short Warning-only falls pull it down
    assert with_short["to_warning_h_over_bank"]["p50"] == 35.0       # the over-bank floods alone do not
    few = recession.summarise(evs[:2], min_events=3)
    assert few["few_events"] and few["to_bank_h"]["p50"] is None and few["to_bank_h"]["n"] == 2


def test_typical_range_goes_to_half_days_past_two_days():
    assert recession.typical_range(30.2, 47.5)["text"] == "30–48 h"
    r = recession.typical_range(40.0, 80.0)
    assert (r["low_h"], r["high_h"], r["text"]) == (36, 84, "1.5–3.5 days")
    assert recession.typical_range(20.4, 70.0)["text"] == "20 h – 3 days"
    assert recession.typical_range(None, 5.0) is None


def test_season_is_named_by_its_october():
    assert recession.season_of(pd.Timestamp("2025-01-07", tz="UTC")) == 2024
    assert recession.season_of(pd.Timestamp("2024-10-01", tz="UTC")) == 2024
    assert recession.season_of(pd.Timestamp("2024-09-30", tz="UTC")) == 2023


def test_levels_are_read_from_seed_47_and_seed_48_matches_by_thaiwater_id():
    sql = ("insert ...\n"
           "  (2583, 15.75::double precision, 16.0::double precision, 16.5::double precision, "
           "'{\"how\": \"rise\", \"bank_suspect\": false, \"note\": \"it''s\"}'),\n"
           "  (562808, null::double precision, null::double precision, null::double precision, '{}')\n")
    lv = output.read_levels(sql)
    assert lv[2583]["warning"] == 16.0 and lv[2583]["evacuate"] == 16.5 and lv[2583]["method"]["note"] == "it's"
    assert lv[562808]["warning"] is None
    s = recession.summarise([], min_events=3)
    g = {"code": "X.40A", "thaiwater_id": 2583, "zone": "pattani_river", "role": "key", "warning": 16.0, "bank": 16.5,
         "flags": {"tidal": False}, "summary": s, "durations": {"to_bank_h": [], "to_warning_h": []},
         "record": {}, "usable": False}
    cfg = {"events": OPTS, "summary": {"min_events": 3}}
    text = output.seed_sql([g], cfg, "2026-10-15")
    assert "join public.stations s on s.thaiwater_id = v.thaiwater_id" in text
    assert "(2583, 0::integer, null::double precision" in text
    assert "on conflict (station_id) do update" in text
