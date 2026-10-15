"""Command line: `uv run python -m highway_paths <command>` from the pipeline folder.

Commands
  fetch          the OpenStreetMap extras for the quarter-degree tiles that carry a main highway in
                 the four provinces: the highways' numbers and names, mapped culverts, and waterways
                 drawn passing the roads -> <output_dir>/osm/paths_*.json.gz. Finished tiles are
                 skipped; a tile no server answers is named and left out (run fetch again later).
  run [--figures N]
                 sections, the two sides, the radar seasons and passes, the drainage crossings, the
                 openings, the score and the class -> <output_dir>/sections.geojson, sections_<province>.csv,
                 summary.json, figures/ and highway_paths/report.md.

Needs the road cache of `safe_places fetch`, the hazard module's D8 pointer, accumulation and DEM, and
the radar products of the hash in config.yaml. No Earth Engine, nothing paid. Settings:
highway_paths/config.yaml; method and limits: highway_paths/METHODS.md; docs/science-plan.md
Module 8 part 2. Advice for the highway and irrigation offices, never a public alert.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
import time
from pathlib import Path

import numpy as np
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, env_value

from . import crossings, lines, osm, rasters, score

CONFIG_PATH = Path(__file__).with_name("config.yaml")
REPORT_PATH = Path(__file__).with_name("report.md")
log = logging.getLogger("highway_paths")
PROVINCES = {"90": ("สงขลา", "Songkhla"), "94": ("ปัตตานี", "Pattani"), "95": ("ยะลา", "Yala"), "96": ("นราธิวาส", "Narathiwat")}
DENSE_M = 10.0          # spacing of the densified highway points the nearest-line questions are asked against


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    contact = env_value("CONTACT_EMAIL")
    agent = cfg["user_agent"]
    cfg["user_agent"] = agent.format(contact=contact) if contact else agent.replace("; {contact}", "")
    return cfg


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise ValueError("output_dir must be inside pipeline/.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def road_tiles(cfg: dict) -> list[Path]:
    tiles = sorted((PIPELINE_DIR / cfg["inputs"]["roads"]).glob("roads_*.npz"))
    if not tiles:
        raise SystemExit("No road tiles in the cache: run `safe_places fetch` first.")
    return tiles


def aoi_shape():
    from shapely.geometry import shape

    from sar_floods import aoi as aoi_module

    return shape(aoi_module.load())


# --------------------------------------------------------------------------- fetch

def cmd_fetch(cfg: dict) -> int:
    from shapely.geometry import box

    from safe_places.osm import ROAD_TILE

    area = aoi_shape()
    corners = []
    for path in road_tiles(cfg):
        m = re.match(r"roads_e(\d+\.\d+)n(\d+\.\d+)\.npz", path.name)
        lon, lat = float(m[1]), float(m[2])
        t = np.load(path)
        if np.isin(t["kind"], cfg["highways"]["kinds"]).any() and area.intersects(box(lon, lat, lon + ROAD_TILE, lat + ROAD_TILE)):
            corners.append((lon, lat))
    log.info("%d tiles carry a main highway in the provinces", len(corners))
    got = osm.fetch(corners, cfg["overpass_url"], cfg["user_agent"], output_dir(cfg) / "osm",
                    rounds=int(cfg.get("overpass_rounds", 6)))
    print(json.dumps(got, indent=1))
    return 0


# --------------------------------------------------------------------------- run helpers

def admin_names() -> tuple[list[dict], dict, object]:
    """(tambons, district names by code, STRtree of the tambon outlines)."""
    from shapely import STRtree

    from hazard.tambons import tambon_geometries

    tambons = tambon_geometries()
    districts = {}
    row = re.compile(r"^\s*\('(\d{4})', '\d{2}', '((?:[^']|'')*)', '((?:[^']|'')*)'")
    with open(REPO_DIR / "supabase" / "seed" / "20_districts.sql", encoding="utf-8") as f:
        for line in f:
            m = row.match(line)
            if m:
                districts[m[1]] = (m[2].replace("''", "'"), m[3].replace("''", "'"))
    return tambons, districts, STRtree([t["geometry"] for t in tambons])


def where(lon: float, lat: float, tambons, districts, tree) -> dict | None:
    from shapely.geometry import Point

    p = Point(lon, lat)
    for i in tree.query(p, predicate="intersects"):
        t = tambons[int(i)]
        d = districts.get(t["code"][:4], ("", ""))
        pv = PROVINCES.get(t["code"][:2], ("", ""))
        return {"tambon_code": t["code"], "tambon_th": t["name_th"], "tambon_en": t["name_en"], "district_th": d[0],
                "district_en": d[1], "province_code": t["code"][:2], "province_th": pv[0], "province_en": pv[1]}
    return None


def scene_files(cfg: dict) -> list[Path]:
    from sar_floods import settings as sar_settings

    drive = sar_settings.output_paths(sar_settings.load_config()).drive
    return sorted(drive.glob(f"jaga_sar_scene_*_{cfg['pass_scale_m']}m_{cfg['radar_hash']}.tif"))


def season_files(cfg: dict) -> dict[int, Path]:
    from sar_floods import settings as sar_settings

    paths = sar_settings.output_paths(sar_settings.load_config())
    out = {}
    for year in range(cfg["seasons"][0], cfg["seasons"][1] + 1):
        name = f"jaga_sar_max_season-{year}_{cfg['pass_scale_m']}m_{cfg['radar_hash']}.tif"
        found = next((p / name for p in (paths.products, paths.drive) if (p / name).exists()), None)
        if found is None:
            raise SystemExit(f"{name} is missing: build the season maxima first (sar_floods maximum all-seasons).")
        out[year] = found
    return out


def group_counts(values: np.ndarray, pair_group: np.ndarray, pair_cell: np.ndarray, n_groups: int,
                 flood_codes) -> tuple[np.ndarray, np.ndarray]:
    """(observed, flooded) cell counts per group from extent codes at the unique cells."""
    v = values[pair_cell]
    obs = v <= 3
    fl = np.isin(v, flood_codes)
    return (np.bincount(pair_group[obs], minlength=n_groups).astype("int32"),
            np.bincount(pair_group[fl], minlength=n_groups).astype("int32"))


# --------------------------------------------------------------------------- run

def cmd_run(cfg: dict, n_figures: int | None) -> int:
    import rasterio
    from pyproj import Transformer
    from scipy.spatial import cKDTree

    started = time.time()
    out = output_dir(cfg)
    hw, sd, fc, cc = cfg["highways"], cfg["sides"], cfg["flood"], cfg["crossings"]
    inp = {k: PIPELINE_DIR / v for k, v in cfg["inputs"].items() if k != "roads"}
    with rasterio.open(inp["pointer"]) as src:
        crs = src.crs.to_string()
    to_xy = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    to_lonlat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform

    # ---- the lines
    ways = lines.load_ways(road_tiles(cfg), hw["blocking"])
    wx, wy = to_xy(ways["lon"], ways["lat"])
    main = np.isin(ways["kind"], hw["kinds"])
    main_chains = lines.build_chains(ways, main, wx, wy)
    link_chains = lines.build_chains(ways, ~main, wx, wy)
    log.info("%d main ways joined into %d lines; %d link lines", int(main.sum()), len(main_chains), len(link_chains))

    # Sections, and the densified points of every line with the line and section they belong to.
    sections = []           # dicts: chain, a, b
    dense_xy, dense_t, dense_chain, dense_sec = [], [], [], []
    for ci, ch in enumerate(main_chains + link_chains):
        dist = lines.along(ch.xy)
        if dist[-1] <= 0:
            continue
        pts, tan, at = lines.densify(ch.xy, DENSE_M)
        sec = np.full(len(pts), -1, dtype="int64")
        if ci < len(main_chains):
            cuts = lines.cut_points(dist[-1], hw["section_m"], hw["min_section_m"])
            first = len(sections)
            for a, b in zip(cuts[:-1], cuts[1:]):
                sections.append({"chain": ci, "a": float(a), "b": float(b)})
            sec = first + np.clip(np.searchsorted(cuts, at, side="right") - 1, 0, len(cuts) - 2)
        dense_xy.append(pts)
        dense_t.append(tan)
        dense_chain.append(np.full(len(pts), ci, dtype="int64"))
        dense_sec.append(sec)
    dense_xy, dense_t = np.concatenate(dense_xy), np.concatenate(dense_t)
    dense_chain, dense_sec = np.concatenate(dense_chain), np.concatenate(dense_sec)
    line_tree = cKDTree(dense_xy)
    is_main = dense_sec >= 0
    main_tree = cKDTree(dense_xy[is_main])
    main_xy, main_t, main_sec = dense_xy[is_main], dense_t[is_main], dense_sec[is_main]
    all_chains = main_chains + link_chains

    # Where each section is; only those in the four provinces go on.
    tambons, districts, ttree = admin_names()
    for s in sections:
        ch = main_chains[s["chain"]]
        dist = lines.along(ch.xy)
        s["xy"] = lines.piece(ch.xy, dist, s["a"], s["b"])
        mid = lines.interpolate(ch.xy, dist, np.array([(s["a"] + s["b"]) / 2]))[0]
        t = lines.tangents(ch.xy, dist, np.array([(s["a"] + s["b"]) / 2]))[0]
        chord = s["xy"][-1] - s["xy"][0]
        s["mid"], s["chord_t"] = mid, (chord / np.hypot(*chord) if np.hypot(*chord) > 1 else t)
        lon, lat = to_lonlat(mid[0], mid[1])
        s["where"] = where(float(lon), float(lat), tambons, districts, ttree)
        # Length of each way in the section, and of bridges.
        seg_a, seg_b = dist[:-1], dist[1:]
        overlap = np.clip(np.minimum(seg_b, s["b"]) - np.maximum(seg_a, s["a"]), 0, None)
        by_way: dict[int, float] = {}
        for w, o in zip(ch.way.tolist(), overlap.tolist()):
            if o > 0:
                by_way[w] = by_way.get(w, 0.0) + o
        s["way"] = max(by_way, key=by_way.get) if by_way else int(ch.way[0])
        s["ways"] = sorted(by_way)
        s["bridge_m"] = float(overlap[ch.bridge].sum())
    keep = np.array([s["where"] is not None for s in sections], dtype=bool)
    log.info("%d sections of about %d m, %d of them in the four provinces", len(sections), hw["section_m"], int(keep.sum()))

    # ---- the two sides
    px, pside, ptan, psec = [], [], [], []
    expected = np.zeros(len(sections), dtype="int64")
    for si in np.nonzero(keep)[0]:
        pts, side, tan, off = lines.side_points(sections[si]["xy"], hw["step_m"], sd["near_m"], sd["far_m"])
        expected[si] = len(pts) // 2
        px.append(pts)
        pside.append(side)
        ptan.append(tan)
        psec.append(np.full(len(pts), si, dtype="int64"))
    pxy, pside, ptan, psec = np.concatenate(px), np.concatenate(pside), np.concatenate(ptan), np.concatenate(psec)
    pchain = np.array([sections[i]["chain"] for i in range(len(sections))], dtype="int64")[psec]
    d, nearest_i = line_tree.query(pxy, k=1)
    ok = (dense_chain[nearest_i] == pchain) & (d >= sd["near_m"] - 1.0)
    pxy, pside, ptan, psec, pchain = pxy[ok], pside[ok], ptan[ok], psec[ok], pchain[ok]
    log.info("side points: %d kept of %d (the rest are nearer another highway or the road itself)", int(ok.sum()), len(ok))

    # Flow direction and ground height at every point, then whether its water runs towards the road.
    with rasterio.open(inp["pointer"]) as src:
        row, col, _ = rasters.cells(src.transform, pxy[:, 0], pxy[:, 1], (src.height, src.width))
        codes = rasters.sample(src, 1, row, col, fill=0, dtype="int16")
        cell_m = src.transform.a
    with rasterio.open(inp["dem"]) as src:
        row, col, _ = rasters.cells(src.transform, pxy[:, 0], pxy[:, 1], (src.height, src.width))
        height = rasters.sample(src, 1, row, col, fill=np.nan, dtype="float32").astype("float64")
        if src.nodata is not None:
            height[height == src.nodata] = np.nan
    fe, fn = crossings.flow_vectors(codes)
    has_flow = (fe != 0) | (fn != 0)
    normal = np.column_stack([-ptan[:, 1], ptan[:, 0]])
    sign = np.where(pside == 0, 1.0, -1.0)
    toward = (fe * -sign * normal[:, 0] + fn * -sign * normal[:, 1]) > 0.1
    del codes, fe, fn, row, col

    # Dual carriageways: borrow the twin's outer side for a side that came out (nearly) empty.
    counts = np.bincount(psec * 2 + pside, minlength=2 * len(sections)).reshape(-1, 2)
    by_chain: dict[int, np.ndarray] = {}
    order = np.argsort(pchain, kind="stable")
    bounds = np.searchsorted(pchain[order], np.arange(len(all_chains) + 1))
    for c in range(len(all_chains)):
        by_chain[c] = order[bounds[c]:bounds[c + 1]]
    tw = cfg["twins"]
    extra = []
    for si in np.nonzero(keep)[0]:
        s = sections[si]
        s["twin"] = None
        for side in (0, 1):
            if counts[si, side] >= 0.3 * expected[si]:
                continue
            near = main_tree.query_ball_point(s["mid"], tw["max_gap_m"])
            near = [j for j in near if main_sec[j] >= 0 and sections[main_sec[j]]["chain"] != s["chain"]
                    and abs(float(main_t[j] @ s["chord_t"])) >= tw["min_parallel"]]
            if not near:
                continue
            j = min(near, key=lambda j: float(np.hypot(*(main_xy[j] - s["mid"]))))
            twin_chain = sections[main_sec[j]]["chain"]
            pool = by_chain.get(twin_chain, np.zeros(0, dtype="int64"))
            half = (s["b"] - s["a"]) / 2
            got = lines.borrow(pxy[pool], np.zeros(len(pool), dtype="int64"), 0, s["mid"], s["chord_t"], half, side,
                               sd["near_m"], sd["far_m"] + tw["max_gap_m"])
            if len(got):
                extra.append((pool[got], si, side))
                s["twin"] = int(main_sec[j])
    if extra:
        idx = np.concatenate([e[0] for e in extra])
        new_sec = np.concatenate([np.full(len(e[0]), e[1], dtype="int64") for e in extra])
        new_side = np.concatenate([np.full(len(e[0]), e[2], dtype="int8") for e in extra])
        pxy, psec, pside = np.concatenate([pxy, pxy[idx]]), np.concatenate([psec, new_sec]), np.concatenate([pside, new_side])
        toward, has_flow = np.concatenate([toward, toward[idx]]), np.concatenate([has_flow, has_flow[idx]])
        height = np.concatenate([height, height[idx]])
    twins = sum(1 for si in np.nonzero(keep)[0] if sections[si]["twin"] is not None)
    log.info("dual carriageways: %d sections borrowed a side from their twin line", twins)

    groups = psec * 2 + pside
    n_groups = 2 * len(sections)
    n_flow = np.bincount(groups[has_flow], minlength=n_groups)
    d8_toward = np.where(n_flow > 0, np.bincount(groups[has_flow & toward], minlength=n_groups) / np.maximum(n_flow, 1), np.nan)
    finite = np.isfinite(height)
    n_h = np.bincount(groups[finite], minlength=n_groups)
    dem_mean = np.where(n_h > 0, np.bincount(groups[finite], weights=height[finite], minlength=n_groups) / np.maximum(n_h, 1), np.nan)

    # The 20 m radar cells of each side, each once per side.
    seasons = season_files(cfg)
    with rasterio.open(next(iter(seasons.values()))) as src:
        r_transform, r_shape = src.transform, (src.height, src.width)
    row, col, inside = rasters.cells(r_transform, pxy[:, 0], pxy[:, 1], r_shape)
    key = groups[inside].astype("int64") * (r_shape[0] * r_shape[1]) + row[inside] * r_shape[1] + col[inside]
    key = np.unique(key)
    pair_group = key // (r_shape[0] * r_shape[1])
    flat = key % (r_shape[0] * r_shape[1])
    cells_u, pair_cell = np.unique(flat, return_inverse=True)
    cell_row, cell_col = cells_u // r_shape[1], cells_u % r_shape[1]
    del key, flat, row, col, inside
    log.info("radar: %d side cells (%d distinct) on the %d m grid", len(pair_group), len(cells_u), int(r_transform.a))

    # ---- seasons
    codes_fl = cfg["flood_codes"]
    s_obs = np.zeros((len(seasons), n_groups), dtype="int32")
    s_fl = np.zeros_like(s_obs)
    for k, (year, path) in enumerate(seasons.items()):
        with rasterio.open(path) as src:
            if src.transform != r_transform:
                raise SystemExit(f"{path.name} is not on the 20 m master grid.")
            v = rasters.sample(src, 1, cell_row, cell_col, fill=255, dtype="uint8")
        s_obs[k], s_fl[k] = group_counts(v, pair_group, pair_cell, n_groups, codes_fl)
        log.info("season %d read", year)

    # ---- passes
    scenes = scene_files(cfg)
    if not scenes:
        raise SystemExit("No per-pass radar files found (sar_floods download).")
    p_obs = np.zeros((len(scenes), n_groups), dtype="int32")
    p_fl = np.zeros_like(p_obs)
    t0 = time.time()
    for k, path in enumerate(scenes):
        with rasterio.open(path) as src:
            # A pass file covers only its own footprint, cut from the same 20 m lattice.
            off = rasters.lattice_offset(r_transform, src.transform)
            if off is None:
                log.warning("%s is not on the master grid's lattice: skipped", path.name)
                continue
            v = rasters.sample(src, 1, cell_row - off[0], cell_col - off[1], fill=255, dtype="uint8")
        p_obs[k], p_fl[k] = group_counts(v, pair_group, pair_cell, n_groups, codes_fl)
        if (k + 1) % 50 == 0:
            log.info("passes: %d of %d read (%.0f s)", k + 1, len(scenes), time.time() - t0)

    # ---- drainage crossings
    min_cells = cc["min_catchment_km2"] * 1e6 / cell_m ** 2
    cx_all, cy_all, csec_all, ckm2_all, cside_all, down_all = [], [], [], [], [], []
    with rasterio.open(inp["accumulation"]) as acc_src, rasterio.open(inp["pointer"]) as ptr_src:
        from rasterio.windows import Window

        t = acc_src.transform
        for r0 in range(0, acc_src.height, 256):
            h = min(256, acc_src.height - r0)
            acc = acc_src.read(1, window=Window(0, r0, acc_src.width, h))
            rr, cc_ = np.nonzero((acc >= min_cells) & (acc != acc_src.nodata))
            if len(rr) == 0:
                continue
            ptr = ptr_src.read(1, window=Window(0, r0, ptr_src.width, h))[rr, cc_]
            dc, dr, valid = crossings.steps(ptr)
            rr, cc_, dc, dr, a = rr[valid], cc_[valid], dc[valid], dr[valid], acc[rr[valid], cc_[valid]]
            x0 = t.c + (cc_ + 0.5) * t.a
            y0 = t.f + (rr + r0 + 0.5) * t.e
            x1, y1 = x0 + dc * t.a, y0 + dr * t.e
            idx, xx, yy, li, side = crossings.find(x0, y0, x1, y1, main_tree, main_xy, main_t, cc["near_line_m"])
            if len(idx):
                cx_all.append(xx)
                cy_all.append(yy)
                csec_all.append(main_sec[li])
                ckm2_all.append(a[idx] * cell_m ** 2 / 1e6)
                cside_all.append(side)
                down_all.append(np.column_stack([rr[idx] + r0 + dr[idx], cc_[idx] + dc[idx]]))
        # A stream running along the road zigzags across it on a 30 m model; such a "crossing" comes
        # back to the side it left within a few hundred metres and is not a stream passing under it.
        along = []
        k_steps = int(cc["along_check_steps"])
        main_chain = dense_chain[is_main]
        sec_chain = np.array([s["chain"] for s in sections], dtype="int64")
        for (r_, c_), sec_, side_ in zip(np.concatenate(down_all) if down_all else np.zeros((0, 2), "int64"),
                                         np.concatenate(csec_all) if csec_all else [], np.concatenate(cside_all) if cside_all else []):
            r0_, c0_ = max(int(r_) - k_steps, 0), max(int(c_) - k_steps, 0)
            win = ptr_src.read(1, window=Window(c0_, r0_, 2 * k_steps + 1, 2 * k_steps + 1))
            path = [(int(r_) - r0_, int(c_) - c0_)] + crossings.trace(win, int(r_) - r0_, int(c_) - c0_, k_steps)
            pxy_ = np.array([[t.c + (c0_ + pc + 0.5) * t.a, t.f + (r0_ + pr + 0.5) * t.e] for pr, pc in path])
            along.append(crossings.recrosses(pxy_, main_tree, main_xy, main_t, main_chain, int(sec_chain[sec_]),
                                             int(side_), cc["near_line_m"]))
    along = np.array(along, dtype=bool)
    if cx_all:
        cx, cy = np.concatenate(cx_all)[~along], np.concatenate(cy_all)[~along]
        csec, ckm2 = np.concatenate(csec_all)[~along], np.concatenate(ckm2_all)[~along]
        cside = np.concatenate(cside_all)[~along]
        k_ = crossings.cluster(csec, cx, cy, ckm2, 3 * cell_m)
        cx, cy, csec, ckm2, cside = cx[k_], cy[k_], csec[k_], ckm2[k_], cside[k_]
    else:
        cx = cy = ckm2 = np.zeros(0)
        csec = cside = np.zeros(0, dtype="int64")
    n_along = int(along.sum())
    log.info("drainage crossings: %d (from %.1f km2 of land upstream); %d flow steps left out as streams running "
             "along the road", len(cx), cc["min_catchment_km2"], n_along)

    # ---- openings
    tags = osm.load(output_dir(cfg) / "osm")
    open_xy, open_kind = [], []
    for ch in all_chains:
        dist = lines.along(ch.xy)
        runs = np.flatnonzero(np.diff(np.concatenate([[0], ch.bridge.astype("int8"), [0]])))
        for a, b in zip(runs[::2], runs[1::2]):
            m = (dist[a] + dist[b]) / 2
            open_xy.append(lines.interpolate(ch.xy, dist, np.array([m]))[0])
            open_kind.append("bridge")
    n_bridges = len(open_xy)
    for c in tags["culverts"]:
        lon = np.array([p[0] for p in c["points"]])
        lat = np.array([p[1] for p in c["points"]])
        x, y = to_xy(lon, lat)
        open_xy.append(np.array([np.mean(x), np.mean(y)]))
        open_kind.append("culvert")
    water_lines = []
    for w in tags["waterways"]:
        x, y = to_xy(np.array([p[0] for p in w["points"]]), np.array([p[1] for p in w["points"]]))
        water_lines.append(np.column_stack([x, y]))
    wx_ = crossings.waterway_crossings(water_lines, [c.xy for c in main_chains])
    for p in wx_:
        open_xy.append(p)
        open_kind.append("waterway")
    open_xy = np.array(open_xy) if open_xy else np.zeros((0, 2))
    open_kind = np.array(open_kind)
    near_road = np.zeros(len(open_xy), dtype=bool)
    open_sec = np.full(len(open_xy), -1, dtype="int64")
    if len(open_xy):
        d_o, i_o = main_tree.query(open_xy, k=1)
        near_road = d_o <= cc["opening_m"]
        open_sec = np.where(near_road, main_sec[i_o], -1)
        open_tree = cKDTree(open_xy[near_road])
        open_kind_near = open_kind[near_road]
    log.info("openings near the main highways: %d bridges, %d culverts, %d mapped waterway crossings",
             int((open_kind[near_road] == "bridge").sum()), int((open_kind[near_road] == "culvert").sum()),
             int((open_kind[near_road] == "waterway").sum()))
    crossing_open_m = np.full(len(cx), np.nan)
    crossing_open_kind = np.array([""] * len(cx), dtype="U8")
    if len(cx) and near_road.any():
        d_c, i_c = open_tree.query(np.column_stack([cx, cy]), k=1)
        hit = d_c <= cc["report_opening_within_m"]       # the nearest one is named even beyond opening_m
        crossing_open_m[hit] = d_c[hit]
        crossing_open_kind[hit] = open_kind_near[i_c[hit]]

    # ---- figures per section
    rows = []
    tag_of = {h["id"]: h["tags"] for h in tags["highways"]}
    passes_seen_any = (p_obs >= fc["pass_min_cells"])
    for si in np.nonzero(keep)[0]:
        s = sections[si]
        g0, g1 = 2 * si, 2 * si + 1
        mine = np.nonzero(csec == si)[0]
        big = mine[np.argmax(ckm2[mine])] if len(mine) else None
        up = score.upstream((d8_toward[g0], d8_toward[g1]), (dem_mean[g0], dem_mean[g1]),
                            int(cside[big]) if big is not None else None, sd["d8_margin"], sd["dem_margin_m"])
        sh = [score.share(s_fl[:, g], s_obs[:, g], sd["min_cells"]) for g in (g0, g1)]
        side_up = up["side"]
        if side_up is None:              # unclear: compare the wetter side with the other, at half weight
            means = [np.nanmean(x) if np.isfinite(x).any() else -1 for x in sh]
            side_up = 0 if means[0] >= means[1] else 1
        gu, gd = (g0, g1) if side_up == 0 else (g1, g0)
        su, sdn = (sh[0], sh[1]) if side_up == 0 else (sh[1], sh[0])
        season = score.seasons(su, sdn, s_fl[:, gu], s_fl[:, gd], fc["wetter_by"], fc["min_flooded_cells"])
        both = passes_seen_any[:, gu] & passes_seen_any[:, gd]
        pass_up = both & (p_fl[:, gu] >= fc["pass_share"] * p_obs[:, gu])
        pass_down = both & (p_fl[:, gd] >= fc["pass_share"] * p_obs[:, gd])
        if both.any():
            fu = p_fl[both, gu].sum() / max(p_obs[both, gu].sum(), 1)
            fd = p_fl[both, gd].sum() / max(p_obs[both, gd].sum(), 1)
            persistence = float(fu - fd)
        else:
            fu = fd = persistence = None
        fig = {"upstream": up["side"], "upstream_agree": up["agree"], "asymmetry": season["asymmetry"],
               "seasons_seen": season["seen"], "seasons_up": season["up_wetter"], "seasons_down": season["down_wetter"],
               "persistence": persistence, "passes_seen": int(both.sum()), "passes_up": int(pass_up.sum()),
               "passes_down": int(pass_down.sum()),
               "crossing_km2": round(float(ckm2[big]), 2) if big is not None else None,
               "crossing_opening_m": (None if big is None or not np.isfinite(crossing_open_m[big])
                                      else round(float(crossing_open_m[big]))),
               "crossing_opening": (crossing_open_kind[big] or None) if big is not None else None}
        total, parts = score.total(fig, cfg)
        cls = score.classify(total, fig, cfg)
        lon, lat = to_lonlat(s["xy"][:, 0], s["xy"][:, 1])
        # The number and name of the longest way in the section, else of any of its ways that has one.
        tag = dict(tag_of.get(int(ways["way_id"][s["way"]]), {}))
        for w in s["ways"]:
            other = tag_of.get(int(ways["way_id"][w]), {})
            for k in ("ref", "name", "name:en"):
                if not tag.get(k) and other.get(k):
                    tag[k] = other[k]
        mine_open = open_kind[open_sec == si]
        rows.append({
            "id": f"S{si:05d}", "index": int(si), "chain": int(s["chain"]), "lon": [round(float(v), 6) for v in lon], "lat": [round(float(v), 6) for v in lat],
            "mid_lon": round(float(np.mean(lon)), 6), "mid_lat": round(float(np.mean(lat)), 6),
            "highway": str(ways["kind"][s["way"]]), "ref": tag.get("ref"), "name": tag.get("name") or tag.get("name:th"),
            "name_en": tag.get("name:en"), "osm_way": int(ways["way_id"][s["way"]]),
            "length_m": round(s["b"] - s["a"]), "bridge_m": round(s["bridge_m"]), **s["where"],
            "upstream_side": score.SIDE_WORDS.get(up["side"]) if up["side"] is not None else None,
            "upstream_by": up["by"], "upstream_d8": score.SIDE_WORDS.get(up["d8_side"]) if up["d8_side"] is not None else None,
            "upstream_dem": score.SIDE_WORDS.get(up["dem_side"]) if up["dem_side"] is not None else None,
            "d8_dem_agree": up["agree"],
            "d8_toward_left": _r(d8_toward[g0], 3), "d8_toward_right": _r(d8_toward[g1], 3),
            "dem_left_m": _r(dem_mean[g0], 2), "dem_right_m": _r(dem_mean[g1], 2),
            "cells_left": int(np.median(s_obs[:, g0])), "cells_right": int(np.median(s_obs[:, g1])),
            "share_up_by_season": [_r(v, 3) for v in su], "share_down_by_season": [_r(v, 3) for v in sdn],
            "asymmetry": _r(fig["asymmetry"], 3), "seasons_seen": fig["seasons_seen"], "seasons_up_wetter": fig["seasons_up"],
            "seasons_down_wetter": fig["seasons_down"],
            "pass_flood_share_up": _r(fu, 4), "pass_flood_share_down": _r(fd, 4), "persistence": _r(persistence, 4),
            "passes_seen": fig["passes_seen"], "passes_flooded_up": fig["passes_up"], "passes_flooded_down": fig["passes_down"],
            "crossings": int(len(mine)), "crossing_km2": fig["crossing_km2"],
            "crossing_from": score.SIDE_WORDS.get(int(cside[big])) if big is not None else None,
            "crossing_lon": round(float(to_lonlat(cx[big], cy[big])[0]), 6) if big is not None else None,
            "crossing_lat": round(float(to_lonlat(cx[big], cy[big])[1]), 6) if big is not None else None,
            "crossing_opening": fig["crossing_opening"], "crossing_opening_m": fig["crossing_opening_m"],
            "bridges": int((mine_open == "bridge").sum()), "culverts": int((mine_open == "culvert").sum()),
            "waterway_crossings": int((mine_open == "waterway").sum()),
            "twin_section": f"S{s['twin']:05d}" if s.get("twin") is not None else None,
            "score": total, "score_parts": parts, "class": cls, "reasons": score.reasons(fig, cfg),
        })

    # ---- outputs
    summary = summarise(rows, cfg, sections_all=len(sections), ways=int(main.sum()), crossings=len(cx), n_bridges=n_bridges,
                        open_kind=open_kind, near_road=near_road, tags=tags, passes=len(scenes), twins=twins)
    summary["flow_steps_left_out_along_road"] = n_along
    found = stretches(rows)
    summary["stretches"] = {k: sum(1 for x in found if x["class"] == k) for k in (score.LOOK_FIRST, score.WORTH)}
    write_geojson(out / "sections.geojson", rows)
    write_crossings(out / "crossings.geojson", cx, cy, csec, ckm2, cside, crossing_open_m, crossing_open_kind, keep, to_lonlat)
    for code, (_, name) in PROVINCES.items():
        write_csv(out / f"sections_{name.lower()}.csv", [r for r in rows if r["province_code"] == code])
    figures = []
    n_fig = cfg["report"]["figures"] if n_figures is None else n_figures
    if n_fig:
        from . import figures as figs

        from sar_floods import settings as sar_settings

        freq_path = sar_settings.output_paths(sar_settings.load_config()).products / \
            f"jaga_sar_frequency_2017-2025_{cfg['pass_scale_m']}m_{cfg['radar_hash']}.tif"
        ol = []
        for (x_, y_), k_ in zip(open_xy[near_road], open_kind[near_road]):
            lo, la = to_lonlat(x_, y_)
            ol.append((float(lo), float(la), str(k_)))
        top = [x["best"] for x in ranked_stretches(found)][:n_fig]
        figures = figs.draw(top, out / "figures", freq_path, ol, cfg, to_xy)
    summary["minutes"] = round((time.time() - started) / 60, 1)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    REPORT_PATH.write_text(report(rows, found, summary, cfg, figures), encoding="utf-8", newline="\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


def _r(v, nd: int):
    if v is None:
        return None
    v = float(v)
    return round(v, nd) if np.isfinite(v) else None


def ranked(rows: list[dict]) -> list[dict]:
    """Scored sections best first, a dual carriageway's twin dropped when its partner is already listed."""
    order = sorted((r for r in rows if r["score"] is not None), key=lambda r: (-r["score"], r["id"]))
    listed, out = set(), []
    for r in order:
        if r["twin_section"] in listed or r["id"] in {x["twin_section"] for x in out}:
            continue
        listed.add(r["id"])
        out.append(r)
    return out


