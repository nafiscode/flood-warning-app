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


CPT = """xmlns:cpt=http://iri.columbia.edu/CPT/v10/
cpt:nfields=1
cpt:field=precip, cpt:T=1991-11/1992-01, cpt:S=1991-10-01, cpt:nrow=3, cpt:ncol=3, cpt:row=Y, cpt:col=X, cpt:units=mm, cpt:missing=-999.0
\t100.0\t101.0\t102.0
5.0\t9\t9\t9
6.0\t1\t3\t-999.0
7.0\t5\t7\t9
cpt:field=precip, cpt:T=1992-11/1993-01, cpt:S=1992-10-01, cpt:nrow=3, cpt:ncol=3, cpt:row=Y, cpt:col=X, cpt:units=mm, cpt:missing=-999.0
\t100.0\t101.0\t102.0
5.0\t0\t0\t0
6.0\t2\t2\t2
7.0\t2\t2\t2
"""


def test_a_model_file_is_read_as_the_mean_of_the_chosen_cells_without_missing_values():
    from seasonal_outlook import models

    got = models.read_cpt(CPT, [100.0, 101.0, 102.0], [6.0, 7.0])
    assert got == {1991: 5.0, 1992: 2.0}          # (1 + 3 + 5 + 7 + 9) / 5, the missing cell skipped


def test_leans_are_scored_without_knowing_their_own_season():
    from seasonal_outlook import models

    series = {y: float(y - 2000) for y in range(2000, 2009)}          # 0..8
    thirds = models.leave_one_out(series, list(series))
    assert thirds[2000] == models.DRY and thirds[2008] == models.WET and thirds[2004] == models.NORMAL
    perfect = models.score(thirds, thirds)
    assert perfect["hit_rate_pct"] == 100 and perfect["heidke"] == 1.0
    always_normal = models.score({s: models.NORMAL for s in thirds}, thirds)
    assert always_normal["heidke"] == 0.0 and always_normal["hits"] == sum(v == models.NORMAL for v in thirds.values())
    assert [models.enso_lean(v) for v in (-1.0, 0.0, 2.16, None)] == [models.WET, models.NORMAL, models.DRY, None]
    o = models.odds(models.DRY, {1: 0, 2: 0, 3: 2}, {1: 0, 2: 1, 3: 2})
    assert o["past_seasons_with_this_lean"] == 2 and o["odds_pct"] == {"dry": 40, "normal": 40, "wet": 20}


def test_the_outlook_uses_only_methods_that_earned_it_and_says_so_when_they_disagree():
    from seasonal_outlook import outlook

    past = [float(v) for v in range(30)]
    assert outlook.in_range(15.0, past) and not outlook.in_range(30.0, past) and not outlook.in_range(-1.0, past)
    assert outlook.mean_odds([{"dry": 50, "normal": 33, "wet": 17}, {"dry": 67, "normal": 22, "wet": 11}]) == {
        "dry": 58, "normal": 28, "wet": 14}
    assert outlook.enso_odds({"el_nino": {"seasons": 9, "wet_third": 1, "dry_third": 5}}, "el_nino") == {
        "dry": 50, "normal": 33, "wet": 17}
    rows = [{"lean": "dry", "usable": True}, {"lean": "wet", "usable": False}]
    assert outlook.summary(rows)[0] == "dry"
    assert outlook.summary(rows + [{"lean": "normal", "usable": True}])[0] == "none"
    assert outlook.summary([{"lean": "wet", "usable": False}]) == (
        "none", "No method can be trusted this time. Prepare as for any season.")
    assert outlook.beats({"hit_rate_pct": 50}, [{"hit_rate_pct": 33}, {"hit_rate_pct": 40}])
    assert not outlook.beats({"hit_rate_pct": 40}, [{"hit_rate_pct": 33}, {"hit_rate_pct": 40}])


def test_running_totals_are_never_mistaken_for_daily_rain_and_gaps_never_for_dry_days():
    from seasonal_outlook import sources

    assert [sources.pentad_of(d) for d in (1, 5, 6, 25, 26, 31)] == [0, 0, 1, 4, 5, 5]
    daily = [{"area": "all", "year": 2024, "month": 11, "day": d, "mm": 1.0} for d in range(1, 31)]
    daily = [r for r in daily if r["day"] != 8]                         # one day missing
    got = sources.to_pentads(daily)
    assert [(r["pentad"], r["mm"]) for r in got] == [(0, 5.0), (2, 5.0), (3, 5.0), (4, 5.0), (5, 5.0)]
    a = {y: float(y) for y in range(2000, 2012)}
    assert sources.agreement(a, a) == {"seasons": 12, "spearman": 1.0, "same_third_pct": 100.0}
