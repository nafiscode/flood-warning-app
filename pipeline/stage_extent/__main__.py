"""Command line: `uv run python -m stage_extent <command>` from the pipeline folder.

Commands
  reach        the reach of each key gauge (main stem, the land draining onto it, height above it)
               -> <output_dir>/reach_<code>.npz and reaches.geojson (the stems, for a look).
  pairs        every radar pass of the second run (hash in config) paired with the gauge's level
               -> <output_dir>/pairs_<code>.npz and pairs.json. Needs `reach`.
  calibrate    z0 per gauge by the best CSI, in-sample and season by season held out
               -> <output_dir>/calibration.json. Needs `pairs`.
  layers       first-wet stage per cell (GeoTIFF per gauge), the lookup table, one PMTiles file and
               the summary -> <output_dir>/. Needs `calibrate`.
  run          all four in order.

Everything is local: no Earth Engine, no network. Settings: stage_extent/config.yaml; method and
results: stage_extent/METHODS.md; docs/science-plan.md Module 4.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from pathlib import Path

import numpy as np
import yaml

from hazard.hand import NODATA
from ingest_thaiwater.settings import PIPELINE_DIR

from . import bands, calibrate, radar, reach

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("stage_extent")
CELL_M = 30.0
ALIGN_CELLS = 2          # windows start and end on 60 m, where the 30 m and the 20 m radar grids meet


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise ValueError("output_dir must be inside pipeline/.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def path(cfg: dict, key: str) -> Path:
    return PIPELINE_DIR / cfg["inputs"][key]


# --------------------------------------------------------------------------- reach

def _window(transform, shape: tuple[int, int], x: float, y: float, half_m: float) -> tuple[int, int, int, int]:
    """(row, col, rows, cols) of a square around (x, y) on the grid, on whole 60 m steps, clipped to it."""
    c0 = int(np.floor((x - half_m - transform.c) / transform.a / ALIGN_CELLS)) * ALIGN_CELLS
    r0 = int(np.floor((transform.f - (y + half_m)) / -transform.e / ALIGN_CELLS)) * ALIGN_CELLS
    n = int(np.ceil(2 * half_m / transform.a / ALIGN_CELLS)) * ALIGN_CELLS
    r0, c0 = max(r0, 0), max(c0, 0)
    rows = min(n, (shape[0] - r0) // ALIGN_CELLS * ALIGN_CELLS)
    cols = min(n, (shape[1] - c0) // ALIGN_CELLS * ALIGN_CELLS)
    return r0, c0, rows, cols


def _read(p: Path, window: tuple[int, int, int, int], band: int = 1, transform=None, fill=0):
    """A window of a raster. With `transform` (the window's own), it is read by position, so rasters on
    other 30 m extents (buildings, classes) line up; outside the raster, `fill`."""
    import rasterio
    from rasterio.windows import Window, from_bounds

    r, c, h, w = window
    with rasterio.open(p) as src:
        if transform is None:
            return src.read(band, window=Window(c, r, w, h))
        west, north = transform * (0, 0)
        east, south = transform * (w, h)
        win = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
        return src.read(band, window=win, boundless=True, fill_value=fill, out_shape=(h, w))


def build_reach(cfg: dict, code: str, g: dict) -> dict:
    import rasterio
    from pyproj import Transformer
    from rasterio.transform import Affine

    from thresholds import basins

    rc = cfg["reach"]
    with rasterio.open(path(cfg, "hand")) as src:
        transform, crs, shape = src.transform, src.crs.to_string(), src.shape
    x, y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(*g["point"])
    half = (max(rc["up_km"], rc["down_km"]) + rc["margin_km"]) * 1000.0
    win = _window(transform, shape, x, y, half)
    pointer = _read(path(cfg, "pointer"), win)
    accum = _read(path(cfg, "accumulation"), win)
    surface = _read(path(cfg, "surface"), win)
    hand = _read(path(cfg, "hand"), win)
    col, row = ~(transform * Affine.translation(win[1], win[0])) * (x, y)
    r, c = basins.snap(accum, int(row), int(col), int(g.get("snap_cells", 12)))
    stem_mask, cells = reach.stem(pointer, accum, r, c, rc["up_km"] * 1000.0, rc["down_km"] * 1000.0, CELL_M)
    above = reach.height_above_stem(pointer, stem_mask, surface)
    height = reach.reach_height(hand, above, float(rc["tributary_allowance_m"]))
    del pointer, accum

    # Crop to the land that drains onto the stem (whole 60 m steps), to keep every later read small.
    rr, cc = np.nonzero(np.isfinite(height) & (height <= rc["max_height_m"]))
    r0 = int(rr.min()) // ALIGN_CELLS * ALIGN_CELLS
    c0 = int(cc.min()) // ALIGN_CELLS * ALIGN_CELLS
    r1 = -(-(int(rr.max()) + 1) // ALIGN_CELLS) * ALIGN_CELLS
    c1 = -(-(int(cc.max()) + 1) // ALIGN_CELLS) * ALIGN_CELLS
    r1, c1 = min(r1, height.shape[0]), min(c1, height.shape[1])
    height = height[r0:r1, c0:c1]
    above = above[r0:r1, c0:c1]
    hand = np.where(hand[r0:r1, c0:c1] == NODATA, np.nan, hand[r0:r1, c0:c1]).astype("float32")
    stem_crop = stem_mask[r0:r1, c0:c1]
    sub = (win[0] + r0, win[1] + c0, r1 - r0, c1 - c0)
    sub_t = transform * Affine.translation(sub[1], sub[0])
    province = _read(path(cfg, "classes"), sub, 1, sub_t) > 0
    presence = _read(path(cfg, "buildings"), sub, 1, sub_t).astype("float32")
    count = _read(path(cfg, "buildings"), sub, 2, sub_t).astype("float32")
    sc = cfg["scoring"]
    built = reach.built_up(presence, int(sc["built_window_cells"]), float(sc["built_min_presence"]))
    height = np.where(province, height, np.nan).astype("float32")
    above = np.where(province, above, np.nan).astype("float32")
    to_deg = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    gx, gy = transform * Affine.translation(win[1], win[0]) * (c + 0.5, r + 0.5)
    stem_line = [to_deg(*(transform * Affine.translation(win[1], win[0]) * (cc_ + 0.5, rr_ + 0.5))) for rr_, cc_, _ in cells]
    meta = {"code": code, "crs": crs, "transform": list(sub_t)[:6], "shape": list(height.shape),
            "gauge_snapped": [round(v, 6) for v in to_deg(gx, gy)],
            "stem_km": [round(cells[0][2], 2), round(cells[-1][2], 2)],
            "dem_at_gauge_m": round(float(surface[r, c]), 2),
            "reach_km2": round(float((np.isfinite(height) & (height <= rc["max_height_m"])).sum()) * CELL_M ** 2 / 1e6, 1),
            "low_km2": round(float((np.isfinite(height) & (height <= rc["low_height_m"])).sum()) * CELL_M ** 2 / 1e6, 1),
            "built_low_km2": round(float((np.isfinite(height) & (height <= rc["low_height_m"]) & built).sum()) * CELL_M ** 2 / 1e6, 1)}
    return {"height": height, "hand": hand, "above": above, "built": built, "count": count, "stem": stem_crop,
            "meta": meta, "stem_line": stem_line}


def cmd_reach(cfg: dict) -> int:
    out = output_dir(cfg)
    feats = []
    for code, g in cfg["gauges"].items():
        rch = build_reach(cfg, code, g)
        np.savez_compressed(out / f"reach_{code}.npz", height=rch["height"], hand=rch["hand"], above=rch["above"],
                            built=rch["built"], count=rch["count"], stem=rch["stem"], meta=json.dumps(rch["meta"]))
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[round(a, 6), round(b, 6)] for a, b in rch["stem_line"]]},
                      "properties": rch["meta"] | {"transform": None}})
        m = rch["meta"]
        print(f"{code:7} stem {m['stem_km'][0]:+.1f}..{m['stem_km'][1]:+.1f} km, reach {m['reach_km2']} km2 "
              f"(low {m['low_km2']}, of it built-up {m['built_low_km2']}), DEM at gauge {m['dem_at_gauge_m']} m")
    (out / "reaches.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return 0


def load_reach(out: Path, code: str) -> dict:
    p = out / f"reach_{code}.npz"
    if not p.exists():
        raise SystemExit("Run `reach` first.")
    z = np.load(p)
    return {"height": z["height"], "hand": z["hand"], "above": z["above"], "built": z["built"], "count": z["count"],
            "stem": z["stem"], "meta": json.loads(str(z["meta"]))}


# --------------------------------------------------------------------------- pairs

def gauge_level(cfg: dict, g: dict):
    from dam_release.travel import read_hourly

    s = read_hourly(PIPELINE_DIR / cfg["inputs"]["tidy"], "water_level_msl", int(g["id"])).dropna()
    return s[s < float(g["bank_m"]) + float(cfg["pairing"]["max_above_bank_m"])]


def cmd_pairs(cfg: dict) -> int:
    import rasterio
    from rasterio.transform import Affine

    out = output_dir(cfg)
    rdir = path(cfg, "radar_dir")
    scenes = radar.pick_scenes(sorted(p.name for p in rdir.glob("jaga_sar_scene_*.tif")), cfg["inputs"]["radar_hash"])
    pc, sc, rc = cfg["pairing"], cfg["scoring"], cfg["reach"]
    flooded_codes, dry_codes = tuple(sc["flooded_codes"]), tuple(sc["dry_codes"])
    summary = {}
    for code, g in cfg["gauges"].items():
        rch = load_reach(out, code)
        meta = rch["meta"]
        t = Affine(*meta["transform"])
        rows, cols = meta["shape"]
        height, built = rch["height"], rch["built"]
        low = np.isfinite(height) & (height <= rc["low_height_m"])
        scored = np.isfinite(height) & ~built
        level = gauge_level(cfg, g)
        x0, y1 = t * (0, 0)
        x1, y0 = t * (cols, rows)
        entries, hf, hd, hfb, hdb = [], [], [], [], []
        cands = rc.get("allowance_candidates") or []
        cand_heights = [reach.reach_height(rch["hand"], rch["above"], 1e6 if a is None else float(a)) for a in cands]
        cand_hist: list[list] = [[] for _ in cands]
        twins, last = [], None
        skipped = {"no_gauge_reading": 0, "outside_scene": 0, "too_little_seen": 0}
        for s in scenes:
            at = calibrate.stage_at(level, s["time"], float(pc["max_offset_h"])) if not level.empty else None
            if at is None:
                skipped["no_gauge_reading"] += 1
                continue
            p = rdir / s["name"]
            with rasterio.open(p) as src:
                b = src.bounds
                rt = src.transform
            if b.right <= x0 or b.left >= x1 or b.top <= y0 or b.bottom >= y1:
                skipped["outside_scene"] += 1
                continue
            codes = radar.read_codes(p, radar.radar_window(t, 0, 0, rows, cols, rt))
            if (codes == 255).all():
                skipped["outside_scene"] += 1
                continue
            known, share = radar.aggregate(codes, s["res_m"], int(CELL_M), flooded_codes, dry_codes)
            del codes
            obs = radar.classify(known, share, float(sc["min_known_share"]), float(sc["flood_share"]))
            seen = float(((obs >= 0) & low).sum()) / max(int(low.sum()), 1)
            stage, off = at
            entry = {"time": s["time"].isoformat(), "season": radar.season_of(s["time"]), "sat": s["sat"],
                     "orbit": s["orbit"], "res_m": s["res_m"], "stage_m": round(stage, 3), "offset_h": off,
                     "low_seen": round(seen, 3),
                     "flooded_low_km2": round(float(((obs == 1) & low).sum()) * CELL_M ** 2 / 1e6, 2),
                     "flooded_low_built_km2": round(float(((obs == 1) & low & built).sum()) * CELL_M ** 2 / 1e6, 2)}
            if seen < float(pc["min_observed_share"]):
                skipped["too_little_seen"] += 1
                entry["kept"] = False
                entries.append(entry)
                continue
            entry["kept"] = True
            f, d = calibrate.histograms(height, obs, scored, float(sc["bin_m"]), float(rc["max_height_m"]))
            fb, db = calibrate.histograms(height, obs, np.isfinite(height), float(sc["bin_m"]), float(rc["max_height_m"]))
            hf.append(f), hd.append(d), hfb.append(fb), hdb.append(db)
            for i, hh in enumerate(cand_heights):
                cand_hist[i].append(calibrate.histograms(hh, obs, scored, float(sc["bin_m"]), float(rc["max_height_m"])))
            entries.append(entry)
            # Two passes less than a day apart: how well the radar agrees with itself.
            if last is not None and (s["time"] - last[0]).total_seconds() <= 24 * 3600:
                both = scored & (obs >= 0) & (last[1] >= 0)
                a, b2 = last[1][both] == 1, obs[both] == 1
                twins.append({"first": last[0].isoformat(), "second": s["time"].isoformat(), "stages": [last[2], entry["stage_m"]],
                              **calibrate.metrics(int((a & b2).sum()), int((~a & b2).sum()), int((a & ~b2).sum()))})
            last = (s["time"], obs, entry["stage_m"])
        kept = [e for e in entries if e["kept"]]
        extra = {}
        for i, a in enumerate(cands):
            if cand_hist[i]:
                extra[f"flooded_a{i}"] = np.array([x[0] for x in cand_hist[i]])
                extra[f"dry_a{i}"] = np.array([x[1] for x in cand_hist[i]])
        np.savez_compressed(out / f"pairs_{code}.npz", flooded=np.array(hf), dry=np.array(hd),
                            flooded_with_built=np.array(hfb), dry_with_built=np.array(hdb),
                            stages=np.array([e["stage_m"] for e in kept]),
                            seasons=np.array([e["season"] for e in kept]),
                            times=np.array([e["time"] for e in kept]), **extra)
        summary[code] = {"scenes": len(scenes), "paired": len(entries), "kept": len(kept), "skipped": skipped,
                         "allowance_candidates": cands, "radar_vs_radar": twins, "passes": entries}
        below = calibration_depth(cfg, g)
        hi = [e for e in kept if e["stage_m"] >= float(g["bank_m"]) - below]
        print(f"{code:7} {len(entries)} passes with a reading, {len(kept)} seen well enough, {len(hi)} of them "
              f"within {below} m of the bank or above; skipped {skipped}; {len(twins)} pairs of passes within a day")
    (out / "pairs.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    return 0


# --------------------------------------------------------------------------- calibrate

def calibration_depth(cfg: dict, g: dict) -> float:
    """How far below its bank a gauge may stand for a pass to calibrate it (per gauge, else the default)."""
    return float(g.get("min_stage_below_bank_m", cfg["calibration"]["min_stage_below_bank_m"]))


def load_pairs(out: Path, code: str) -> dict:
    p = out / f"pairs_{code}.npz"
    if not p.exists():
        raise SystemExit("Run `pairs` first.")
    z = np.load(p)
    return {k: z[k] for k in z.files}


def calibrate_gauge(cfg: dict, g: dict, pairs: dict, dem_at_gauge: float) -> dict:
    sc, cc = cfg["scoring"], cfg["calibration"]
    bin_m = float(sc["bin_m"])
    bank = float(g["bank_m"])
    lo, hi = cc["z0_below_bank_m"]
    z0s = np.round(np.arange(bank - float(lo), bank - float(hi) + bin_m / 2, bin_m), 4)
    stages = pairs["stages"].astype("float64")
    if stages.size == 0:
        return {"error": "no paired pass"}
    high = stages >= bank - calibration_depth(cfg, g)
    f, d = pairs["flooded"], pairs["dry"]
    res: dict = {"passes_paired_and_seen": int(stages.size), "passes_calibration": int(high.sum()),
                 "calibration_from_m": round(bank - calibration_depth(cfg, g), 2),
                 "seasons_calibration": sorted({int(s) for s in pairs["seasons"][high]}),
                 "stage_range_calibration": [round(float(stages[high].min()), 2), round(float(stages[high].max()), 2)] if high.any() else None,
                 "flooded_cells_calibration": int(f[high].sum()) if high.any() else 0}
    if not high.any() or f[high].sum() == 0:
        res["error"] = "no calibration pass with any flooded cell in the reach"
        return res
    z0, curve = best_z0(f[high], d[high], stages[high], z0s, bin_m)
    res["z0_m"] = round(z0, 2)
    res["z0_below_bank_m"] = round(bank - z0, 2)
    res["in_sample"] = calibrate.score(f[high], d[high], stages[high], z0, bin_m)
    res["held_out_by_season"] = calibrate.leave_one_out(pairs["seasons"][high], f[high], d[high], stages[high], z0s, bin_m)
    res["all_seen_passes_at_z0"] = calibrate.score(f, d, stages, z0, bin_m)
    res["with_built_up_at_z0"] = calibrate.score(pairs["flooded_with_built"][high], pairs["dry_with_built"][high],
                                                 stages[high], z0, bin_m)
    res["dem_prior"] = {"z0_m": round(dem_at_gauge, 2), **calibrate.score(f[high], d[high], stages[high], dem_at_gauge, bin_m)}
    # How flat the optimum is: the z0 range within 0.02 CSI of the best.
    near = z0s[curve >= curve.max() - 0.02]
    res["z0_within_002_csi"] = [round(float(near.min()), 2), round(float(near.max()), 2)]
    res["ceiling_best_cut_per_pass"] = calibrate.ceiling(f[high], d[high], stages[high], z0, bin_m)
    # The other ways of measuring height (config reach.allowance_candidates), on the same passes.
    table = []
    for i, a in enumerate(cfg["reach"].get("allowance_candidates") or []):
        key = f"flooded_a{i}"
        if key not in pairs:
            continue
        fa, da = pairs[key][high], pairs[f"dry_a{i}"][high]
        if fa.sum() == 0:
            continue
        za, _ = best_z0(fa, da, stages[high], z0s, bin_m)
        table.append({"allowance_m": a, "z0_m": round(za, 2), **{k: v for k, v in calibrate.score(fa, da, stages[high], za, bin_m).items()
                                                                if k in ("csi", "hit_rate", "false_alarm_ratio")},
                      "held_out_csi": calibrate.leave_one_out(pairs["seasons"][high], fa, da, stages[high], z0s, bin_m)["pooled"]["csi"]})
    res["height_choices"] = table
    per = []
    for i in np.flatnonzero(high):
        m = calibrate.score(f[i:i + 1], d[i:i + 1], stages[i:i + 1], z0, bin_m)
        per.append({"time": str(pairs["times"][i]), "season": int(pairs["seasons"][i]), "stage_m": round(float(stages[i]), 2),
                    "radar_flooded_cells": int(f[i].sum()), **m})
    res["passes"] = per
    return res


def best_z0(f, d, stages, z0s, bin_m):
    return calibrate.best_z0(f, d, stages, z0s, bin_m)


def cmd_calibrate(cfg: dict) -> int:
    out = output_dir(cfg)
    result = {}
    for code, g in cfg["gauges"].items():
        meta = load_reach(out, code)["meta"]
        res = calibrate_gauge(cfg, g, load_pairs(out, code), float(meta["dem_at_gauge_m"]))
        result[code] = res
        if "error" in res:
            print(f"{code:7} {res['error']}")
            continue
        ho = res["held_out_by_season"]["pooled"]
        ins = res["in_sample"]
        print(f"{code:7} z0 {res['z0_m']} m (bank - {res['z0_below_bank_m']}), {res['passes_calibration']} passes; "
              f"CSI {ins['csi']} in-sample, {ho['csi']} held out; hit {ins['hit_rate']}, FAR {ins['false_alarm_ratio']}; "
              f"DEM prior z0 {res['dem_prior']['z0_m']} -> CSI {res['dem_prior']['csi']}; "
              f"mean CSI per pass {res['ceiling_best_cut_per_pass'].get('mean_csi_at_z0')} "
              f"(best cut per pass {res['ceiling_best_cut_per_pass'].get('mean_csi_best_cut_per_pass')})")
        for row in res["height_choices"]:
            print(f"        allowance {row['allowance_m']}: z0 {row['z0_m']}, CSI {row['csi']}, held out {row['held_out_csi']}")
    (out / "calibration.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    return 0


# --------------------------------------------------------------------------- layers

def cmd_layers(cfg: dict) -> int:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import transform_bounds

    from . import tiles

    out = output_dir(cfg)
    cal_path = out / "calibration.json"
    if not cal_path.exists():
        raise SystemExit("Run `calibrate` first.")
    cal = json.loads(cal_path.read_text(encoding="utf-8"))
    bc, tc = cfg["bands"], cfg["tiles"]
    digest = cfg["inputs"]["radar_hash"]
    pm_name = f"stage_extent_{digest}.pmtiles"
    lookup_rows, tile_inputs, summary = [], [], {}
    for code, g in cfg["gauges"].items():
        if "z0_m" not in cal.get(code, {}):
            print(f"{code:7} no z0: left out of the layers")
            continue
        rch = load_reach(out, code)
        meta = rch["meta"]
        t = Affine(*meta["transform"])
        level = gauge_level(cfg, g)
        record = float(level.max())
        st = bands.steps(float(g["bank_m"]), record, float(bc["step_m"]), float(bc["from_below_bank_m"]), float(bc["above_record_m"]))
        z0 = float(cal[code]["z0_m"])
        index = bands.band_index(rch["height"], z0, st)
        from_m = np.where(index > 0, st[np.maximum(index, 1) - 1], np.nan).astype("float32")
        tif = out / f"stage_extent_{code}_{digest}.tif"
        with rasterio.open(tif, "w", driver="GTiff", dtype="float32", count=1, width=index.shape[1], height=index.shape[0],
                           crs=meta["crs"], transform=t, nodata=np.nan, compress="deflate", tiled=True,
                           blockxsize=256, blockysize=256) as dst:
            dst.write(from_m, 1)
            dst.update_tags(station=code, z0_m=str(z0), meaning="gauge stage (m MSL) at which the cell is first under water")
        rows = bands.lookup(index, st, CELL_M ** 2 / 1e6, rch["count"])
        for r in rows:
            lookup_rows.append({"station_code": code, **r, "layer_file": pm_name})
        bounds = transform_bounds(meta["crs"], "EPSG:4326", *rasterio.transform.array_bounds(index.shape[0], index.shape[1], t))
        tile_inputs.append({"code": code, "index": index, "transform": t, "crs": meta["crs"], "steps": st,
                            "bounds_deg": [round(v, 5) for v in bounds]})
        at_bank = next((r for r in rows if r["stage_m"] >= float(g["bank_m"])), rows[-1])
        summary[code] = {"place": g["place"], "bank_m": g["bank_m"], "record_m": round(record, 2),
                         "record_at": level.idxmax().isoformat(), "z0_m": z0, "steps": [float(st[0]), float(st[-1]), len(st)],
                         "area_at_bank_km2": at_bank["area_km2"], "buildings_at_bank": at_bank.get("buildings"),
                         "area_at_top_km2": rows[-1]["area_km2"], "buildings_at_top": rows[-1].get("buildings"),
                         "geotiff": tif.name, "geotiff_kb": round(tif.stat().st_size / 1024)}
        print(f"{code:7} steps {st[0]}..{st[-1]} m ({len(st)}), at bank {at_bank['area_km2']} km2, "
              f"at top {rows[-1]['area_km2']} km2, {rows[-1].get('buildings')} buildings")
    if not tile_inputs:
        raise SystemExit("No gauge has a z0.")
    lk = out / f"stage_extent_lookup_{digest}.csv"
    with open(lk, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["station_code", "stage_m", "area_km2", "buildings", "layer_file"])
        w.writeheader()
        w.writerows(lookup_rows)
    built = tiles.build(tile_inputs, out / pm_name, min_zoom=int(tc["min_zoom"]), max_zoom=int(tc["max_zoom"]),
                        tile_px=int(tc["tile_px"]), buffer_px=int(tc["buffer_px"]), min_share=float(tc["coarse_min_share"]),
                        layer=tc["layer"], sigma_px=float(tc["smooth_sigma_px"]), simplify_px=float(tc["simplify_px"]),
                        smooth_cut=float(tc["smooth_cut"]),
                        metadata={"name": "Jaga stage-to-extent", "description": tc["description"],
                                  "attribution": tc["attribution"], "licence": tc["licence"], "radar_hash": digest,
                                  "z0": json.dumps({c: cal[c]["z0_m"] for c in summary})})
    doc = {"radar_hash": digest, "pmtiles": built, "lookup_csv": lk.name, "lookup_kb": round(lk.stat().st_size / 1024, 1),
           "gauges": {c: {**summary[c], "calibration": {k: cal[c].get(k) for k in (
               "passes_paired_and_seen", "passes_calibration", "calibration_from_m", "seasons_calibration",
               "z0_below_bank_m", "z0_within_002_csi", "in_sample", "dem_prior", "with_built_up_at_z0",
               "all_seen_passes_at_z0", "ceiling_best_cut_per_pass", "height_choices")} | {
               "held_out_by_season": cal[c]["held_out_by_season"]["pooled"]}} for c in summary}}
    (out / f"stage_extent_summary_{digest}.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"{pm_name}: {built['mb']} MB, {built['tiles']} tiles; {lk.name}: {len(lookup_rows)} rows")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="stage_extent", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("reach", "pairs", "calibrate", "layers", "run"):
        sub.add_parser(name)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    steps_ = {"reach": [cmd_reach], "pairs": [cmd_pairs], "calibrate": [cmd_calibrate], "layers": [cmd_layers],
              "run": [cmd_reach, cmd_pairs, cmd_calibrate, cmd_layers]}[args.command]
    for fn in steps_:
        code = fn(cfg)
        if code:
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
