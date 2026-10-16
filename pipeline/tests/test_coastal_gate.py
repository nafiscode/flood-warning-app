"""The coastal gate (Module 10): the Godin filter, the daily low and high water, the flood-season
reference, the spells with no low-water window, the wind link and the seed. Offline and synthetic:
short made-up series, nothing from data/ or out/."""

from __future__ import annotations

import numpy as np
import pandas as pd

from coastal_gate import gate, output

CFG = {
    "archive": {"first": "2022-11-01", "last": "2026-10-15"},
    "filter": {"godin": [24, 24, 25], "min_hours_per_day": 20},
    "reference": {"months": [10, 11, 12, 1], "percentiles": [50, 90, 98]},
    "flag": {"shut_percentile": 90, "shut_days": 2},
}


def sea(hours: int, start="2024-11-01", mean=0.9, range_m=0.9, setup=None):
    """Hourly sea level: a diurnal tide of `range_m` on a mean of `mean`, plus an optional set-up."""
    idx = pd.date_range(start, periods=hours, freq="1h", tz="UTC")
    h = np.arange(hours)
    values = mean + (range_m / 2) * np.sin(h / 12.42 * 2 * np.pi)
    if setup is not None:
        values = values + setup(h)
    return pd.Series(values, index=idx, dtype=float)


def test_godin_takes_out_the_tide_and_keeps_the_slow_part():
    # A step of 0.4 m in the middle: the filter should find it and lose the tide around it.
    step = lambda h: np.where(h > 24 * 20, 0.4, 0.0)
    s = sea(24 * 40, setup=step)
    slow = gate.godin(s).dropna()
    tide = (s - gate.godin(s)).dropna()
    assert tide.std() > 0.25                       # the tide is in the tidal band
    assert slow.diff().abs().max() < 0.05          # and gone from the slow part
    assert slow.iloc[-1] - slow.iloc[0] > 0.3      # the step survives


def test_godin_beats_a_single_25_hour_mean_on_a_diurnal_tide():
    """Why this module does not reuse thresholds/tide.py `split`: the Gulf's tide is diurnal."""
    s = sea(24 * 40, range_m=1.0)
    plain = s.rolling(25, center=True).mean().dropna()
    godin = gate.godin(s).dropna()
    # Both should be flat; the single mean lets several centimetres of the tide through.
    assert (plain.max() - plain.min()) > 3 * (godin.max() - godin.min())


def test_daily_reads_bangkok_days_and_drops_short_ones():
    s = sea(24 * 5, start="2024-11-01 06:00")
    days = gate.daily(s, min_hours=20)
    # A Bangkok day starts at 17:00 UTC the day before, so the first and last are part days:
    # 120 hours from 13:00 Bangkok on 1 Nov leave four whole days, 2 to 5 November.
    assert list(days["hours"]) == [24] * len(days)
    assert len(days) == 4
    assert [str(d.date()) for d in days.index] == ["2024-11-02", "2024-11-03", "2024-11-04", "2024-11-05"]
    first = days.iloc[0]
    assert first["range"] == first["hhw"] - first["llw"]
    assert first["llw"] < first["mean"] < first["hhw"]


def test_reference_uses_the_season_months_only():
    season = sea(24 * 40, start="2024-11-01", mean=1.2)
    june = sea(24 * 40, start="2024-06-01", mean=0.2)
    days = gate.daily(pd.concat([june, season]))
    ref = gate.reference(days, CFG["reference"]["months"], CFG["reference"]["percentiles"])
    # The quiet June days must not drag the season percentiles down.
    assert ref["llw_p50"] > 0.6
    assert ref["days"] == len(days[days.index.month.isin([10, 11, 12, 1])])
    assert ref["llw_p50"] <= ref["llw_p90"] <= ref["llw_p98"]


def test_reference_is_empty_rather_than_guessed_without_season_days():
    days = gate.daily(sea(24 * 10, start="2024-06-01"))
    assert gate.reference(days, [10, 11, 12, 1], [50, 90, 98]) == {"days": 0}


def test_spells_need_consecutive_days_over_the_line():
    s = sea(24 * 12, start="2024-11-01", setup=lambda h: np.where((h > 24 * 3) & (h < 24 * 6), 0.6, 0.0))
    days = gate.daily(s)
    line = float(days["llw"].quantile(0.5))
    runs = gate.spells(days, line, min_days=2)
    assert runs and all(r["days"] >= 2 for r in runs)
    # One day alone is a tide, not a gate.
    assert gate.spells(days.iloc[:1], -9.0, min_days=2) == []


def test_onshore_stress_is_signed_and_squares_the_speed():
    idx = pd.date_range("2024-11-01", periods=3, freq="1h", tz="UTC")
    speed = pd.Series([10.0, 10.0, 10.0], index=idx)
    # From 045 is straight onshore; from 225 is straight offshore; 135 is along the shore.
    direction = pd.Series([45.0, 225.0, 135.0], index=idx)
    out = gate.onshore_stress(speed, direction)
    assert out.iloc[0] == 100.0
    assert out.iloc[1] == -100.0
    assert abs(out.iloc[2]) < 1e-9