def stretches(rows: list[dict]) -> list[dict]:
    """Neighbouring flagged sections of one line joined into stretches: a stretch of road that holds
    water back is usually longer than one section, and one place to look is easier to act on than
    three neighbours in a list. Sets row["stretch"] (None for unflagged sections) and returns the
    stretches, each with its best section."""
    flagged = (score.LOOK_FIRST, score.WORTH)
    by_chain: dict[int, list[dict]] = {}
    for r in rows:
        r["stretch"] = None
        by_chain.setdefault(r["chain"], []).append(r)
    out: list[dict] = []

    def flush(run: list[dict]) -> None:
        if not run:
            return
        best = max(run, key=lambda r: (r["score"], r["id"]))
        sid = "R" + run[0]["id"][1:]
        for r in run:
            r["stretch"] = sid
        out.append({"id": sid, "sections": [r["id"] for r in run], "best": best, "score": best["score"],
                    "class": score.LOOK_FIRST if any(r["class"] == score.LOOK_FIRST for r in run) else score.WORTH,
                    "km": round(sum(r["length_m"] for r in run) / 1000, 1), "province_code": best["province_code"],
                    "twins": {r["twin_section"] for r in run if r["twin_section"]}})

    for chain_rows in by_chain.values():
        chain_rows.sort(key=lambda r: r["index"])
        run: list[dict] = []
        for r in chain_rows:
            if r["class"] in flagged and run and r["index"] == run[-1]["index"] + 1:
                run.append(r)
            else:
                flush(run)
                run = [r] if r["class"] in flagged else []
        flush(run)
    return out


