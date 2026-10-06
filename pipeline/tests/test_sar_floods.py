"""Offline tests for sar_floods: no Earth Engine, no Drive, no network.

The Earth Engine code itself cannot be tested here. `test_run_*` only drive it against a stand-in
`ee` to prove the control flow (a dry run starts nothing; a real run starts the planned tasks).
"""

import copy
import json
import shutil
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from r2sync.core import check_key
from sar_floods import aoi, ee_ops, frequency, grid, naming, plan, run, runlog, seasons, settings, threshold
from sar_floods.__main__ import main, upload_commands
from sar_floods.drive import pick_latest

JS = Path(settings.PACKAGE_DIR) / "code_editor" / "sar_floods.js"


@pytest.fixture
def cfg():
    return settings.load_config()


# ---------------------------------------------------------------- thresholds

EDGES = threshold.bin_edges(-20.0, 10.0, 150)
RULES = dict(fallback_db=-3.0, min_pixels=2000, min_class_fraction=0.05, smooth_bins=5,
             max_valley_ratio=0.7, min_mode_separation_db=3.0, otsu_range_db=(-12.0, -2.0))


def histogram(*modes, seed=1):
    """Counts for a mixture of normal modes given as (mean dB, sd dB, pixels)."""
    rng = np.random.default_rng(seed)
    samples = np.concatenate([rng.normal(mean, sd, n) for mean, sd, n in modes])
    return np.histogram(np.clip(samples, -20, 9.99), bins=EDGES)[0]


HISTOGRAMS = {
    "flooded_tile": histogram((0.0, 1.0, 40000), (-8.0, 1.5, 10000)),
    "dry_tile": histogram((0.0, 1.2, 50000)),
    "one_percent_flooded": histogram((0.0, 1.0, 49500), (-8.0, 1.0, 500)),
    "three_percent_far_below": histogram((0.0, 1.0, 48500), (-12.0, 1.0, 1500)),
    "nearly_empty": histogram((0.0, 1.0, 300), (-8.0, 1.0, 300)),
    "two_modes_near_zero": histogram((1.5, 0.5, 25000), (-2.0, 0.5, 25000)),
    "shoulder": histogram((0.0, 1.0, 40000), (-2.5, 1.0, 10000)),
    "wetter_and_drier": histogram((6.0, 0.8, 25000), (0.0, 0.8, 25000)),
}
EXPECTED = {
    "flooded_tile": ("otsu", "bimodal"),
    "dry_tile": ("fallback", "no_valley"),
    "one_percent_flooded": ("fallback", "no_valley"),          # Otsu ignores the 1 % and halves the main hump
    "three_percent_far_below": ("fallback", "class_too_small"),
    "nearly_empty": ("fallback", "too_few_pixels"),
    "two_modes_near_zero": ("fallback", "out_of_range"),
    "shoulder": ("fallback", "no_valley"),
    "wetter_and_drier": ("fallback", "out_of_range"),
}


def test_otsu_splits_two_separated_blocks_in_the_middle_of_the_gap():
    counts = np.zeros(150)
    counts[40:50] = 100   # -12 to -10 dB
    counts[95:105] = 300  # -1 to +1 dB
    t, low_fraction, eta = threshold.otsu(counts, EDGES)
    assert t == pytest.approx((-10.0 + -1.0) / 2)   # middle of the empty gap, not its first edge
    assert low_fraction == pytest.approx(0.25)
    assert eta > 0.95


def test_otsu_matches_a_brute_force_search():
    counts = HISTOGRAMS["flooded_tile"].astype(float)
    centers = (EDGES[:-1] + EDGES[1:]) / 2
    best, best_k = -1.0, None
    for k in range(len(counts) - 1):
        w0, w1 = counts[:k + 1].sum(), counts[k + 1:].sum()
        if w0 == 0 or w1 == 0:
            continue
        m0 = (counts[:k + 1] * centers[:k + 1]).sum() / w0
        m1 = (counts[k + 1:] * centers[k + 1:]).sum() / w1
        if w0 * w1 * (m0 - m1) ** 2 > best:
            best, best_k = w0 * w1 * (m0 - m1) ** 2, k
    assert threshold.otsu(counts, EDGES)[0] == pytest.approx(EDGES[best_k + 1])


def test_otsu_rejects_an_empty_or_single_bin_histogram():
    with pytest.raises(ValueError):
        threshold.otsu(np.zeros(150), EDGES)
    one = np.zeros(150)
    one[100] = 5000
    with pytest.raises(ValueError):
        threshold.otsu(one, EDGES)
    assert threshold.decide(one, EDGES, **RULES).reason == "too_few_pixels"


@pytest.mark.parametrize("name", sorted(HISTOGRAMS))
def test_decide_uses_otsu_only_for_bimodal_histograms(name):
    d = threshold.decide(HISTOGRAMS[name], EDGES, **RULES)
    assert (d.method, d.reason) == EXPECTED[name]
    if d.method == "fallback":
        assert d.threshold_db == -3.0
    else:
        assert -6.0 < d.threshold_db < -2.5        # between the flooded and the unchanged mode
        assert d.mode_low_db == pytest.approx(-8.0, abs=0.6) and d.mode_high_db == pytest.approx(0.0, abs=0.6)


def test_a_single_hump_fails_the_valley_test_although_otsu_splits_it():
    d = threshold.decide(HISTOGRAMS["dry_tile"], EDGES, **RULES)
    assert d.otsu_db == pytest.approx(0.0, abs=0.4)   # Otsu still cuts the hump in half
    assert d.valley_ratio > 0.95 and d.method == "fallback"


def test_close_modes_are_rejected_when_the_range_test_would_pass():
    counts = histogram((-1.5, 0.4, 25000), (-4.0, 0.4, 25000))
    d = threshold.decide(counts, EDGES, **RULES)
    assert (d.method, d.reason) == ("fallback", "modes_too_close")
    assert threshold.decide(counts, EDGES, **{**RULES, "min_mode_separation_db": 2.0}).method == "otsu"


def test_decide_from_config_reads_every_rule_and_checks_the_bin_count(cfg):
    d = threshold.decide_from_config(HISTOGRAMS["flooded_tile"], cfg, "VV")
    assert d.method == "otsu"
    cfg["threshold"]["fallback_drop_db"]["VH"] = -2.5
    assert threshold.decide_from_config(HISTOGRAMS["dry_tile"], cfg, "VH").threshold_db == -2.5
    with pytest.raises(ValueError, match="150"):
        threshold.decide_from_config(np.ones(10), cfg, "VV")


