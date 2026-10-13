"""Command line: `uv run python -m gistda <command>` from the pipeline folder.

Commands
  fetch      GISTDA's repeated-flood polygons for the four provinces -> <output_dir>/flood_freq/
             (needs GISTDA_API_KEY in .env.local; resumable; about 480,000 polygons, 20 minutes)
  burn       those polygons on the 20 m radar grid, one bit per year
             -> <output_dir>/gistda_flood_years_20m.tif
  compare    season by season against the radar season maxima, their count of years against ours,
             and against the hazard classes -> <output_dir>/compare_<radar hash>.json
  minimal    the land GISTDA flags that the hazard map calls Minimal: how much, where and why
             -> <output_dir>/minimal_<radar hash>.json, minimal_by_tambon_*.csv, minimal_patches_*.geojson

Settings: gistda/config.yaml. Outputs are local (ignored by git).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, env_value

from . import compare, fetch

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"
log = logging.getLogger("gistda")


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise SystemExit("output_dir must be relative to pipeline/ and inside it.")
    return root


def season_file(cfg: dict, year: int) -> Path:
    p = (PIPELINE_DIR / "out" / "sar_floods" / "products"
         / f"jaga_sar_max_season-{year}_{cfg['season_scale_m']}m_{cfg['radar_hash']}.tif")
    if not p.exists():
        raise SystemExit(f"{p.name} is missing: build the radar season maxima first (sar_floods maximum).")
    return p


def bits_file(cfg: dict) -> Path:
    return output_dir(cfg) / f"gistda_flood_years_{cfg['season_scale_m']}m.tif"


def cmd_fetch(cfg: dict) -> None:
    import httpx

    key = env_value("GISTDA_API_KEY")
    if not key:
        raise SystemExit("GISTDA_API_KEY is not set in .env.local.")
    agent = cfg["user_agent"].format(contact=env_value("CONTACT_EMAIL") or "")
    with httpx.Client(headers={"API-Key": key, "accept": "application/json", "user-agent": agent}, timeout=120) as client:
        for province in cfg["provinces"]:
            n = fetch.fetch_province(client, f"{cfg['api_base']}/flood-freq", output_dir(cfg), province,
                                     cfg["page_size"], cfg["pause_s"])
            print(f"province {province}: {n} polygons")


def cmd_burn(cfg: dict) -> None:
    import rasterio
    from pyproj import Transformer

    first, last = cfg["their_years"]
    with rasterio.open(season_file(cfg, cfg["seasons"][1])) as src:
        profile, transform, shape, crs = src.profile, src.transform, src.shape, src.crs
    to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    root = output_dir(cfg)
    scratch = root / "burn.dat"
    grid = np.lib.format.open_memmap(scratch, mode="w+", dtype=np.uint16, shape=shape)
    total, area_rai = 0, {y: 0.0 for y in range(first, last + 1)}
    for province in cfg["provinces"]:
        for path in fetch.pages(root, province):
            page = fetch.read_page(path)
            total += compare.burn(grid, transform, page, to_grid, first, last)
            for f in page:
                p = f["properties"]
                for y in area_rai:
                    if p.get(f"y_{y}"):
                        area_rai[y] += float(p.get("area_rai") or 0)
        log.info("province %s burned", province)
    grid.flush()
    profile.update(count=1, dtype="uint16", nodata=None, compress="deflate", predictor=2, tiled=True,
                   blockxsize=512, blockysize=512, driver="GTiff")
    cell_km2 = abs(transform.a * transform.e) / 1e6
    raster_km2 = {}
    with rasterio.open(bits_file(cfg), "w", **profile) as dst:
        step = cfg["strip_rows"]
        counts = np.zeros(last - first + 1, dtype=np.int64)
        for r0 in range(0, shape[0], step):
            part = np.array(grid[r0:r0 + step])
            dst.write(part, 1, window=((r0, r0 + part.shape[0]), (0, shape[1])))
            for i in range(len(counts)):
                counts[i] += int(((part >> i) & 1).sum())
        dst.set_band_description(1, "flood_years")
        dst.update_tags(source="GISTDA flood-freq (open API)", bits=f"bit 0 = {first}, bit {last - first} = {last}")
        raster_km2 = {first + i: round(int(c) * cell_km2, 1) for i, c in enumerate(counts)}
    part = None
    grid._mmap.close()                 # Windows will not delete a file that is still mapped
    del grid
    scratch.unlink()
    # 1 rai = 1,600 m2. The two columns should agree: the burn uses the cell-centre rule.
    check = {str(y): {"polygons_km2": round(area_rai[y] * 0.0016, 1), "raster_km2": raster_km2[y]} for y in area_rai}
    (root / "burn.json").write_text(json.dumps({"polygons": total, "by_year": check}, indent=1), encoding="utf-8")
    print(f"{total} polygons burned -> {bits_file(cfg).name}")
    for y, row in check.items():
        print(f"  {y}: polygons {row['polygons_km2']:>8} km2, raster {row['raster_km2']:>8} km2")


def province_strip(provinces: dict, crs, transform, r0: int, rows: int, cols: int) -> np.ndarray:
    """1-based position of the province each cell centre of a strip falls in (0 = none)."""
    from rasterio import features
    from rasterio.windows import Window, transform as window_transform

    t = window_transform(Window(0, r0, cols, rows), transform)
    return features.rasterize(((g, i + 1) for i, g in enumerate(provinces.values())), out_shape=(rows, cols),
                              transform=t, fill=0, dtype="uint8")


def cmd_compare(cfg: dict) -> None:
    import rasterio
    import shapely
    from pyproj import Transformer
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import Resampling, transform_bounds
    from rasterio.windows import from_bounds

    from hazard.classes import BASIS_NAMES, NAMES
    from hazard.__main__ import load_config as hazard_config
    from sar_floods.aoi import province_geometries

    first, last = cfg["their_years"]
    s_from, s_to = cfg["seasons"]
    years = list(range(s_from, s_to + 1))
    codes = list(cfg["provinces"])
    if not bits_file(cfg).exists():
        raise SystemExit("Run `gistda burn` first.")
    seasons = {y: rasterio.open(season_file(cfg, y)) for y in years}
    bits_src = rasterio.open(bits_file(cfg))
    ref = seasons[years[0]]
    crs, transform, (n_rows, n_cols) = ref.crs, ref.transform, ref.shape
    cell_km2 = abs(transform.a * transform.e) / 1e6
    to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    provinces = {c: shapely.transform(g, lambda x, y: to_grid(x, y), interleaved=False)
                 for c, g in province_geometries(codes).items()}
    provinces = {c: provinces[c] for c in codes}
    n_p, halo, step = len(codes) + 1, cfg["near_cells"], cfg["strip_rows"]

    def zeros():
        return np.zeros(n_p, dtype=np.int64)

    # counts[year][name] -> cells per province position
    names = ("ours_vv", "ours_any", "theirs_year", "theirs_season", "both_vv_year", "both_vv_season",
             "both_any_season", "ours_vv_near_theirs", "theirs_near_ours_vv",
             "theirs_on_observed", "theirs_on_masked_terrain", "theirs_on_permanent_water", "theirs_on_no_data")
    counts = {y: {k: zeros() for k in names} for y in years}
    n_y = len(years) + 1
    freq_table = np.zeros((n_y, n_y), dtype=np.int64)

    for r0 in range(0, n_rows, step):
        a, b = max(r0 - halo, 0), min(r0 + step + halo, n_rows)       # with a halo, for the "near" figures
        inner = slice(r0 - a, r0 - a + min(step, n_rows - r0))
        win = ((a, b), (0, n_cols))
        prov = province_strip(provinces, crs, transform, a, b - a, n_cols)
        bits = bits_src.read(1, window=win)
        ours_n, seen_any = np.zeros(prov.shape, dtype=np.uint8), np.zeros(prov.shape, dtype=bool)
        for y in years:
            extent = seasons[y].read(1, window=win)
            seen = (extent <= compare.BOTH) & (prov > 0)
            vv = ((extent == compare.VV) | (extent == compare.BOTH)) & seen
            anyp = (extent >= compare.VV) & (extent <= compare.BOTH) & seen
            t_year = ((bits >> (y - first)) & 1).astype(bool)
            # A season runs October to January, so their following year may hold the same flood.
            t_season = t_year | (((bits >> (y + 1 - first)) & 1).astype(bool) if y + 1 <= last else False)
            c = counts[y]

            def add(name, mask):
                c[name] += np.bincount(prov[inner][mask[inner]], minlength=n_p)

            add("ours_vv", vv)
            add("ours_any", anyp)
            add("theirs_year", t_year & seen)
            add("theirs_season", t_season & seen)
            add("both_vv_year", vv & t_year)
            add("both_vv_season", vv & t_season)
            add("both_any_season", anyp & t_season)
            add("ours_vv_near_theirs", vv & compare.near(t_season, halo))
            add("theirs_near_ours_vv", t_season & seen & compare.near(vv, halo))
            in_p = t_season & (prov > 0)
            add("theirs_on_observed", in_p & (extent <= compare.BOTH))
            add("theirs_on_masked_terrain", in_p & (extent == compare.MASKED))
            add("theirs_on_permanent_water", in_p & (extent == compare.WATER))
            add("theirs_on_no_data", in_p & (extent == compare.NO_DATA))
            ours_n += vv
            seen_any |= seen
        theirs_n = compare.count_years(bits, first, s_from, s_to)
        freq_table += compare.cross(ours_n[inner], theirs_n[inner], seen_any[inner], n_y, n_y)
        log.info("rows %s of %s", min(r0 + step, n_rows), n_rows)
    for src in seasons.values():
        src.close()

    def rates(c: dict, i) -> dict:
        def n(k):
            return int(c[k][i].sum()) if isinstance(i, slice) else int(c[k][i])

        return {
            "same_year": compare.agreement(n("ours_vv"), n("theirs_year"), n("both_vv_year"), cell_km2),
            "season": compare.agreement(n("ours_vv"), n("theirs_season"), n("both_vv_season"), cell_km2,
                                        n("ours_vv_near_theirs"), n("theirs_near_ours_vv")),
            "season_vv_or_vh": compare.agreement(n("ours_any"), n("theirs_season"), n("both_any_season"), cell_km2),
            "theirs_falls_on_km2": {k[len("theirs_on_"):]: round(n(k) * cell_km2, 1) for k in names
                                    if k.startswith("theirs_on_")},
        }

    result = {"radar_run": cfg["radar_hash"], "their_years": [first, last], "seasons": [s_from, s_to],
              "near_m": halo * abs(transform.a), "cell_m": abs(transform.a),
              "note": "ours = flooded by the VV rule in the season maximum, on land the radar observed; "
                      "season = their year Y or Y+1 against our season Y (October to January)",
              "by_season": {}, "by_season_and_province": {}}
    for y in years:
        result["by_season"][str(y)] = rates(counts[y], slice(1, None))
        result["by_season_and_province"][str(y)] = {code: rates(counts[y], i + 1) for i, code in enumerate(codes)}
    result["years_flooded_km2"] = {
        "rows": f"ours: seasons flooded (VV) {s_from}-{s_to}", "columns": f"theirs: years flagged {s_from}-{s_to}",
        "table": np.round(freq_table * cell_km2, 1).tolist()}
    ours_ever, theirs_ever = int(freq_table[1:, :].sum()), int(freq_table[:, 1:].sum())
    result["ever_flooded"] = compare.agreement(ours_ever, theirs_ever, int(freq_table[1:, 1:].sum()), cell_km2)
    ours_rep, theirs_rep = int(freq_table[2:, :].sum()), int(freq_table[:, 2:].sum())
    result["flooded_twice_or_more"] = compare.agreement(ours_rep, theirs_rep, int(freq_table[2:, 2:].sum()), cell_km2)

    # --- the hazard classes (their own grid): how GISTDA's count of years falls on each class
    hz = hazard_config()
    class_path = PIPELINE_DIR / str(hz["output_dir"]) / "classes" / f"hazard_classes_{cfg['radar_hash']}.tif"
    built_path = PIPELINE_DIR / str(hz["output_dir"]) / "buildings" / "buildings_2023_30m.tif"
    if class_path.exists():
        n_t = last - first + 2
        with rasterio.open(class_path) as cls_src, rasterio.open(built_path) as b_src, \
                WarpedVRT(bits_src, crs=cls_src.crs, transform=cls_src.transform, width=cls_src.width,
                          height=cls_src.height, resampling=Resampling.nearest) as vrt:
            k2 = abs(cls_src.transform.a * cls_src.transform.e) / 1e6
            by_class, by_basis = np.zeros((5, n_t), dtype=np.int64), np.zeros((4, n_t), dtype=np.int64)
            buildings = np.zeros((5, 2), dtype=np.float64)
            for r0 in range(0, cls_src.height, step):
                win = ((r0, min(r0 + step, cls_src.height)), (0, cls_src.width))
                cls, basis = cls_src.read(1, window=win), cls_src.read(2, window=win)
                theirs = compare.count_years(vrt.read(1, window=win), first, first, last)
                count = np.nan_to_num(b_src.read(2, window=win), nan=0.0)
                land = cls > 0
                by_class += compare.cross(cls, theirs, land, 5, n_t)
                by_basis += compare.cross(basis, theirs, land & (cls >= 3), 4, n_t)
                for code in NAMES:
                    m = cls == code
                    buildings[code, 0] += float(count[m].sum())
                    buildings[code, 1] += float(count[m & (theirs > 0)].sum())
            total_flagged = int(by_class[1:, 1:].sum())
            total_repeat = int(by_class[1:, 3:].sum())
            classes = {}
            for code, name in sorted(NAMES.items(), reverse=True):
                row = by_class[code]
                cells = int(row.sum())
                classes[name] = {
                    "km2": round(cells * k2, 1),
                    "gistda_flagged_pct": round(100 * int(row[1:].sum()) / max(cells, 1), 1),
                    "gistda_3_years_or_more_pct": round(100 * int(row[3:].sum()) / max(cells, 1), 1),
                    "share_of_gistda_flagged_pct": round(100 * int(row[1:].sum()) / max(total_flagged, 1), 1),
                    "share_of_gistda_3_years_or_more_pct": round(100 * int(row[3:].sum()) / max(total_repeat, 1), 1),
                    "buildings": int(round(buildings[code, 0])),
                    "buildings_on_gistda_flagged": int(round(buildings[code, 1])),
                }
            result["hazard_classes"] = {
                "note": f"GISTDA flagged = flooded in at least one year {first}-{last}",
                "gistda_flagged_km2": round(total_flagged * k2, 1), "classes": classes,
                "medium_or_high_by_basis": {
                    BASIS_NAMES[k]: {"km2": round(int(by_basis[k].sum()) * k2, 1),
                                     "gistda_flagged_pct": round(100 * int(by_basis[k, 1:].sum()) / max(int(by_basis[k].sum()), 1), 1)}
                    for k in BASIS_NAMES},
                "benchmarks": {}}
            for label, box in hz["classes"].get("benchmarks", {}).items():
                w = from_bounds(*transform_bounds("EPSG:4326", cls_src.crs, *box), cls_src.transform)
                w = w.round_offsets().round_lengths()
                cls, raw = cls_src.read(1, window=w), vrt.read(1, window=w)
                land = cls > 0
                cells = max(int(land.sum()), 1)
                result["hazard_classes"]["benchmarks"][label] = {
                    "land_km2": round(cells * k2, 2),
                    "gistda_flagged_pct_by_year": {
                        str(y): round(100 * int((((raw >> (y - first)) & 1).astype(bool) & land).sum()) / cells, 1)
                        for y in range(first, last + 1)},
                    "gistda_flagged_any_year_pct": round(100 * int(((raw > 0) & land).sum()) / cells, 1)}
    bits_src.close()

    dest = output_dir(cfg) / f"compare_{cfg['radar_hash']}.json"
    dest.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {dest.relative_to(PIPELINE_DIR)}")
    print("season   ours km2  theirs km2  both km2  theirs also ours  ours also theirs  CSI   (near: theirs, ours)")
    for y in years:
        s = result["by_season"][str(y)]["season"]
        print(f"{y}   {s['ours_km2']:>9} {s['theirs_km2']:>11} {s['both_km2']:>9} {s['theirs_also_ours_pct']:>16}% "
              f"{s['ours_also_theirs_pct']:>16}% {s['csi']:>5}   ({s['theirs_near_ours_pct']}%, {s['ours_near_theirs_pct']}%)")


def cmd_minimal(cfg: dict) -> None:
    """Every cell GISTDA flags that the hazard map calls Minimal, described and grouped."""
    import csv

    import rasterio
    import shapely
    from pyproj import Transformer
    from rasterio import features
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import Resampling
    from rasterio.windows import Window, transform as window_transform

    from hazard.__main__ import load_config as hazard_config
    from hazard.classes import BUILT, MINIMAL
    from hazard.tambons import tambon_geometries

    from . import minimal

    first, last = cfg["their_years"]
    hz = hazard_config()
    hz_root = PIPELINE_DIR / str(hz["output_dir"])
    seasons = hz["classes"]["seasons"]
    step, halo = cfg["strip_rows"], 2
    tambons = tambon_geometries()
    found = {k: [] for k in ("row", "col", "bits", "hand", "buildings", "vv", "vh", "seen", "built", "edge", "tambon")}
    with rasterio.open(hz_root / "classes" / f"hazard_classes_{cfg['radar_hash']}.tif") as cls_src:
        grid = dict(crs=cls_src.crs, transform=cls_src.transform, width=cls_src.width, height=cls_src.height,
                    resampling=Resampling.nearest)
        to_grid = Transformer.from_crs("EPSG:4326", cls_src.crs, always_xy=True).transform
        shapes = [(shapely.transform(t["geometry"], lambda x, y: to_grid(x, y), interleaved=False), i + 1)
                  for i, t in enumerate(tambons)]
        k2 = abs(cls_src.transform.a * cls_src.transform.e) / 1e6
        with rasterio.open(bits_file(cfg)) as b, rasterio.open(hz_root / "burned" / "hand.tif") as h, \
                rasterio.open(hz_root / "buildings" / "buildings_2023_30m.tif") as bld, \
                WarpedVRT(b, **grid) as bits_vrt, WarpedVRT(h, **grid) as hand_vrt:
            season_src = [rasterio.open(season_file(cfg, y)) for y in seasons]
            season_vrt = [WarpedVRT(src, **grid) for src in season_src]
            for r0 in range(0, cls_src.height, step):
                a, z = max(r0 - halo, 0), min(r0 + step + halo, cls_src.height)
                inner = slice(r0 - a, r0 - a + min(step, cls_src.height - r0))
                win = ((a, z), (0, cls_src.width))
                cls, basis = cls_src.read(1, window=win), cls_src.read(2, window=win)
                bits = bits_vrt.read(1, window=win)
                wanted = np.zeros(cls.shape, dtype=bool)
                wanted[inner] = ((cls == MINIMAL) & (bits > 0))[inner]
                log.info("rows %s of %s", min(r0 + step, cls_src.height), cls_src.height)
                if not wanted.any():
                    continue
                rr, cc = np.nonzero(wanted)
                vv, vh, seen = (np.zeros(len(rr), dtype=np.uint8) for _ in range(3))
                for vrt in season_vrt:
                    e = vrt.read(1, window=win)[rr, cc]
                    vv += (e == compare.VV) | (e == compare.BOTH)
                    vh += e == compare.VH
                    seen += e <= compare.BOTH
                tam = features.rasterize(shapes, out_shape=cls.shape, fill=0, dtype="uint16",
                                         transform=window_transform(Window(0, a, cls_src.width, z - a), cls_src.transform))
                found["row"].append(rr + a)
                found["col"].append(cc)
                found["bits"].append(bits[rr, cc])
                found["hand"].append(hand_vrt.read(1, window=win, masked=True).astype("float32").filled(np.nan)[rr, cc])
                found["buildings"].append(np.nan_to_num(bld.read(2, window=win), nan=0.0)[rr, cc])
                found["vv"].append(vv)
                found["vh"].append(vh)
                found["seen"].append(seen)
                found["built"].append(basis[rr, cc] == BUILT)
                found["edge"].append(compare.near(cls > MINIMAL, halo)[rr, cc])
                found["tambon"].append(tam[rr, cc])
            for x in season_vrt + season_src:
                x.close()
        c = {k: np.concatenate(v) for k, v in found.items()}
        n = len(c["row"])
        years_all = compare.count_years(c["bits"], first, first, last)
        years_radar = compare.count_years(c["bits"], first, seasons[0], last)
        patch = minimal.patches(c["row"], c["col"], cls_src.width)
        size = np.bincount(patch)
        # what our radar has at the cell, the first that applies
        radar = np.select([c["seen"] == 0, c["vv"] >= 1, c["vh"] >= 1], [0, 1, 2], default=3)
        radar_labels = ["radar cannot see it (terrain mask or no pass)", "radar flagged it in one season (VV)",
                        "radar flagged it in VH only", "radar saw it and never flagged it"]
        when = np.select([years_radar == 0, years_radar == years_all], [0, 2], default=1)
        size_code = np.select([size[patch] * k2 < 0.01, size[patch] * k2 < 0.1], [0, 1], default=2)
        hand_labels = [band[1] for band in minimal.HAND_BANDS] + ["not known"]
        result = {
            "radar_run": cfg["radar_hash"], "cells": n, "km2": round(n * k2, 1), "cell_m": abs(cls_src.transform.a),
            "buildings": int(round(float(c["buildings"].sum()))),
            "years_flagged_by_gistda": minimal.shares(["one year", "two years", "three or more"],
                                                      np.minimum(years_all, 3) - 1, k2, c["buildings"]),
            "when_flagged": minimal.shares([f"only before {seasons[0]} (no radar of ours to compare)", "before and since",
                                            f"only since {seasons[0]}"], when, k2, c["buildings"]),
            "height_above_nearest_stream": minimal.shares(hand_labels, minimal.hand_band(c["hand"]), k2, c["buildings"]),
            "our_radar_there": minimal.shares(radar_labels, radar, k2, c["buildings"]),
            "built_up": minimal.shares(["not built-up", "built-up"], c["built"].astype(np.uint8), k2, c["buildings"]),
            "within_60_m_of_our_low_or_higher": minimal.shares(["no", "yes"], c["edge"].astype(np.uint8), k2, c["buildings"]),
            "patch_size": minimal.shares(["under 1 ha", "1 to 10 ha", "10 ha or more"], size_code, k2, c["buildings"]),
            "patches": int(len(size)),
        }
        # the solid part: not beside our own classes, and in a patch of a hectare or more
        core = ~c["edge"] & (size_code >= 1)
        result["away_from_our_classes_in_patches_of_1_ha_or_more"] = {
            "km2": round(float(core.sum()) * k2, 1), "buildings": int(round(float(c["buildings"][core].sum()))),
            "height_above_nearest_stream": minimal.shares(hand_labels, minimal.hand_band(c["hand"][core]), k2),
            "our_radar_there": minimal.shares(radar_labels, radar[core], k2)}
        to_lonlat = Transformer.from_crs(cls_src.crs, "EPSG:4326", always_xy=True).transform
        big, by_tambon = [], []
        for p in np.argsort(size)[::-1][:300]:
            if size[p] * k2 < 0.01:
                break
            m = patch == p
            x, y = cls_src.transform * (float(c["col"][m].mean()) + 0.5, float(c["row"][m].mean()) + 0.5)
            lon, lat = to_lonlat(x, y)
            t = tambons[int(np.bincount(c["tambon"][m]).argmax()) - 1] if c["tambon"][m].max() > 0 else None
            all_bits = int(np.bitwise_or.reduce(c["bits"][m]))
            big.append({"km2": round(float(size[p]) * k2, 3), "lon": round(lon, 5), "lat": round(lat, 5),
                        "tambon_code": t["code"] if t else None, "tambon": t["name_en"] if t else None,
                        "gistda_years": [first + i for i in range(last - first + 1) if (all_bits >> i) & 1],
                        "median_height_above_stream_m": None if np.isnan(c["hand"][m]).all()
                        else round(float(np.nanmedian(c["hand"][m])), 1),
                        "buildings": int(round(float(c["buildings"][m].sum()))),
                        "beside_our_classes_pct": round(100 * float(c["edge"][m].mean())),
                        "our_radar_flagged_once_pct": round(100 * float((c["vv"][m] >= 1).mean()))})
        result["largest_patches"] = big[:25]
        km2_t = np.bincount(c["tambon"], minlength=len(tambons) + 1) * k2
        bld_t = np.bincount(c["tambon"], weights=c["buildings"], minlength=len(tambons) + 1)
        for i in np.argsort(km2_t[1:])[::-1]:
            if km2_t[i + 1] > 0:
                by_tambon.append({"tambon_code": tambons[i]["code"], "tambon_en": tambons[i]["name_en"],
                                  "tambon_th": tambons[i]["name_th"], "km2": round(float(km2_t[i + 1]), 2),
                                  "buildings": int(round(float(bld_t[i + 1])))})
        result["tambons_with_most"] = by_tambon[:15]
    root = output_dir(cfg)
    (root / f"minimal_{cfg['radar_hash']}.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    with open(root / f"minimal_by_tambon_{cfg['radar_hash']}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(by_tambon[0]))
        w.writeheader()
        w.writerows(by_tambon)
    geo = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
         "properties": {k: (", ".join(map(str, v)) if isinstance(v, list) else v) for k, v in p.items() if k not in ("lon", "lat")}}
        for p in big]}
    (root / f"minimal_patches_{cfg['radar_hash']}.geojson").write_text(json.dumps(geo, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k not in ("largest_patches", "tambons_with_most")}, indent=1))
    for p in result["largest_patches"]:
        print(p)
    for t in result["tambons_with_most"]:
        print(t["tambon_code"], t["tambon_en"], t["km2"], t["buildings"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gistda", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["fetch", "burn", "compare", "minimal"])
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)       # httpx logs whole request lines
    cfg = load_config()
    {"fetch": cmd_fetch, "burn": cmd_burn, "compare": cmd_compare, "minimal": cmd_minimal}[args.command](cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