def ranked_stretches(found: list[dict]) -> list[dict]:
    """Stretches best first (look-first stretches before worth-a-look ones), the other carriageway of
    a stretch already listed left out."""
    order = sorted(found, key=lambda x: (x["class"] != score.LOOK_FIRST, -x["score"], x["id"]))
    listed: set[str] = set()
    listed_twins: set[str] = set()
    out = []
    for x in order:
        if x["twins"] & listed or set(x["sections"]) & listed_twins:
            continue
        listed.update(x["sections"])
        listed_twins.update(x["twins"])
        out.append(x)
    return out


def summarise(rows, cfg, sections_all, ways, crossings, n_bridges, open_kind, near_road, tags, passes, twins) -> dict:
    by_class: dict[str, int] = {}
    by_province: dict[str, dict] = {}
    for r in rows:
        by_class[r["class"]] = by_class.get(r["class"], 0) + 1
        p = by_province.setdefault(r["province_en"], {"sections": 0, "km": 0.0})
        p["sections"] += 1
        p["km"] += r["length_m"] / 1000
        p[r["class"]] = p.get(r["class"], 0) + 1
    for p in by_province.values():
        p["km"] = round(p["km"], 1)
    return {"radar_run": cfg["radar_hash"], "main_highway_ways": ways, "sections_all": sections_all,
            "sections_in_provinces": len(rows), "km_in_provinces": round(sum(r["length_m"] for r in rows) / 1000, 1),
            "twin_sections": twins, "passes": passes, "by_class": dict(sorted(by_class.items())),
            "by_province": dict(sorted(by_province.items())),
            "drainage_crossings": crossings,
            "drainage_crossings_in_provinces": sum(r["crossings"] for r in rows),
            "sections_with_crossing": sum(1 for r in rows if r["crossings"]),
            "crossings_without_mapped_opening": sum(1 for r in rows if r["crossing_km2"] and not score.has_opening(r["crossing_opening_m"], cfg)),
            "openings_near_main_highways": {k: int((open_kind[near_road] == k).sum()) for k in ("bridge", "culvert", "waterway")},
            "osm_extras": {k: len(v) for k, v in tags.items()},
            "bridge_runs_on_highway_lines": n_bridges,
            "sections_with_ref": sum(1 for r in rows if r["ref"])}


