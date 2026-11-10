"""Season state (Module 11): the floor, the antecedent rain and the soft notice's rule.

Offline and synthetic: short made-up series, nothing from data/ or out/.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from season_state import state

RULE = {"rose_days_min": 5, "rose_window": 7, "rain_window_days": 15}


def hourly(values: list[float], start: str = "2025-11-01 00:00") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="1h", tz="UTC")
    return pd.Series(values, index=index, dtype="float64")


def daily(values: list[float], start: str = "2025-11-01") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="1D", tz="Asia/Bangkok")
    return pd.Series(values, index=index, dtype="float64")


def wave(hours: int, period_h: float, amplitude: float, start: str = "2023-01-01") -> pd.Series:
    index = pd.date_range(start, periods=hours, freq="1h", tz="UTC")
    t = np.arange(hours, dtype="float64")
    return pd.Series(amplitude * np.sin(2 * np.pi * t / period_h), index=index, dtype="float64")


def test_the_floor_is_the_days_lowest_reading_in_bangkok_time():
    # Two Bangkok days, six hours each side of midnight, with the lowest reading inside the second.
    s = hourly([5.0, 4.0, 6.0] + [3.0, 7.0, 2.0], start="2025-11-01 00:00")
    floor = state.baseflow(s)
    assert list(floor.index.strftime("%Y-%m-%d")) == ["2025-11-01"]
    assert float(floor.iloc[0]) == 2.0


def test_a_day_with_no_reading_is_dropped_and_not_filled_in():
    s = pd.concat([hourly([4.0, 4.1], "2025-11-01 00:00"), hourly([4.4, 4.5], "2025-11-03 00:00")])
    floor = state.baseflow(s)
    assert [d.strftime("%d") for d in floor.index] == ["01", "03"]


def test_a_gap_counts_as_a_day_that_did_not_rise():
    rising = daily([1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7])
    assert float(state.rose_days(rising, 7).iloc[-1]) == 7.0
    # The same rise with the fourth day missing: the week cannot be judged, so the answer is no
    # answer rather than a count, and `grade` reads that as not rising.
    holed = rising.drop(rising.index[3])
    answer = state.rose_days(holed, 7).iloc[-1]
    assert np.isnan(answer)
    assert state.grade(None, "high", RULE)[0] != "rising_wet"


def test_the_harmonic_fit_tells_the_sea_from_a_daily_pulse():
    hours = 24 * 500
    sea = wave(hours, state.CONSTITUENTS["K1"], 0.40) + wave(hours, state.CONSTITUENTS["M2"], 0.20)
    turbine = wave(hours, 24.0, 0.40)
    sea_fit = state.harmonics(sea, min_hours=24 * 400)
    pulse_fit = state.harmonics(turbine, min_hours=24 * 400)
    assert sea_fit is not None and pulse_fit is not None
    assert sea_fit["tide_m"] > 10 * sea_fit["pulse_m"]
    assert pulse_fit["pulse_m"] > 10 * pulse_fit["tide_m"]


def test_a_gauge_with_too_little_record_is_not_judged():
    assert state.harmonics(wave(24 * 30, 24.0, 0.4), min_hours=24 * 400) is None


def test_terciles_are_withheld_below_the_minimum_number_of_seasons():
    values = pd.Series([1.0, 2.0, 3.0, 4.0], dtype="float64")
    two = state.terciles(values, np.array([2024, 2024, 2025, 2025]), min_seasons=3)
    assert two["p33"] is None and two["seasons"] == 2 and two["days"] == 4
    three = state.terciles(values, np.array([2023, 2024, 2025, 2025]), min_seasons=3)
    assert three["p50"] == 2.5 and three["seasons"] == 3


def test_a_month_without_enough_seasons_gets_no_figure():
    # Novembers of three seasons, Decembers of one.
    index = pd.DatetimeIndex(
        [f"{y}-11-{d:02d}" for y in (2023, 2024, 2025) for d in (1, 2)] + ["2025-12-01", "2025-12-02"],
        tz="Asia/Bangkok")
    values = pd.Series(range(len(index)), index=index, dtype="float64")
    by_month = state.monthly(values, min_seasons=3, months=(11, 12))
    assert by_month[11]["p50"] is not None
    assert by_month[12]["p50"] is None and by_month[12]["seasons"] == 1


def test_a_rain_window_needs_every_one_of_its_days():
    rain = daily([10.0] * 20)
    assert float(state.rain_window(rain, 15).iloc[-1]) == 150.0
    holed = rain.drop(rain.index[5])
    assert state.rain_window(holed, 15).size < state.rain_window(rain, 15).size


def test_a_day_missing_an_hour_is_not_a_days_rain():
    # 17:00 UTC is midnight in Bangkok, so these 24 hours are exactly one Bangkok day.
    full = hourly([1.0] * 24, "2025-10-31 17:00")
    assert float(state.daily_rain(full).iloc[0]) == 24.0
    assert state.daily_rain(hourly([1.0] * 20, "2025-10-31 17:00")).empty


def test_the_running_total_starts_again_each_october():
    index = pd.DatetimeIndex(["2024-10-01", "2024-10-02", "2025-01-01", "2025-10-01"], tz="Asia/Bangkok")
    rain = pd.Series([10.0, 10.0, 5.0, 7.0], index=index, dtype="float64")
    total = state.rain_since_october(rain)
    assert float(total.loc["2025-01-01"]) == 25.0  # still season 2024
    assert float(total.loc["2025-10-01"]) == 7.0   # season 2025 begins again


def test_a_figure_with_no_reference_is_unknown_and_never_normal():
    assert state.band(5.0, None) == "unknown"
    assert state.band(None, {"p33": 1.0, "p67": 2.0}) == "unknown"
    assert state.band(5.0, {"p33": None, "p50": None, "p67": None}) == "unknown"
    assert state.band(0.5, {"p33": 1.0, "p67": 2.0}) == "low"
    assert state.band(1.5, {"p33": 1.0, "p67": 2.0}) == "middle"
    assert state.band(2.5, {"p33": 1.0, "p67": 2.0}) == "high"


def test_the_notice_needs_both_legs():
    assert state.grade(6.0, "high", RULE)[0] == "rising_wet"
    assert state.grade(6.0, "middle", RULE)[0] == "rising"
    assert state.grade(2.0, "high", RULE)[0] == "wet"
    assert state.grade(2.0, "low", RULE)[0] == "quiet"
    assert state.grade(None, "high", RULE)[0] == "wet"


def test_the_reasons_name_which_leg_spoke():
    assert state.grade(6.0, "high", RULE)[1] == ["rising_week", "wet_fortnight"]
    assert state.grade(2.0, "high", RULE)[1] == ["wet_fortnight"]


def test_a_catchment_running_low_can_still_raise_the_notice():
    # November 2025 at X.40A: the floor was in the bottom third of its own record and the river went
    # over its bank two days later. A low floor must never be able to silence the rule.
    assert state.band(12.0, {"p33": 12.82, "p50": 13.01, "p67": 13.48}) == "low"
    assert state.grade(6.0, "high", RULE)[0] == "rising_wet"


def test_the_season_label_is_the_october_it_started_in():
    index = pd.DatetimeIndex(["2025-09-30", "2025-10-01", "2026-01-31"], tz="Asia/Bangkok")
    assert list(state.season_of(index)) == [2024, 2025, 2025]