def test_decision_round_trips_through_the_cache_format():
    d = threshold.decide(HISTOGRAMS["flooded_tile"], EDGES, **RULES)
    again = threshold.Decision(**json.loads(json.dumps(d.as_dict())))
    assert (again.method, again.threshold_db, again.reason) == (d.method, d.threshold_db, d.reason)
    assert "otsu_db" not in threshold.decide(HISTOGRAMS["nearly_empty"], EDGES, **RULES).as_dict()


def test_summary_counts_methods_and_reasons():
    decisions = {i: threshold.decide(HISTOGRAMS[n], EDGES, **RULES) for i, n in enumerate(sorted(HISTOGRAMS))}
    s = threshold.summarise(decisions)
    assert s["tiles_with_data"] == 8 and s["tiles_otsu"] == 1
    assert s["reasons"] == {"bimodal": 1, "class_too_small": 1, "no_valley": 3, "out_of_range": 2, "too_few_pixels": 1}
    assert s["otsu_median_db"] == pytest.approx(-4.0) and s["otsu_min_db"] == s["otsu_max_db"]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_code_editor_port_makes_the_same_decisions(tmp_path):
    """The JavaScript between PURE-BEGIN and PURE-END must agree with threshold.py and plan.py."""
    js = JS.read_text(encoding="utf-8")
    pure = js[js.index("// PURE-BEGIN"):js.index("// PURE-END")]
    cases = {n: [float(c) for c in h] for n, h in HISTOGRAMS.items()}
    script = pure + f"""
var cases = {json.dumps(cases)};
var edges = binEdges(-20, 10, 150), out = {{}};
Object.keys(cases).forEach(function (k) {{
  out[k] = decide(cases[k], edges, {{fallbackDb: -3, minPixels: 2000, minClassFraction: 0.05, smoothBins: 5,
                                     maxValleyRatio: 0.7, minModeSeparationDb: 3, otsuRangeDb: [-12, -2]}});
}});
out.passes = groupPasses({json.dumps([f["properties"] for f in FEATURES])}).map(function (p) {{ return p.passId; }});
out.millis = utcMillis('2024-10-01', '2025-01-31');
out.windows = referenceWindows('2025-01-15', [10, 1], {{start: [2, 1], end: [4, 30], yearOffsets: [0, 1]}});
console.log(JSON.stringify(out));
"""
    path = tmp_path / "check.js"
    path.write_text(script, encoding="utf-8")
    out = json.loads(subprocess.run(["node", str(path)], capture_output=True, text=True, check=True).stdout)
    for name, counts in HISTOGRAMS.items():
        d = threshold.decide(counts, EDGES, **RULES)
        assert (out[name]["method"], out[name]["reason"]) == (d.method, d.reason), name
        assert out[name]["thresholdDb"] == pytest.approx(d.threshold_db)
        if d.valley_ratio is not None:
            assert out[name]["valleyRatio"] == pytest.approx(d.valley_ratio)
            assert out[name]["otsuDb"] == pytest.approx(d.otsu_db)
    assert out["passes"] == [p.pass_id for p in plan.group_passes([plan.scene_from_feature(f) for f in FEATURES])]
    assert out["millis"] == list(seasons.utc_millis(date(2024, 10, 1), date(2025, 1, 31)))
    assert out["windows"] == [["2024-02-01", "2024-04-30"], ["2025-02-01", "2025-04-30"]]


# ---------------------------------------------------------------- seasons and events

def test_a_season_is_named_by_its_start_year_and_crosses_the_new_year(cfg):
    ev = seasons.find_event("season-2024", cfg)
    assert (ev.start, ev.end, ev.kind, ev.per_scene) == (date(2024, 10, 1), date(2025, 1, 31), "season", False)
    assert seasons.find_event("2024", cfg) == ev


def test_all_seasons_and_both_priority_events_are_configured(cfg):
    ids = [e.id for e in seasons.events(cfg)]
    assert ids[:9] == [f"season-{y}" for y in range(2017, 2026)]
    assert ids[9:] == ["event-2024-nov-dec", "event-2025-nov-dec"]
    ev = seasons.find_event("2025-nov-dec", cfg)
    assert (ev.start, ev.end, ev.season_year, ev.per_scene) == (date(2025, 11, 1), date(2025, 12, 31), 2025, True)
    with pytest.raises(KeyError):
        seasons.find_event("season-2016", cfg)


def test_season_year_of_a_date(cfg):
    assert seasons.season_year(date(2025, 1, 15), cfg) == 2024
    assert seasons.season_year(date(2025, 10, 1), cfg) == 2025
    assert seasons.season_year(date(2025, 9, 30), cfg) == 2024


def test_reference_is_the_dry_window_before_the_season_and_can_be_widened(cfg):
    ev = seasons.find_event("season-2024", cfg)
    assert seasons.reference_windows(ev, cfg) == [(date(2024, 2, 1), date(2024, 4, 30))]
    cfg["reference"]["year_offsets"] = [1, 0, 0]
    assert seasons.reference_windows(ev, cfg) == [(date(2024, 2, 1), date(2024, 4, 30)),
                                                  (date(2025, 2, 1), date(2025, 4, 30))]


def test_windows_are_bangkok_days_expressed_in_utc():
    start, end = seasons.utc_millis(date(2024, 11, 1), date(2024, 12, 31))
    assert seasons.iso_utc(start) == "2024-10-31T17:00:00Z"      # 1 Nov 00:00 Bangkok
    assert seasons.iso_utc(end) == "2024-12-31T17:00:00Z"        # 1 Jan 00:00 Bangkok, exclusive
    # The 06:20 Bangkok descending pass of 1 Nov is 23:20 UTC on 31 Oct: inside the window.
    assert start <= datetime(2024, 10, 31, 23, 20, tzinfo=timezone.utc).timestamp() * 1000 < end


# ---------------------------------------------------------------- config

def test_shipped_config_is_valid_and_matches_the_brief(cfg):
    assert cfg["masks"]["permanent_water"]["min_occurrence_pct"] == 80
    assert cfg["masks"]["slope"]["max_deg"] == 5 and cfg["masks"]["hand"]["max_m"] == 15
    assert cfg["sentinel1"]["collection"] == "COPERNICUS/S1_GRD"
    assert set(cfg["provinces"]) == {"90", "94", "95", "96"}
    assert settings.histogram_bins(cfg) == 150
    assert not Path(cfg["output_dir"]).is_absolute()


def _set(cfg, dotted, value):
    node = cfg
    *parents, leaf = dotted.split(".")
    for key in parents:
        node = node[key]
    node[leaf] = value