def test_wind_link_finds_a_set_up_the_wind_explains():
    hours = 24 * 120
    h = np.arange(hours)
    blow = 6 + 6 * np.sin(h / (24 * 10) * 2 * np.pi)          # a ten-day wind cycle
    s = sea(hours, start="2024-10-15", setup=lambda x: 0.02 * blow[x])
    idx = s.index
    link = gate.wind_link(
        s,
        gate.onshore_stress(pd.Series(blow, index=idx), pd.Series(45.0, index=idx)),
        CFG["reference"]["months"],
    )
    assert link["r_season"] > 0.8
    assert set(link["r_by_lag_h"]) == {0, 12, 24, 36, 48}


def test_window_figures_place_a_flood_against_the_season():
    quiet = sea(24 * 60, start="2024-10-01", mean=0.8)
    high = sea(24 * 8, start="2024-11-30", mean=1.4, range_m=0.3)
    days = gate.daily(pd.concat([quiet, high]))
    ref = gate.reference(days, CFG["reference"]["months"], CFG["reference"]["percentiles"])
    figures = output.window_figures(days, ref, "2024-12-01", "2024-12-06")
    assert figures["llw_pct"] > 90                 # the low water sat near the top of the record
    assert figures["shut_days"] >= 2
    assert output.window_figures(days, ref, "2025-06-01", "2025-06-05") is None


def test_windows_from_timeline_takes_the_outer_dates(tmp_path):
    csv = tmp_path / "event_timeline.csv"
    csv.write_text(
        "event,zone,province,district,flood_onset,peak,receded,source_link,source_date,confidence,note\n"
        "2024,kolok,Narathiwat,A,2024-11-27,2024-11-28T18:00,2024-12-04,,,high,\n"
        "2024,kolok,Narathiwat,B,2024-11-26,,,,,low,\n"
        "2024,other,Narathiwat,C,2024-01-01,,2024-01-09,,,low,\n"
        "2025,kolok,Narathiwat,A,,,,,,low,\n"            # nothing known: no window
        "2025b,kolok,Narathiwat,A,2025-12-18,,,,,medium,\n",  # onset only: a one-day window
        encoding="utf-8",
    )
    out = output.windows_from_timeline(csv, "kolok")
    assert out["2024"] == ("2024-11-26", "2024-12-04")
    assert "2025" not in out
    assert out["2025b"] == ("2025-12-18", "2025-12-18")


def test_seed_sql_joins_a_zone_by_basin_and_allows_a_mouth_without_one():
    mouths = [
        {"id": "kolok", "name": {"en": "Kolok"}, "zone": "kolok", "point": [102.1, 6.27],
         "grid": [102.125, 6.375], "reference": {"days": 450, "llw_p50": 0.61, "llw_p90": 0.82,
                                                 "llw_p98": 0.99, "setup_p50": 1.0,
                                                 "setup_p90": 1.18, "setup_p98": 1.29},
         "months": {}, "events": {}, "spells": [], "wind": {}, "windows_from": None},
        {"id": "bang_nara", "name": {"en": "Bang Nara"}, "zone": None, "point": [101.84, 6.44],
         "grid": [101.875, 6.542], "reference": {"days": 450, "llw_p50": 0.68, "llw_p90": 0.89,
                                                 "llw_p98": 1.03, "setup_p50": 1.0,
                                                 "setup_p90": 1.19, "setup_p98": 1.29},
         "months": {}, "events": {}, "spells": [], "wind": {}, "windows_from": "kolok"},
    ]
    sql = output.seed_sql(mouths, CFG, "2026-10-16")
    assert "left join public.warning_zones z on z.basin = v.basin" in sql
    assert "('kolok', 'kolok'," in sql
    assert "('bang_nara', null," in sql
    assert "on conflict (id) do update" in sql
    assert sql.count("::double precision") >= 12


def test_markdown_names_what_the_gate_is_not():
    mouths = [
        {"id": "kolok", "name": {"en": "Kolok"}, "zone": "kolok", "point": [102.1, 6.27],
         "grid": [102.125, 6.375],
         "reference": {"days": 450, "llw_p50": 0.61, "llw_p90": 0.82, "llw_p98": 0.99,
                       "setup_p50": 1.0, "setup_p90": 1.18, "setup_p98": 1.29, "range_mean": 0.88},
         "months": {}, "events": {}, "spells": [], "wind": {}, "windows_from": None},
    ]
    text = output.markdown(mouths, CFG, "2026-10-16")
    assert "Not a trigger" in text
    assert "Not a gauge" in text
    assert "safety rule 2" in text