def write_geojson(path: Path, rows: list[dict]) -> None:
    feats = []
    for r in rows:
        props = {k: v for k, v in r.items() if k not in ("lon", "lat")}
        props["reasons"] = "; ".join(r["reasons"])
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString", "coordinates": [[a, b] for a, b in zip(r["lon"], r["lat"])]}})
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")


def write_crossings(path, cx, cy, csec, ckm2, cside, open_m, open_kind, keep, to_lonlat) -> None:
    feats = []
    for i in range(len(cx)):
        if not keep[csec[i]]:
            continue
        lon, lat = to_lonlat(cx[i], cy[i])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(lon), 6), round(float(lat), 6)]},
                      "properties": {"section": f"S{int(csec[i]):05d}", "catchment_km2": round(float(ckm2[i]), 2),
                                     "from_side": score.SIDE_WORDS[int(cside[i])],
                                     "nearest_opening": open_kind[i] or None,
                                     "nearest_opening_m": None if not np.isfinite(open_m[i]) else round(float(open_m[i]))}})
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")


CSV_COLUMNS = ("rank", "id", "stretch", "class", "score", "highway", "ref", "name", "province_en", "district_en", "district_th",
               "tambon_en", "tambon_th", "tambon_code", "mid_lat", "mid_lon", "length_m", "bridge_m", "upstream_side",
               "upstream_by", "d8_dem_agree", "asymmetry", "seasons_seen", "seasons_up_wetter", "seasons_down_wetter",
               "pass_flood_share_up", "pass_flood_share_down", "passes_seen", "passes_flooded_up", "passes_flooded_down",
               "crossing_km2", "crossing_from", "crossing_opening", "crossing_opening_m", "crossing_lat", "crossing_lon",
               "bridges", "culverts", "waterway_crossings", "twin_section", "reasons", "map_link")