@pytest.mark.parametrize("dotted,value,message", [
    ("flood_rule", "either", "flood_rule"),
    ("sentinel1.polarisations", ["VV", "HH"], "polarisations"),
    ("sentinel1.polarisations", ["VH"], "needs polarisations"),       # rule "vv" without VV
    ("seasons.end", "11-30", "cross the new year"),
    ("seasons.first", 2026, "first <= last"),
    ("reference.start", "02-30", "month-day"),
    ("reference.end", "11-15", "overlaps the flood season"),
    ("reference.year_offsets", [], "year_offsets"),
    ("threshold.fallback_drop_db", {"VV": 3.0, "VH": -3.0}, "negative drop"),
    ("threshold.otsu_range_db", [-2.0, -12.0], "low < high"),
    ("threshold.bimodality.smooth_bins", 4, "odd"),
    ("threshold.bimodality.max_valley_ratio", 1.5, "max_valley_ratio"),
    ("threshold.histogram.bin_db", 5.0, "at least 20 bins"),
    ("min_connected_pixels", -1, "min_connected_pixels"),
    ("export.scale_m", 12.5, "whole number"),
    ("export.drive_folder", "a/b", "one folder name"),
    ("output_dir", "/tmp/sar", "relative"),
    ("priority_events", [{"id": "x", "start": "2024-12-31", "end": "2024-11-01"}], "start is after end"),
    ("priority_events", [{"id": "a b", "start": "2024-11-01", "end": "2024-12-31"}], "letters, digits"),
])
def test_validation_names_the_bad_setting(cfg, dotted, value, message):
    _set(cfg, dotted, value)
    with pytest.raises(settings.ConfigError, match=message):
        settings.validate(cfg)


def test_missing_section_is_reported(cfg):
    del cfg["masks"]
    with pytest.raises(settings.ConfigError, match="masks"):
        settings.validate(cfg)


def test_parameter_hash_follows_processing_parameters_only(cfg):
    base = settings.params_hash(cfg, "aoi")
    assert len(base) == 7 and base == settings.params_hash(copy.deepcopy(cfg), "aoi")
    other = copy.deepcopy(cfg)
    other["export"]["drive_folder"] = "elsewhere"
    other["export"]["scale_m"] = 20                 # the scale is in the file name, not the hash
    other["seasons"]["last"] = 2026
    assert settings.params_hash(other, "aoi") == base
    other["threshold"]["fallback_drop_db"]["VV"] = -2.5
    assert settings.params_hash(other, "aoi") != base
    assert settings.params_hash(cfg, "another area") != base


def test_project_id_comes_from_the_environment_and_is_required(monkeypatch):
    monkeypatch.setenv("EE_PROJECT", "jaga-test-project")
    assert settings.ee_project() == "jaga-test-project"
    monkeypatch.delenv("EE_PROJECT")
    monkeypatch.setattr(settings, "env_value", lambda key: None)
    with pytest.raises(settings.ConfigError, match="EE_PROJECT"):
        settings.ee_project()


def test_importing_the_package_does_not_initialise_earth_engine(monkeypatch):
    monkeypatch.setattr(ee_ops, "_ee", None)
    with pytest.raises(RuntimeError, match="not initialised"):
        ee_ops.ee()


# ---------------------------------------------------------------- area, grid, tiles

def test_area_file_covers_the_four_provinces_and_matches_the_code_editor_script(cfg):
    from shapely.geometry import Point, shape

    geometry = aoi.load()
    outline = shape(geometry)
    assert outline.is_valid
    west, south, east, north = outline.bounds
    assert 99.9 < west < 100.2 and 5.5 < south < 5.8 and 102.0 < east < 102.3 and 7.8 < north < 8.0
    for lon, lat in [(100.47, 7.01), (101.25, 6.87), (101.28, 6.54), (101.82, 6.43), (101.13, 5.77), (101.97, 6.03)]:
        assert outline.contains(Point(lon, lat))          # Hat Yai, Pattani, Yala, Narathiwat, Betong, Sungai Kolok
    assert not outline.contains(Point(100.37, 6.12))      # Alor Setar, Malaysia
    assert f"var AOI_GEOJSON = {aoi.geometry_json(geometry)};" in JS.read_text(encoding="utf-8")
    assert len(settings.aoi_sha256()) == 64


def test_master_grid_is_snapped_and_contains_the_area(cfg):
    bounds = aoi.bounds(aoi.load())
    g = grid.master_grid(bounds, "EPSG:32647", 10, 30)
    assert g.x0 % 30 == 0 and g.y0 % 30 == 0 and (g.width * 10) % 30 == 0 and (g.height * 10) % 30 == 0
    west, south, east, north = grid.project_bounds(bounds, "EPSG:32647")
    gw, gs, ge, gn = g.bounds
    assert gw <= west and gs <= south and ge >= east and gn >= north
    assert gw > west - 30 and gn < north + 30
    assert g.transform == [10, 0, g.x0, 0, -10, g.y0] and g.dimensions == f"{g.width}x{g.height}"
    assert g.pixels < cfg["export"]["max_pixels"]
    fw, fh = g.file_dimensions()
    assert fw % 256 == 0 and fh % 256 == 0 and 0 <= fw - g.width < 256 and 0 <= fh - g.height < 256
    # A coarser grid snaps to a multiple of both the pixel and the 30 m snap, and covers the same area.
    g20 = grid.master_grid(bounds, "EPSG:32647", 20, 30)
    assert g20.x0 % 60 == 0 and g20.bounds[2] >= east and g20.pixels < g.pixels / 3.9


def test_scene_window_stays_on_the_master_lattice():
    g = grid.master_grid((100.0, 5.6, 102.1, 7.95), "EPSG:32647", 10, 30)
    w = g.window((101.0, 6.0, 101.5, 6.5))
    assert (w.x0 - g.x0) % 10 == 0 and (g.y0 - w.y0) % 10 == 0 and w.scale == 10
    assert g.bounds[0] <= w.bounds[0] and w.bounds[2] <= g.bounds[2] and w.pixels < g.pixels / 10
    assert g.window((90.0, 0.0, 110.0, 20.0)) == g          # clipped to the master grid
    assert g.window((90.0, 0.0, 91.0, 1.0)) is None         # no overlap


def test_tile_lattice_numbers_tiles_from_the_south_west(cfg):
    from shapely.geometry import shape

    lattice = grid.tile_lattice((100.0453, 5.6053, 102.1021, 7.9477), 0.1)
    assert (lattice.lon0, lattice.lat0, lattice.ncols, lattice.nrows) == (100.0, 5.6, 22, 24)
    assert lattice.bounds(0) == (100.0, 5.6, 100.1, 5.7)
    assert lattice.bounds(lattice.index(3, 2)) == (100.3, 5.8, 100.4, 5.9)
    assert lattice.index_at(100.35, 5.85) == lattice.index(3, 2) == 2 * 22 + 3
    tiles = grid.tiles_in_area(lattice, shape(aoi.load()))
    assert 150 < len(tiles) < 22 * 24 and lattice.index_at(100.47, 7.01) in tiles     # Hat Yai
    assert lattice.index_at(100.05, 5.65) not in tiles                                 # Malaysia


