"""Command line: `uv run python -m rivers <command>` from the pipeline folder.

Commands
  fetch   fill the OpenStreetMap water cache in out/rivers/osm/ (quarter-degree tiles touching the
          four provinces). Finished tiles are skipped, so it can be run again after a server gives up.
  build   turn the cache into one river-body PMTiles file in out/rivers/, and print the two r2sync
          commands that publish it.

A context layer only: where water normally sits, never a flood extent and never an all-clear
(safety rule 10). Data (c) OpenStreetMap contributors, ODbL. See METHODS.md.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

import yaml
from shapely.geometry import shape

from ingest_thaiwater.settings import PIPELINE_DIR, env_value
from sar_floods import aoi as aoi_module

from . import build as build_mod
from . import osm
from . import tiles as tiles_mod

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("rivers")


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


def _elements(cfg: dict, cache: Path) -> list[dict]:
    geometry = aoi_module.load()
    return osm.fetch(aoi_module.bounds(geometry), cfg["overpass_url"], cfg["user_agent"], cache,
                     cfg["tile_deg"], area=shape(geometry))


def cmd_fetch(cfg: dict) -> int:
    cache = output_dir(cfg) / "osm"
    elements = _elements(cfg, cache)
    print(f"{len(elements)} OSM water elements cached in {cache}")
    return 0


def cmd_build(cfg: dict) -> int:
    out = output_dir(cfg)
    cache = out / "osm"
    if not cache.is_dir() or not any(cache.glob("water_*.json.gz")):
        raise SystemExit("No OSM water cache: run `uv run python -m rivers fetch` first.")
    elements = _elements(cfg, cache)
    water = build_mod.water_mercator(elements, cfg["line_half_width_m"], cfg["min_part_m2"])
    bounds_deg = aoi_module.bounds(aoi_module.load())
    key_date = date.today().isoformat()
    dest = out / f"river-body_{key_date}.pmtiles"
    meta = {"name": "Jaga river body", "attribution": "(c) OpenStreetMap contributors, ODbL",
            "description": "Where water normally sits (OpenStreetMap). Context only, not a flood extent."}
    stats = tiles_mod.build(water, bounds_deg, dest, min_zoom=cfg["min_zoom"], max_zoom=cfg["max_zoom"],
                            layer=cfg["layer"], metadata=meta, simplify_px=cfg["simplify_px"])
    print(json.dumps(stats, indent=1))
    key = f"hazard/river-body/{key_date}.pmtiles"
    print("\nTo publish (R2 free tier; run from pipeline/):")
    print(f"  uv run python -m r2sync push {dest.relative_to(PIPELINE_DIR)} --bucket public --key {key}")
    print(f"  uv run python -m r2sync manifest river-body {key}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="rivers", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch")
    sub.add_parser("build")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    return cmd_fetch(cfg) if args.command == "fetch" else cmd_build(cfg)


if __name__ == "__main__":
    sys.exit(main())
