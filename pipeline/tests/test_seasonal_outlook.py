"""Seasonal outlook, the history half: seasons from five-day totals, ENSO phases, counts, trend. No network."""

from seasonal_outlook import history


def test_a_season_runs_november_to_january_and_is_named_by_its_first_year():
    assert [history.season_of(2024, m) for m in (10, 11, 12)] == [None, 2024, 2024]
    assert history.season_of(2025, 1) == 2024 and history.season_of(2025, 2) is None
    rows = [{"year": 2024, "month": 10, "pentad": 5, "mm": 999.0}]                       # October is not counted
    rows += [{"year": 2024, "month": 11, "pentad": p, "mm": 10.0} for p in range(6)]
    rows += [{"year": 2024, "month": 12, "pentad": p, "mm": 20.0} for p in range(6)]
    rows += [{"year": 2025, "month": 1, "pentad": p, "mm": [5.0, 5.0, 100.0, 80.0, 60.0, 5.0][p]} for p in range(6)]
    rows += [{"year": 2025, "month": 11, "pentad": 0, "mm": 7.0}, {"year": 2025, "month": 11, "pentad": 1, "mm": None}]
    out = history.seasons(rows)
    assert out[2024] == {"total_mm": 435.0, "peak_5d_mm": 100.0, "peak_15d_mm": 240.0, "pentads": 18, "complete": True}
    assert out[2025]["complete"] is False and out[2025]["pentads"] == 1


def test_the_enso_index_is_read_and_turned_into_a_phase():
    text = "SEAS  YR   TOTAL   ANOM\n JAS 2015  28.9  1.73\n JAS 2022  26.1  -0.78\n JAS 2024  27.0  -0.04\n"
    oni = history.parse_oni(text)
    assert oni == {("JAS", 2015): 1.73, ("JAS", 2022): -0.78, ("JAS", 2024): -0.04}
    assert [history.phase(v) for v in (1.73, -0.78, -0.04, 0.5, -0.5, None)] == [
        "el_nino", "la_nina", "neutral", "el_nino", "la_nina", None]


def test_thirds_ranks_and_counts_by_phase():
    lo, hi = history.terciles([1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert 3 < lo < 4 and 6 < hi < 7
    assert history.rank_of(9, [1, 5, 9]) == 1 and history.rank_of(1, [1, 5, 9]) == 3
    rows = [{"phase": "el_nino", "t": 2}, {"phase": "el_nino", "t": 8}, {"phase": "la_nina", "t": 9},
            {"phase": "neutral", "t": 5}]
    got = history.by_phase(rows, "t", hi, lo)
    assert got["el_nino"] == {"seasons": 2, "wet_third": 1, "dry_third": 1, "median": 5.0}
    assert got["la_nina"]["wet_third"] == 1 and got["neutral"] == {"seasons": 1, "wet_third": 0, "dry_third": 0, "median": 5.0}


def test_association_and_trend_see_what_is_there_and_not_what_is_not():
    x = list(range(30))
    falling = history.association(x, [100 - 2 * v + (3 if v % 2 else -3) for v in x], shuffles=500)
    assert falling["spearman"] < -0.9 and falling["p"] < 0.01 and falling["n"] == 30
    flat = history.association(x, [(v * 7919) % 13 for v in x], shuffles=500)
    assert abs(flat["spearman"]) < 0.4 and flat["p"] > 0.05
    up = history.trend(list(range(1981, 2011)), [100 + 5 * i for i in range(30)])
    assert up["per_decade"] == 50.0 and up["low"] <= 50.0 <= up["high"] and up["p"] < 0.001
    none = history.trend(list(range(1981, 2011)), [100 + ((i * 7919) % 13) for i in range(30)])
    assert none["low"] < 0 < none["high"]