# ---------------------------------------------------------------- scenes, passes, exports

def feature(scene_id, time, platform, rel, absolute, direction, box=(100.9, 5.9, 103.3, 7.9)):
    w, s, e, n = box
    return {"type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[[w, s], [e, s + 0.4], [e - 0.3, n], [w - 0.3, n - 0.4], [w, s]]]},
            "properties": {"id": scene_id, "time_start": int(time.timestamp() * 1000), "platform": platform,
                           "relative_orbit": rel, "absolute_orbit": absolute, "direction": direction}}


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


FEATURES = [
    feature("S1A_IW_GRDH_1SDV_20241128T231830_B", utc(2024, 11, 28, 23, 18, 30), "A", 91, 56757, "DESCENDING"),
    feature("S1A_IW_GRDH_1SDV_20241128T231805_A", utc(2024, 11, 28, 23, 18, 5), "A", 91, 56757, "DESCENDING"),
    feature("S1A_IW_GRDH_1SDV_20241129T113012_C", utc(2024, 11, 29, 11, 30, 12), "A", 172, 56765, "ASCENDING",
            box=(100.2, 5.5, 102.5, 7.2)),
    feature("S1A_IW_GRDH_1SDV_20241203T112200_D", utc(2024, 12, 3, 11, 22, 0), "A", 99, 56823, "ASCENDING"),
]


def reference_features(orbit_passes):
    out = []
    for (rel, direction), n in orbit_passes.items():
        for i in range(n):
            out.append(feature(f"REF_{direction[0]}{rel:03d}_{i}", utc(2024, 2, 1 + i * 12 if i < 3 else 28, 23, 18),
                               "A", rel, 50000 + rel * 10 + i, direction))
    return out


def test_slices_of_one_overflight_form_one_pass():
    passes = plan.group_passes([plan.scene_from_feature(f) for f in FEATURES])
    assert [p.pass_id for p in passes] == ["20241128T2318Z_S1A_D091", "20241129T1130Z_S1A_A172",
                                           "20241203T1122Z_S1A_A099"]
    first = passes[0]
    assert [s.id[-1] for s in first.scenes] == ["A", "B"] and first.orbit == "D091"   # slices in time order
    west, south, east, north = first.bounds
    assert (round(west, 1), round(south, 1), round(east, 1), round(north, 1)) == (100.6, 5.9, 103.3, 7.9)
    assert first.as_dict()["time_start_utc"] == "2024-11-28T23:18:05Z"


def test_orbits_with_a_thin_reference_are_skipped_and_say_why():
    passes = plan.group_passes([plan.scene_from_feature(f) for f in FEATURES])
    scenes = [plan.scene_from_feature(f) for f in reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 2})]
    reference = plan.reference_by_orbit(scenes)
    assert reference["D091"]["passes"] == 5 and len(reference["D091"]["scenes"]) == 5
    plan.apply_reference_rule(passes, reference, min_passes=4)
    assert [p.status for p in passes] == ["used", "skipped", "skipped"]
    assert passes[1].skip_reason == "reference has 2 passes on orbit A172, needs 4"
    assert "0 passes on orbit A099" in passes[2].as_dict()["skip_reason"]


def test_per_scene_exports_only_for_priority_events(cfg):
    master = grid.master_grid(aoi.bounds(aoi.load()), "EPSG:32647", 10, 30)
    passes = plan.group_passes([plan.scene_from_feature(f) for f in FEATURES])
    passes[2].status = "skipped"
    priority = plan.planned_exports(seasons.find_event("event-2024-nov-dec", cfg), passes, master, "abc1234")
    assert [e.name for e in priority] == [
        "jaga_sar_scene_20241128T2318Z_S1A_D091_10m_abc1234",
        "jaga_sar_scene_20241129T1130Z_S1A_A172_10m_abc1234",
        "jaga_sar_max_event-2024-nov-dec_10m_abc1234"]
    assert priority[0].bands == ("extent",) and priority[0].grid.pixels < master.pixels
    assert priority[-1].grid == master and priority[-1].bands == ("extent", "n_valid", "n_flooded")
    season = plan.planned_exports(seasons.find_event("season-2024", cfg), passes, master, "abc1234")
    assert [e.name for e in season] == ["jaga_sar_max_season-2024_10m_abc1234"]


def test_no_exports_without_usable_passes_and_no_overflowing_counts(cfg):
    master = grid.master_grid((100.0, 5.6, 102.1, 7.95), "EPSG:32647", 10, 30)
    ev = seasons.find_event("season-2024", cfg)
    assert plan.planned_exports(ev, [], master, "abc1234") == []
    many = [plan.Pass([plan.scene_from_feature(feature(f"S{i}", utc(2024, 11, 1, 0, 0), "A", 91, i, "DESCENDING"))])
            for i in range(250)]
    with pytest.raises(ValueError, match="8-bit"):
        plan.planned_exports(ev, many, master, "abc1234")


def test_names_are_deterministic_valid_task_descriptions_and_r2_keys():
    names = [naming.scene_name("20241128T2318Z_S1A_D091", 10, "abc1234"),
             naming.event_name("season-2024", 10, "abc1234"),
             naming.frequency_name(2017, 2025, 10, "abc1234")]
    assert names == ["jaga_sar_scene_20241128T2318Z_S1A_D091_10m_abc1234", "jaga_sar_max_season-2024_10m_abc1234",
                     "jaga_sar_frequency_2017-2025_10m_abc1234"]
    for n in names:   # Earth Engine task descriptions: letters, digits and . , : ; _ - up to 100 characters
        assert len(n) <= 100 and all(ch.isalnum() or ch in "._-" for ch in n)
    day = date(2026, 10, 6)
    keys = [naming.r2_key(n + ".tif", day) for n in names]
    assert keys == ["sar/scene/20241128T2318Z_S1A_D091_10m_abc1234/2026-10-06.tif",
                    "sar/max/season-2024_10m_abc1234/2026-10-06.tif",
                    "sar/frequency/2017-2025_10m_abc1234/2026-10-06.tif"]
    for key in keys + [naming.run_log_key("20261006T101500Z_season-2024")]:
        assert check_key("private", key) == key          # allowed by r2sync in the private bucket
        with pytest.raises(Exception):
            check_key("public", key)                     # and never in the public one
    split = "jaga_sar_max_season-2024_10m_abc1234-0000000000-0000023296.tif"
    assert naming.split_part(split) == ("jaga_sar_max_season-2024_10m_abc1234", "-0000000000-0000023296")
    assert naming.r2_key(split, day) == "sar/max/season-2024_10m_abc1234/2026-10-06-0000000000-0000023296.tif"
    assert naming.split_part("holiday.tif") is None
    with pytest.raises(ValueError):
        naming.r2_key("holiday.tif", day)