def write_csv(path: Path, rows: list[dict]) -> None:
    order = ranked(rows)
    rank = {r["id"]: n for n, r in enumerate(order, start=1)}
    rest = sorted((r for r in rows if r["id"] not in rank), key=lambda r: (r["score"] is None, -(r["score"] or 0), r["id"]))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for r in order + rest:
            vals = {**r, "rank": rank.get(r["id"], ""), "reasons": "; ".join(r["reasons"]),
                    "map_link": f"https://www.google.com/maps/search/?api=1&query={r['mid_lat']:.6f},{r['mid_lon']:.6f}"}
            w.writerow(["" if vals.get(k) is None else vals[k] for k in CSV_COLUMNS])


def report(rows: list[dict], found: list[dict], summary: dict, cfg: dict, figures: list[str]) -> str:
    """highway_paths/report.md: the top stretches per province, each told by its best section."""
    n = cfg["report"]["top_per_province"]
    order = ranked_stretches(found)
    head = ["| Province | km of main road | sections | look here first | worth a look | not seen | stretches flagged |",
            "|---|---:|---:|---:|---:|---:|---:|"]
    for code, (th, en) in PROVINCES.items():
        p = summary["by_province"].get(en, {})
        head.append(f"| {en} | {p.get('km', 0)} | {p.get('sections', 0)} | {p.get(score.LOOK_FIRST, 0)} | "
                    f"{p.get(score.WORTH, 0)} | {p.get(score.NOT_SEEN, 0)} | "
                    f"{sum(1 for x in order if x['province_code'] == code)} |")
    out = ["# Highway paths: where a main highway may be holding flood water back",
           "",
           "Generated by `python -m highway_paths run`. Advice for the provincial highway and irrigation offices,",
           "**never a public alert**. A place on this list is where to look, to be confirmed on the ground:",
           "the radar sees water extent, not depth; 20 m cells beside a road are noisy; culverts are mostly not",
           "mapped in OpenStreetMap, so \"no mapped opening\" usually means \"not mapped\". Method and limits:",
           "`highway_paths/METHODS.md`. Radar run " + cfg["radar_hash"] + ".",
           "",
           f"{summary['sections_in_provinces']} sections ({summary['km_in_provinces']} km of motorway, trunk and primary road) "
           f"in the four provinces. Classes: " + ", ".join(f"{score.CLASS_WORDS[k]} {v}" for k, v in summary["by_class"].items()) + ".",
           f"{summary['drainage_crossings_in_provinces']} drainage crossings of at least {cfg['crossings']['min_catchment_km2']} km2; "
           f"{summary['crossings_without_mapped_opening']} sections have their largest crossing with no mapped opening within "
           f"{cfg['crossings']['opening_m']} m.",
           "",
           "Neighbouring flagged sections of one road are joined into a **stretch** (id R..., named after its",
           "first section); each stretch is told by its best section. Left and right are as seen travelling",
           "in the direction the road is drawn in OpenStreetMap; the figures name the upstream side instead.",
           "",
           *head,
           ""]
    for code, (th, en) in PROVINCES.items():
        mine = [x for x in order if x["province_code"] == code]
        out += [f"## {en} ({th})", ""]
        if not mine:
            out += ["No stretch flagged.", ""]
            continue
        for k, x in enumerate(mine[:n], start=1):
            r = x["best"]
            road = " ".join(v for v in (r["highway"], f"road {r['ref']}" if r["ref"] else None) if v)
            name = f", {r['name']}" if r["name"] else ""
            more = (f"{x['km']} km in {len(x['sections'])} sections ({x['sections'][0]} to {x['sections'][-1]})"
                    if len(x["sections"]) > 1 else f"one section, {x['km']} km")
            out.append(f"{k}. **{x['id']}**, {score.CLASS_WORDS[x['class']]}: {road}{name}, {r['tambon_en']} "
                       f"({r['tambon_th']}), {r['district_en']}; {more}. Best section {r['id']}, score {r['score']:.2f}. "
                       f"[map](https://www.google.com/maps/search/?api=1&query={r['mid_lat']:.6f},{r['mid_lon']:.6f})")
            for reason in r["reasons"]:
                out.append(f"   - {reason}")
        rest = len(mine) - n
        if rest > 0:
            out.append(f"\n{rest} more flagged stretches in `out/highway_paths/sections_{en.lower()}.csv` (column `stretch`).")
        out.append("")
    if figures:
        out += ["## Figures", ""] + [f"- `{f}`" for f in figures] + [""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="highway_paths", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch")
    sub.add_parser("run").add_argument("--figures", type=int, default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    return cmd_fetch(cfg) if args.command == "fetch" else cmd_run(cfg, args.figures)


if __name__ == "__main__":
    sys.exit(main())
