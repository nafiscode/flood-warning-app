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

from . import compare, hand, sources

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