def test_histogram_parsing_handles_band_names_single_band_and_empty_tiles():
    rows = [[-20 + i * 0.2, float(i == 60) * 10] for i in range(150)]
    features = [{"properties": {"tile": 5, "VV": rows, "VH": None}},
                {"properties": {"tile": 6}},
                {"properties": {"tile": 7, "VV": [[r[0], 0.0] for r in rows], "VH": rows}}]
    out = ee_ops.parse_histograms(features, ["VV", "VH"], 150)
    assert sorted(out) == [5, 7] and list(out[5]) == ["VV"] and list(out[7]) == ["VH"]
    assert sum(out[5]["VV"]) == 10 and len(out[5]["VV"]) == 150
    single = ee_ops.parse_histograms([{"properties": {"tile": 1, "histogram": rows}}], ["VV"], 150)
    assert list(single[1]) == ["VV"]
    with pytest.raises(ValueError, match="expected 150 bins"):
        ee_ops.parse_histograms([{"properties": {"tile": 1, "VV": rows[:10]}}], ["VV"], 150)


def test_look_direction_is_the_bearing_in_which_the_incidence_angle_falls():
    # Plane-fit coefficients [[a], [per metre east], [per metre north]] as measured on 2026-10-05.
    assert ee_ops.bearing_towards_radar([[30.0], [5.72e-5], [1.21e-5]]) == pytest.approx(258.05, abs=0.05)   # A070
    assert ee_ops.bearing_towards_radar([[30.0], [-6.31e-5], [1.36e-5]]) == pytest.approx(102.16, abs=0.05)  # D062
    assert ee_ops.bearing_towards_radar([[30.0], [0.0], [1e-5]]) == pytest.approx(180.0)   # rises northwards
    for nothing in (None, [], [[30.0], [0.0], [0.0]]):
        with pytest.raises(ValueError):
            ee_ops.bearing_towards_radar(nothing)


def test_drive_duplicates_resolve_to_the_newest_file():
    files = [{"name": "jaga_sar_max_season-2024_10m_a.tif", "id": "1", "modifiedTime": "2026-10-06T10:00:00.000Z"},
             {"name": "jaga_sar_max_season-2023_10m_a.tif", "id": "2", "modifiedTime": "2026-10-06T09:00:00.000Z"},
             {"name": "jaga_sar_max_season-2024_10m_a.tif", "id": "3", "modifiedTime": "2026-10-07T08:00:00.000Z"}]
    latest, duplicated = pick_latest(files)
    assert [f["id"] for f in latest] == ["2", "3"] and duplicated == ["jaga_sar_max_season-2024_10m_a.tif"]


# ---------------------------------------------------------------- run log and control flow

@pytest.fixture
def fake_run(cfg, tmp_path, monkeypatch):
    """run_event wired to a stand-in Earth Engine: canned scene lists and histograms, recorded exports."""
    fake = MagicMock(name="ee")
    started = []

    def to_drive(**options):
        task = SimpleNamespace(id=f"TASK{len(started):03d}", options=options, started=False)
        task.start = lambda: (setattr(task, "started", True), started.append(task))
        return task

    fake.batch.Export.image.toDrive.side_effect = to_drive
    fake.batch.Export.image.toAsset.side_effect = to_drive
    stored = set()
    monkeypatch.setattr(ee_ops, "reference_assets", lambda project, cfg_: set(stored))
    monkeypatch.setenv("EE_PROJECT", "jaga-test-project")
    monkeypatch.setattr(ee_ops, "init", lambda project: (setattr(ee_ops, "_ee", fake), "fake-ee")[1])
    monkeypatch.setattr(settings, "output_paths", lambda c: settings.Paths(tmp_path))
    listings = [FEATURES, reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 4})]
    monkeypatch.setattr(ee_ops, "list_scenes", lambda col: listings.pop(0) if listings else [])
    calls = []

    def histograms(cfg_, change, valid, area, lattice, tiles):
        calls.append(1)
        return {tiles[0]: {"VV": [float(c) for c in HISTOGRAMS["flooded_tile"]],
                           "VH": [float(c) for c in HISTOGRAMS["dry_tile"]]}}

    monkeypatch.setattr(ee_ops, "tile_histograms", histograms)
    looks = []
    monkeypatch.setattr(ee_ops, "look_direction", lambda cfg_, scene_ids, area: (
        looks.append(scene_ids[0]), 258.4 if scene_ids[0].startswith("REF_A") else 101.6)[1])
    yield SimpleNamespace(cfg=cfg, tmp=tmp_path, started=started, histogram_calls=calls, ee=fake, listings=listings,
                          stored=stored, looks=looks)
    ee_ops._ee = None


def test_dry_run_lists_scenes_and_exports_but_starts_nothing(fake_run):
    ev = seasons.find_event("event-2024-nov-dec", fake_run.cfg)
    rl = run.run_event(fake_run.cfg, ev, dry_run=True, command="sar_floods run event-2024-nov-dec --dry-run",
                       now=utc(2026, 10, 6, 10, 15))
    assert fake_run.started == [] and fake_run.histogram_calls == []
    fake_run.ee.batch.Export.image.toDrive.assert_not_called()
    log = json.loads(rl.path.read_text(encoding="utf-8"))
    assert rl.path.name == "20261006T101500Z_event-2024-nov-dec.json"
    assert log["dry_run"] is True and log["finished_utc"] and log["ee_project"] == "jaga-test-project"
    assert [e["state"] for e in log["exports"]] == ["PLANNED"] * 3
    assert all(e["task_id"] is None and e["drive_folder"] == "jaga_sar_floods" for e in log["exports"])


def test_dry_run_with_thresholds_logs_every_tile_decision_and_still_starts_nothing(fake_run):
    ev = seasons.find_event("event-2024-nov-dec", fake_run.cfg)
    rl = run.run_event(fake_run.cfg, ev, dry_run=True, with_thresholds=True, now=utc(2026, 10, 6, 10, 15))
    assert fake_run.started == [] and len(fake_run.histogram_calls) == 2      # one request per used pass
    used = [p for p in rl.data["passes"] if p["status"] == "used"]
    vv = used[0]["thresholds"]["VV"]
    (tile, decision), = vv["tiles"].items()
    assert decision["method"] == "otsu" and decision["reason"] == "bimodal" and -6 < decision["threshold_db"] < -2.5
    assert vv["summary"]["tiles_otsu"] == 1
    assert used[0]["thresholds"]["VH"]["tiles"][tile] | {"pixels": 0} == {
        "method": "fallback", "threshold_db": -3.0, "reason": "no_valley", "pixels": 0,
        **{k: used[0]["thresholds"]["VH"]["tiles"][tile][k] for k in
           ("otsu_db", "low_fraction", "mode_low_db", "mode_high_db", "valley_ratio", "eta")}}


