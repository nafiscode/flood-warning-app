"""Command line: `uv run python -m hazard <command>` from the pipeline folder.

Commands
  sources-export [--dry-run]   start the two Earth Engine exports to Drive: FABDEM and JRC water
                               occurrence for the working box (a few EECU-minutes; needs EE_PROJECT)
  sources-download [--dry-run] fetch them into <output_dir>/sources/
  hand [--force]               DEM on the working grid, depressions breached, flow direction and
                               accumulation, then streams and HAND for every candidate threshold, into
                               <output_dir>/work/ (local, WhiteboxTools; finished steps are skipped)
  hand-burned [--force]        the decided HAND (decision 2026-10-08): rivers burned in for the routing,
                               one stream threshold, coastal rule; into <output_dir>/burned/
  buildings-fetch              building presence and counts on the hazard grid, from Earth Engine
                               (interactive requests, no export task) -> <output_dir>/buildings/
  classes [--hold-out YEAR] [--radar-hash HASH]
                               the hazard classes from HAND, the radar seasons and events, and buildings
                               -> <output_dir>/classes/. --hold-out leaves a year's season and event out
                               and scores the classes against that event.
  streams-compare              score every candidate stream network against OpenStreetMap waterways
                               (fetched once from Overpass, cached in <output_dir>/osm/) and JRC water;
                               writes <output_dir>/streams_compare.json

Settings: hazard/config.yaml. Outputs are local (ignored by git); products go to R2 with r2sync.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, env_value
from sar_floods import aoi as aoi_module
from sar_floods import ee_ops, settings as sar_settings

from . import buildings, classes, compare, hand, sources

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    w, s, e, n = cfg["bbox_deg"]
    if not (all(isinstance(v, int) for v in (w, s, e, n)) and w < e and s < n):
        raise sar_settings.ConfigError("bbox_deg must be whole degrees [west, south, east, north].")
    return cfg


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise sar_settings.ConfigError("output_dir must be relative to pipeline/ and inside it.")
    return root


def run_hand(cfg: dict, force: bool) -> None:
    root = output_dir(cfg)
    work = root / "work"
    source = root / "sources" / f"{sources.names(cfg)['dem']}.tif"
    if not source.exists():
        raise sar_settings.ConfigError(f"{source.name} is missing: run sources-export, then sources-download.")
    h, ex = cfg["hand"], cfg["export"]
    log_path = work / "hand_run.json"
    record = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {"steps": {}}

    def timed(name: str, fn):
        t = time.time()
        out = fn()
        if name in record["steps"] and time.time() - t < 1:      # nothing to do: keep the earlier timing
            return
        record["steps"][name] = {"seconds": round(time.time() - t, 1)}
        if isinstance(out, dict):
            record["steps"][name].update(out)
        log_path.write_text(json.dumps(record, indent=1), encoding="utf-8")
        print(f"{name}: {time.time() - t:.0f} s")

    if force or not (work / "dem_utm.tif").exists():
        timed("working grid", lambda: hand.to_working_grid(source, work / "dem_utm.tif", ex["crs"], ex["scale_m"],
                                                           h["sea_value_m"], h.get("bbox_deg")))
    timed("breach, flow direction, accumulation",
          lambda: hand.condition(work, h["breach_dist_cells"], h["breach_max_cost"], force))
    for n in h["stream_thresholds_cells"]:
        timed(f"streams and HAND, {n} cells", lambda: hand.hand_for_threshold(work, n, force) and None)
    if h.get("bbox_deg"):
        timed("window edge check", lambda: hand.edge_check(work, h["bbox_deg"], aoi_module.load()))
        cut = record["steps"]["window edge check"]["path_cells_in_area"]
        print("window edge check: no catchment of the provinces is cut by the window" if cut == 0 else
              f"WARNING: flow from the window edge crosses {cut} cells of the provinces; widen hand.bbox_deg")


def _user_agent(cfg: dict) -> str:
    contact = env_value("CONTACT_EMAIL")
    agent = cfg["compare"]["user_agent"]
    return agent.format(contact=contact) if contact else agent.replace("; {contact}", "")


def run_hand_burned(cfg: dict, force: bool) -> None:
    import numpy as np
    import rasterio

    root = output_dir(cfg)
    work = root / "burned"
    h, c = cfg["hand"], cfg["compare"]
    surface = root / "work" / "dem_utm.tif"
    if not surface.exists():
        raise sar_settings.ConfigError("out/hazard/work/dem_utm.tif is missing: run `hazard hand` first.")
    n = h["stream_threshold_cells"]
    if force or not (work / "dem_utm.tif").exists():
        ways = compare.fetch_waterways(h.get("bbox_deg") or cfg["bbox_deg"], c["waterway_classes"], c["overpass_url"],
                                       _user_agent(cfg), root / "osm")
        rivers = [w["geometry"] for w in ways if w["class"] in h["burn"]["waterway_classes"]]
        cells = hand.burn_rivers(surface, work / "dem_utm.tif", rivers, h["burn"]["depth_m"])
        print(f"burned {len(rivers)} mapped rivers into {cells} cells, {h['burn']['depth_m']} m deep")
    hand.condition(work, h["breach_dist_cells"], h["breach_max_cost"], force)
    wbt = hand._wbt(work)
    streams_path = work / f"streams_{n}.tif"
    if force or not streams_path.exists():
        hand._run(f"streams, {n} cells", wbt.extract_streams("d8_accum.tif", streams_path.name, threshold=n,
                                                             zero_background=False), streams_path)
    with rasterio.open(surface) as src:
        z, profile = src.read(1), src.profile
    with rasterio.open(work / "d8_pointer.tif") as src:
        pointer = src.read(1)
    with rasterio.open(streams_path) as src:
        s = src.read(1)
        streams = (s > 0) & (s != src.nodata) if src.nodata is not None else s > 0
    del s
    result = hand.hand_from_flow(pointer, streams, z, hand.window_sea(surface, h.get("bbox_deg") or cfg["bbox_deg"]))
    with rasterio.open(work / "hand.tif", "w", **profile) as dst:
        dst.write(result, 1)
    land = z != hand.NODATA
    known = result != hand.NODATA
    print(f"hand.tif: {int(streams.sum())} stream cells; HAND for {known.sum() / land.sum():.1%} of the land cells")


def hazard_grid(cfg: dict):
    """(transform, (rows, cols), crs, window) of the hazard grid: the HAND grid cut to the four provinces."""
    import rasterio
    from rasterio.windows import Window

    from sar_floods import grid as sar_grid

    with rasterio.open(output_dir(cfg) / "burned" / "hand.tif") as src:
        west, south, east, north = sar_grid.project_bounds(aoi_module.bounds(aoi_module.load()), src.crs.to_string())
        t, s = src.transform, src.transform.a
        c0, r0 = max(0, int((west - t.c) // s)), max(0, int((t.f - north) // s))
        c1, r1 = min(src.width, int(-(-(east - t.c) // s))), min(src.height, int(-(-(t.f - south) // s)))
        window = Window(c0, r0, c1 - c0, r1 - r0)
        return src.window_transform(window), (r1 - r0, c1 - c0), src.crs.to_string(), window


def run_buildings(cfg: dict) -> None:
    transform, shape, crs, _ = hazard_grid(cfg)
    ee_ops.init(sar_settings.ee_project())
    dest = output_dir(cfg) / "buildings" / f"buildings_{cfg['buildings']['year']}_{cfg['export']['scale_m']}m.tif"
    print(dest.name, buildings.fetch(cfg, transform, shape, crs, dest))


def run_classes(cfg: dict, hold_out: int | None, radar_hash: str | None) -> None:
    import numpy as np
    import rasterio
    from rasterio import features
    from rasterio.warp import Resampling, transform_bounds, transform_geom
    from rasterio.windows import from_bounds

    root = output_dir(cfg)
    c = cfg["classes"]
    h = radar_hash or c["radar_hash"]
    sar = sar_settings.output_paths(sar_settings.load_config())
    transform, shape, crs, window = hazard_grid(cfg)
    cell_km2 = transform.a ** 2 / 1e6
    with rasterio.open(root / "burned" / "hand.tif") as src:
        hand_m = src.read(1, window=window)
        hand_m = np.where(hand_m == src.nodata, np.nan, hand_m)
    with rasterio.open(root / "work" / "dem_utm.tif") as src:
        has_dem = src.read(1, window=window) != src.nodata
    land = features.rasterize([transform_geom("EPSG:4326", crs, aoi_module.load())], out_shape=shape,
                              transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool) & has_dem

    def radar_file(kind_name: str, scale: int) -> Path:
        name = f"jaga_sar_max_{kind_name}_{scale}m_{h}.tif"
        for folder in (sar.products, sar.drive):
            if (folder / name).exists():
                return folder / name
        raise sar_settings.ConfigError(f"{name} is missing: finish the radar run {h} (download, maximum).")

    grid_args = (transform, shape, crs)
    flooded = lambda a: np.isin(a, (1, 3)).astype("uint8")           # noqa: E731  the VV rule
    valid = lambda a: (a <= 3).astype("uint8")                       # noqa: E731
    count = lambda a: np.where(a > 249, 0, a).astype("float32")      # noqa: E731
    seasons_used = [y for y in c["seasons"] if y != hold_out]
    seasons_flooded = np.zeros(shape, dtype="uint8")
    observed = np.zeros(shape, dtype=bool)
    n_flooded, n_valid = np.zeros(shape, dtype="float32"), np.zeros(shape, dtype="float32")
    for y in seasons_used:
        f = radar_file(f"season-{y}", c["season_scale_m"])
        seasons_flooded += classes.on_grid(f, 1, *grid_args, Resampling.max, flooded)
        observed |= classes.on_grid(f, 1, *grid_args, Resampling.max, valid).astype(bool)
        n_valid += classes.on_grid(f, 2, *grid_args, Resampling.max, count, dtype="float32")
        n_flooded += classes.on_grid(f, 3, *grid_args, Resampling.max, count, dtype="float32")
    frequency = np.divide(n_flooded, n_valid, out=np.zeros(shape, dtype="float32"), where=n_valid > 0)
    events_used = [e for e in c["events"] if hold_out is None or not e.startswith(str(hold_out))]
    events_flooded = np.zeros(shape, dtype="uint8")
    for e in events_used:
        f = radar_file(f"event-{e}", c["event_scale_m"])
        events_flooded += classes.on_grid(f, 1, *grid_args, Resampling.max, flooded)
        observed |= classes.on_grid(f, 1, *grid_args, Resampling.max, valid).astype(bool)
    with rasterio.open(root / "buildings" / f"buildings_{cfg['buildings']['year']}_{cfg['export']['scale_m']}m.tif") as src:
        presence, building_count = src.read(1), src.read(2)
    blind = c["radar_blind"]
    built = classes.box_mean(presence, blind["built_window_cells"]) >= blind["built_min_presence"]
    cls, basis = classes.classify(hand_m, land, seasons_flooded, frequency, events_flooded, observed, built, c,
                                  len(events_used))
    tag = f"{h}" + (f"_without{hold_out}" if hold_out else "")
    dest = root / "classes" / f"hazard_classes_{tag}.tif"
    dest.parent.mkdir(parents=True, exist_ok=True)
    profile = dict(driver="GTiff", dtype="uint8", count=2, width=shape[1], height=shape[0], crs=crs, transform=transform,
                   nodata=0, compress="deflate", tiled=True, blockxsize=512, blockysize=512)
    with rasterio.open(dest, "w", **profile) as dst:
        dst.write(cls, 1)
        dst.write(basis, 2)
        dst.set_band_description(1, "hazard_class")
        dst.set_band_description(2, "basis")
        dst.update_tags(classes="1 minimal, 2 low, 3 medium, 4 high", radar_run=h,
                        basis="1 radar and elevation, 2 elevation only: built-up, 3 elevation only: not seen by radar",
                        licence="CC BY-NC-SA 4.0 (derived from FABDEM)")
    stats = {"radar_run": h, "hold_out": hold_out, "seasons": seasons_used, "events": events_used,
             **classes.areas(cls, basis, cell_km2, building_count)}
    stats["built_up_km2"] = round(float((built & land).sum()) * cell_km2, 1)
    stats["benchmarks"] = {}
    for label, box in c.get("benchmarks", {}).items():
        w = from_bounds(*transform_bounds("EPSG:4326", crs, *box), transform).round_offsets().round_lengths()
        sl = (slice(int(w.row_off), int(w.row_off + w.height)), slice(int(w.col_off), int(w.col_off + w.width)))
        stats["benchmarks"][label] = classes.areas(cls[sl], basis[sl], cell_km2)["classes"]
    if hold_out:
        f = radar_file(f"event-{hold_out}-nov-dec", c["event_scale_m"])
        flood = classes.on_grid(f, 1, *grid_args, Resampling.max, flooded).astype(bool)
        seen = classes.on_grid(f, 1, *grid_args, Resampling.max, valid).astype(bool)
        stats["held_out_event"] = classes.score(cls, flood, seen)
    (dest.with_suffix(".json")).write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(stats, indent=1, ensure_ascii=False))


def run_compare(cfg: dict) -> None:
    root = output_dir(cfg)
    c, h = cfg["compare"], cfg["hand"]
    contact = env_value("CONTACT_EMAIL")
    agent = c["user_agent"].format(contact=contact) if contact else c["user_agent"].replace("; {contact}", "")
    ways = compare.fetch_waterways(h.get("bbox_deg") or cfg["bbox_deg"], c["waterway_classes"], c["overpass_url"],
                                   agent, root / "osm")
    result = compare.compare(root / "work", h["stream_thresholds_cells"], ways,
                             root / "sources" / f"{sources.names(cfg)['water']}.tif", c["jrc_min_occurrence_pct"],
                             c["tolerance_cells"], aoi_module.load())
    (root / "streams_compare.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    for n, entry in result["thresholds"].items():
        a = entry["area"]
        found = ", ".join(f"{k} {v['share']:.0%}" for k, v in a["found"].items() if v["share"] is not None)
        print(f"{int(n):5d} cells: {a['stream_cells']:8d} stream cells in the provinces; found: {found}; "
              f"explained {a['explained']:.0%}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="hazard", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    for name in ("sources-export", "sources-download"):
        sub.add_parser(name).add_argument("--dry-run", action="store_true")
    sub.add_parser("hand").add_argument("--force", action="store_true")
    sub.add_parser("hand-burned").add_argument("--force", action="store_true")
    sub.add_parser("streams-compare")
    sub.add_parser("buildings-fetch")
    p = sub.add_parser("classes")
    p.add_argument("--hold-out", type=int, default=None)
    p.add_argument("--radar-hash", default=None)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        cfg = load_config()
        if args.command == "hand":
            run_hand(cfg, args.force)
            return 0
        if args.command == "hand-burned":
            run_hand_burned(cfg, args.force)
            return 0
        if args.command == "buildings-fetch":
            run_buildings(cfg)
            return 0
        if args.command == "classes":
            run_classes(cfg, args.hold_out, args.radar_hash)
            return 0
        if args.command == "streams-compare":
            run_compare(cfg)
            return 0
        project = sar_settings.ee_project()
        if args.command == "sources-export":
            ee_ops.init(project)
            for task in sources.export_tasks(cfg):
                if args.dry_run:
                    print(f"would start {task.config['description']}")
                else:
                    task.start()
                    print(f"started {task.config['description']} (task {task.id})")
        elif args.command == "sources-download":
            for line in sources.download(cfg, project, output_dir(cfg) / "sources", args.dry_run):
                print(line)
    except sar_settings.ConfigError as e:
        print(f"hazard: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