def test_run_log_records_parameters_scenes_reference_and_task_ids(fake_run):
    cfg = fake_run.cfg
    ev = seasons.find_event("event-2024-nov-dec", cfg)
    rl = run.run_event(cfg, ev, dry_run=False, command="sar_floods run event-2024-nov-dec", now=utc(2026, 10, 6, 10, 15))
    log = json.loads(rl.path.read_text(encoding="utf-8"))
    assert set(log) >= {"schema", "run_id", "command", "dry_run", "started_utc", "finished_utc", "event",
                        "params_hash", "config", "aoi_sha256", "ee_project", "software", "grid", "tiles",
                        "reference", "passes", "exports", "warnings"}
    assert log["schema"] == runlog.SCHEMA and log["config"] == cfg
    assert log["params_hash"] == settings.params_hash(cfg, settings.aoi_sha256())
    assert log["event"] == {"id": "event-2024-nov-dec", "kind": "priority", "start": "2024-11-01",
                            "end": "2024-12-31", "dates": "Asia/Bangkok, inclusive", "per_scene_exports": True}
    assert log["reference"]["windows"] == [["2024-02-01", "2024-04-30"]]
    assert log["reference"]["orbits"]["D091"]["passes"] == 5 and len(log["reference"]["orbits"]["A172"]["scenes"]) == 4
    assert log["grid"]["crs"] == "EPSG:32647" and log["tiles"]["size_deg"] == 0.1
    by_id = {p["pass_id"]: p for p in log["passes"]}
    assert by_id["20241128T2318Z_S1A_D091"]["scenes"] == ["S1A_IW_GRDH_1SDV_20241128T231805_A",
                                                         "S1A_IW_GRDH_1SDV_20241128T231830_B"]
    assert by_id["20241203T1122Z_S1A_A099"]["status"] == "skipped"
    assert any("A099" in w for w in log["warnings"])
    assert set(by_id["20241128T2318Z_S1A_D091"]["thresholds"]) == {"VV", "VH"}

    # Two per-scene rasters and the event raster were started, on the planned grid, into Drive.
    assert [e["state"] for e in log["exports"]] == ["SUBMITTED"] * 3
    assert [e["task_id"] for e in log["exports"]] == ["TASK000", "TASK001", "TASK002"]
    assert all(t.started for t in fake_run.started) and len(fake_run.started) == 3
    last = fake_run.started[-1].options
    assert last["description"] == last["fileNamePrefix"] == log["exports"][-1]["name"]
    assert last["folder"] == "jaga_sar_floods" and last["crs"] == "EPSG:32647"
    assert last["crsTransform"] == log["grid"]["crs_transform"] and last["dimensions"] == log["grid"]["dimensions"]
    assert last["formatOptions"] == {"cloudOptimized": True, "noData": 255} and last["fileFormat"] == "GeoTIFF"
    assert "region" not in last and "scale" not in last and "bucket" not in last
    fake_run.ee.batch.Export.image.toCloudStorage.assert_not_called()

    # Thresholds were cached per pass, and a second run does not start the same exports again.
    cache = settings.Paths(fake_run.tmp).thresholds(log["params_hash"])
    assert sorted(p.name for p in cache.glob("*.json")) == ["20241128T2318Z_S1A_D091.json", "20241129T1130Z_S1A_A172.json"]
    fake_run.listings[:] = [FEATURES, reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 4})]
    again = run.run_event(cfg, ev, dry_run=False, now=utc(2026, 10, 6, 11, 0))
    assert [e["state"] for e in again.data["exports"]] == ["SKIPPED_ALREADY_EXPORTED"] * 3
    assert len(fake_run.started) == 3 and len(fake_run.histogram_calls) == 2     # cache hit, no new requests
    assert again.data["exports"][0]["previous"]["task_id"] == "TASK000"


def test_prepare_starts_one_reference_asset_per_orbit_with_enough_passes(fake_run):
    cfg = fake_run.cfg
    ev = seasons.find_event("event-2024-nov-dec", cfg)
    fake_run.listings[:] = [reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 4, (99, "ASCENDING"): 2})]
    dry = run.prepare_references(cfg, ev, dry_run=True, now=utc(2026, 10, 6, 9, 0))
    assert fake_run.started == [] and [e["state"] for e in dry.data["exports"]] == [
        "SKIPPED_THIN_REFERENCE", "PLANNED", "PLANNED"]

    fake_run.listings[:] = [reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 4, (99, "ASCENDING"): 2})]
    rl = run.prepare_references(cfg, ev, dry_run=False, command="sar_floods prepare event-2024-nov-dec",
                                now=utc(2026, 10, 6, 9, 5))
    log = json.loads(rl.path.read_text(encoding="utf-8"))
    h = log["params_hash"]
    assert log["purpose"] == "reference assets" and log["reference"]["windows"] == [["2024-02-01", "2024-04-30"]]
    assert [(e["name"], e["state"]) for e in log["exports"]] == [
        (f"jaga_sar_ref_2024_A099_10m_{h}", "SKIPPED_THIN_REFERENCE"),
        (f"jaga_sar_ref_2024_A172_10m_{h}", "SUBMITTED"), (f"jaga_sar_ref_2024_D091_10m_{h}", "SUBMITTED")]
    assert any("A099" in w for w in log["warnings"])
    assert log["reference"]["orbits"]["A172"]["towards_radar_deg"] == 258.4
    first = fake_run.started[0].options
    assert len(fake_run.started) == 2 and all(t.started for t in fake_run.started)
    assert first["assetId"] == f"projects/jaga-test-project/assets/jaga_sar/jaga_sar_ref_2024_A172_10m_{h}"
    assert first["description"] == f"jaga_sar_ref_2024_A172_10m_{h}" and first["crs"] == "EPSG:32647"
    assert first["crsTransform"] == log["grid"]["crs_transform"] and first["dimensions"] == log["grid"]["dimensions"]
    assert first["pyramidingPolicy"] == {".default": "mean", "layover": "max"}
    fake_run.ee.batch.Export.image.toDrive.assert_not_called()

    # Not started twice: a task already submitted, or the finished asset, is enough.
    fake_run.listings[:] = [reference_features({(91, "DESCENDING"): 5, (172, "ASCENDING"): 4})]
    fake_run.stored.add(f"jaga_sar_ref_2024_D091_10m_{h}")
    again = run.prepare_references(cfg, ev, dry_run=False, now=utc(2026, 10, 6, 9, 30))
    assert [e["state"] for e in again.data["exports"]] == ["SKIPPED_ALREADY_EXPORTED", "SKIPPED_ASSET_EXISTS"]
    assert len(fake_run.started) == 2


def test_run_reads_a_stored_reference_and_computes_the_others(fake_run):
    cfg = fake_run.cfg
    h = settings.params_hash(cfg, settings.aoi_sha256())
    fake_run.stored.add(f"jaga_sar_ref_2024_D091_10m_{h}")
    fake_run.stored.add("jaga_sar_ref_2024_A172_10m_0000000")        # other parameters: not used
    ev = seasons.find_event("event-2024-nov-dec", cfg)
    rl = run.run_event(cfg, ev, dry_run=True, with_thresholds=True, now=utc(2026, 10, 6, 10, 15))
    orbits = rl.data["reference"]["orbits"]
    assert orbits["D091"]["source"] == f"projects/jaga-test-project/assets/jaga_sar/jaga_sar_ref_2024_D091_10m_{h}"
    assert "towards_radar_deg" not in orbits["D091"]
    assert orbits["A172"]["source"] == "computed" and orbits["A172"]["towards_radar_deg"] == 258.4
    assert fake_run.looks == ["REF_A172_0"]                          # no plane fit for the stored orbit
    fake_run.ee.Image.assert_any_call(orbits["D091"]["source"])


def test_reference_names_and_the_asset_folder(cfg):
    assert naming.reference_name([2025, 2024], "D091", 10, "abc1234") == "jaga_sar_ref_2024-2025_D091_10m_abc1234"
    assert ee_ops.asset_folder_id("jaga-test-project", cfg) == "projects/jaga-test-project/assets/jaga_sar"
    bad = copy.deepcopy(cfg)
    bad["export"]["asset_folder"] = "a/b"
    with pytest.raises(settings.ConfigError, match="asset_folder"):
        settings.validate(bad)


def test_remaining_earth_engine_functions_run_against_the_stand_in(cfg, monkeypatch):
    """Not a test of Earth Engine: only that the request-building code has no Python-level mistakes."""
    fake = MagicMock(name="ee")
    monkeypatch.setattr(ee_ops, "_ee", fake)
    lattice = grid.tile_lattice((100.0453, 5.6053, 102.1021, 7.9477), 0.1)
    area = ee_ops.area(aoi.load())
    fake.Geometry.assert_called_once()
    col = ee_ops.s1_collection(cfg, area, 0, 1)
    describe = None

    def capture(fn):
        nonlocal describe
        describe = fn
        return MagicMock()

    col.map.side_effect = capture
    ee_ops.list_scenes(col)
    describe(MagicMock())
    assert set(fake.Feature.call_args.args[1]) == {"id", "time_start", "platform", "relative_orbit",
                                                   "absolute_orbit", "direction"}
    assert ee_ops.tile_histograms(cfg, MagicMock(), MagicMock(), area, lattice, [0, 1, 23]) == {}
    fake.Reducer.fixedHistogram.assert_called_once_with(-20.0, 10.0, 150)
    assert [label for label, _, _ in ee_ops.check(cfg, aoi.load())] == [
        "area (km2)", "JRC/GSW1_4/GlobalSurfaceWater", "MERIT/Hydro/v1_0_1",
        "projects/sat-io/open-datasets/FABDEM", "COPERNICUS/S1_GRD"]
    fake.batch.Export.image.toDrive.assert_not_called()


def test_failed_tasks_may_be_exported_again(tmp_path):
    def write(run_id, state):
        rl = runlog.RunLog(tmp_path / f"{run_id}.json", {"run_id": run_id, "exports": [
            {"name": "jaga_sar_max_season-2024_10m_a", "task_id": "T-" + run_id, "state": state},
            {"name": "planned_only", "task_id": None, "state": "PLANNED"}]})
        rl.save()

    write("20261006T100000Z_season-2024", "SUBMITTED")
    assert runlog.already_exported(tmp_path)["jaga_sar_max_season-2024_10m_a"]["task_id"] == "T-20261006T100000Z_season-2024"
    write("20261006T110000Z_season-2024", "FAILED")
    assert runlog.already_exported(tmp_path) == {}
    assert runlog.latest_run(tmp_path, with_tasks=True).data["run_id"] == "20261006T110000Z_season-2024"
    assert not list(tmp_path.glob("*.tmp"))
    assert runlog.already_exported(tmp_path / "missing") == {}


def test_status_writes_task_states_and_compute_back_into_the_log(tmp_path, monkeypatch):
    rl = runlog.RunLog(tmp_path / "r.json", {"run_id": "r", "exports": [
        {"name": "a", "task_id": "T1", "state": "SUBMITTED"}, {"name": "b", "task_id": "T2", "state": "SUBMITTED"},
        {"name": "c", "task_id": None, "state": "SKIPPED_ALREADY_EXPORTED"}]})
    fake = MagicMock()
    fake.data.getTaskStatus.return_value = [
        {"id": "T1", "state": "COMPLETED", "batch_eecu_usage_seconds": 5400.0, "description": "a"},
        {"id": "T2", "state": "FAILED", "error_message": "Computation timed out."}]
    monkeypatch.setenv("EE_PROJECT", "jaga-test-project")
    monkeypatch.setattr(ee_ops, "init", lambda project: setattr(ee_ops, "_ee", fake))
    counts = run.update_status(rl)
    ee_ops._ee = None
    assert counts == {"COMPLETED": 1, "FAILED": 1, "SKIPPED_ALREADY_EXPORTED": 1}
    saved = json.loads(rl.path.read_text(encoding="utf-8"))
    assert saved["eecu_seconds_total"] == 5400.0
    assert saved["exports"][0]["task"] == {"batch_eecu_usage_seconds": 5400.0}
    assert saved["exports"][1]["task"]["error_message"] == "Computation timed out."


# ---------------------------------------------------------------- frequency (local rasters)

def write_event_raster(path, g, extent, n_valid, n_flooded):
    import rasterio
    from rasterio.transform import Affine

    with rasterio.open(path, "w", driver="GTiff", dtype="uint8", count=3, width=g.width, height=g.height,
                       crs=g.crs, transform=Affine(g.scale, 0, g.x0, 0, -g.scale, g.y0), nodata=255) as dst:
        for i, band in enumerate((extent, n_valid, n_flooded), start=1):
            dst.write(band.astype("uint8"), i)


def test_frequency_block_divides_and_marks_unobserved_pixels():
    out = frequency.frequency_block(np.array([[0, 2, 0]], dtype=np.uint16), np.array([[4, 8, 0]], dtype=np.uint16))
    assert out.dtype == np.float32 and out.tolist() == [[0.0, 0.25, -1.0]]
    with pytest.raises(frequency.FrequencyError):
        frequency.frequency_block(np.array([[3]], dtype=np.uint16), np.array([[2]], dtype=np.uint16))


def test_frequency_sums_seasons_including_split_and_partial_files(tmp_path):
    import rasterio

    master = grid.Grid("EPSG:32647", 10, 600000, 800000, 40, 30)
    drive = tmp_path / "drive"
    drive.mkdir()
    ones = np.ones((30, 40))
    # Season 2023: one file. 8 valid observations everywhere, 2 flooded in the top-left quarter.
    flooded = np.zeros((30, 40))
    flooded[:15, :20] = 2
    write_event_raster(drive / "jaga_sar_max_season-2023_10m_abc1234.tif", master, ones * 0, ones * 8, flooded)
    # Season 2024: split by Earth Engine into a left and a right part; the right part has no-data
    # (255) in its count bands for the last five columns.
    left = grid.Grid("EPSG:32647", 10, 600000, 800000, 24, 30)
    right = grid.Grid("EPSG:32647", 10, 600240, 800000, 16, 30)
    write_event_raster(drive / "jaga_sar_max_season-2024_10m_abc1234-0000000000-0000000000.tif", left,
                       np.zeros((30, 24)), np.full((30, 24), 4), np.full((30, 24), 4))
    n_valid = np.full((30, 16), 4)
    n_valid[:, -5:] = 255
    write_event_raster(drive / "jaga_sar_max_season-2024_10m_abc1234-0000000000-0000000024.tif", right,
                       np.zeros((30, 16)), n_valid, np.zeros((30, 16)))
    # Other parameters or scales in the same folder are ignored.
    write_event_raster(drive / "jaga_sar_max_season-2022_10m_zzzzzzz.tif", master, ones * 0, ones * 9, ones * 9)

    files = frequency.season_files(drive, [2022, 2023, 2024], 10, "abc1234")
    assert sorted(files) == [2023, 2024] and len(files[2024]) == 2
    dest = tmp_path / "products" / "freq.tif"
    summary = frequency.write_frequency(files, master, dest, block=16)
    assert summary == {"seasons": [2023, 2024], "pixels_observed": 1200, "pixels_ever_flooded": 24 * 30}
    with rasterio.open(dest) as ds:
        assert ds.count == 3 and ds.dtypes[0] == "float32" and ds.nodata == -1
        assert ds.descriptions == ("frequency", "n_flooded", "n_valid")
        assert (ds.width, ds.height, ds.transform.c, ds.transform.f) == (40, 30, 600000, 800000)
        assert ds.tags()["seasons"] == "2023,2024" and ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
        freq, n_fl, n_va = ds.read()
    assert freq[0, 0] == pytest.approx((2 + 4) / (8 + 4))        # flooded in both seasons
    assert freq[20, 0] == pytest.approx(4 / 12)                  # 2024 only
    assert freq[0, 30] == pytest.approx(0.0)                     # right part: observed, never flooded
    assert n_va[0, 39] == 8 and freq[0, 39] == pytest.approx(0.0)   # 2024 has no data there: 2023 only
    assert n_fl[0, 0] == 6 and not list(dest.parent.glob("*.tmp.tif"))


def test_frequency_refuses_rasters_from_another_grid(tmp_path):
    master = grid.Grid("EPSG:32647", 10, 600000, 800000, 40, 30)
    shifted = grid.Grid("EPSG:32647", 10, 600005, 800000, 40, 30)
    path = tmp_path / "jaga_sar_max_season-2023_10m_abc1234.tif"
    write_event_raster(path, shifted, np.zeros((30, 40)), np.ones((30, 40)), np.zeros((30, 40)))
    with pytest.raises(frequency.FrequencyError, match="not on the export grid"):
        frequency.write_frequency({2023: [path]}, master, tmp_path / "out.tif")
    with pytest.raises(frequency.FrequencyError, match="download"):
        frequency.write_frequency({}, master, tmp_path / "out.tif")


# ---------------------------------------------------------------- command line

def test_upload_plan_prints_r2sync_commands_with_relative_paths(tmp_path):
    paths = settings.Paths(tmp_path / "out" / "sar_floods")
    paths.drive.mkdir(parents=True)
    paths.products.mkdir(parents=True)
    (paths.drive / "jaga_sar_max_season-2024_10m_abc1234.tif").write_bytes(b"II*\0")
    (paths.drive / "notes.txt").write_text("not ours")
    (paths.products / "jaga_sar_frequency_2017-2025_10m_abc1234.tif").write_bytes(b"II*\0")
    runlog.RunLog(paths.runs / "20261006T101500Z_season-2024.json",
                  {"run_id": "20261006T101500Z_season-2024", "exports": [{"name": "x", "task_id": "T1"}]}).save()
    runlog.RunLog(paths.runs / "20261006T090000Z_season-2024.json",
                  {"run_id": "20261006T090000Z_season-2024", "exports": [{"name": "x", "task_id": None}]}).save()
    lines = upload_commands(paths, date(2026, 10, 6), base=tmp_path)
    assert len(lines) == 3 and all(line.startswith("uv run python -m r2sync push out") for line in lines)
    assert all("--bucket private --key sar/" in line and str(tmp_path) not in line for line in lines)
    assert lines[0].endswith("--key sar/max/season-2024_10m_abc1234/2026-10-06.tif")
    assert lines[2].endswith("--key sar/runs/20261006T101500Z_season-2024.json")     # dry runs are not uploaded


def test_cli_lists_events_without_earth_engine_and_rejects_unknown_events(capsys, monkeypatch):
    monkeypatch.setattr(ee_ops, "init", lambda project: pytest.fail("events must not touch Earth Engine"))
    assert main(["events"]) == 0
    out = capsys.readouterr().out
    assert "season-2017" in out and "event-2025-nov-dec     2025-11-01 to 2025-12-31" in out
    assert "reference 2024-02-01 to 2024-04-30   per-scene exports" in out


def test_cli_reports_a_missing_project_as_a_fixable_error(capsys, monkeypatch, tmp_path):
    monkeypatch.delenv("EE_PROJECT", raising=False)
    monkeypatch.setattr(settings, "env_value", lambda key: None)
    monkeypatch.setattr(settings, "output_paths", lambda c: settings.Paths(tmp_path))
    monkeypatch.setattr("sar_floods.__main__._setup_logging", lambda paths: None)
    assert main(["run", "event-2024-nov-dec", "--dry-run"]) == 1
    assert "EE_PROJECT is not set" in capsys.readouterr().err
    assert main(["run", "season-1999", "--dry-run"]) == 1
    assert "Unknown event" in capsys.readouterr().err
