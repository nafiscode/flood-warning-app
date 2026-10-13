"""Command line: `uv run python -m thresholds <command>` from the pipeline folder.

Commands
  basins       the land that drains to each zone's gauges, from the hazard module's flow
               directions. Writes <output_dir>/basins.geojson.
  rain         hourly basin-mean rainfall for every season (GSMaP on Earth Engine; needs
               EE_PROJECT). Writes <output_dir>/rain/<season>.parquet; skips seasons already there.
  glofas       daily modelled discharge at each zone's key gauge (Open-Meteo flood API, free, no
               key). Writes <output_dir>/glofas/<zone>.json.
  hindcast     floods from the gauges, the signals before each, candidate thresholds scored over
               every season, and the provisional proposal. Writes <output_dir>/hindcast.json,
               and report.md and thresholds.yaml there and beside this code.

  seed         the warning zones, the gauges of the four provinces and the provisional thresholds
               as supabase/seed/46_zones_gauges_thresholds.sql, for the app (A8). Needs `hindcast`.

Settings: thresholds/config.yaml. See docs/science-plan.md Module 3 and METHODS.md.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, data_dir, env_value

from . import basins, report, seed, sources

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("thresholds")


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


def cmd_basins(cfg: dict) -> int:
    import numpy as np
    import rasterio
    from pyproj import Transformer

    out = output_dir(cfg)
    with rasterio.open(PIPELINE_DIR / cfg["pointer"]) as src:
        pointer = src.read(1)
        transform, crs = src.transform, src.crs.to_string()
    with rasterio.open(PIPELINE_DIR / cfg["accumulation"]) as src:
        accum = src.read(1)
    to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    cell_km2 = abs(transform.a * transform.e) / 1e6
    feats = []
    for zone, z in cfg["zones"].items():
        masks: dict[str, np.ndarray] = {}
        for b in z["basins"]:
            x, y = to_grid(*b["outlet"])
            col, row = ~transform * (x, y)
            r, c = basins.snap(accum, int(row), int(col), int(b.get("snap_cells", cfg["snap_cells"])))
            masks[b["name"]] = basins.upstream(pointer, r, c)
        for b in z["basins"]:
            mask = masks[b["name"]] & ~masks[b["minus"]] if b.get("minus") else masks[b["name"]]
            area = float(mask.sum()) * cell_km2
            feats.append({"type": "Feature", "geometry": basins.outline(mask, transform, crs),
                          "properties": {"zone": zone, "basin": b["name"], "id": f"{zone}.{b['name']}",
                                         "area_km2": round(area, 1), "outlet": b["outlet"]}})
            print(f"{zone:14} {b['name']:12} {area:8.0f} km2")
    (out / "basins.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return 0


def read_basins(out: Path) -> dict:
    path = out / "basins.geojson"
    if not path.exists():
        raise SystemExit("Run `basins` first.")
    return {f["properties"]["id"]: f for f in json.loads(path.read_text(encoding="utf-8"))["features"]}


def seasons(cfg: dict) -> list[int]:
    return list(range(int(cfg["seasons"]["first"]), int(cfg["seasons"]["last"]) + 1))


def cmd_rain(cfg: dict, only: list[int] | None) -> int:
    project = env_value("EE_PROJECT")
    if not project:
        raise SystemExit("EE_PROJECT is not set in .env.local.")
    out = output_dir(cfg)
    sources.fetch_rain(read_basins(out), cfg, only or seasons(cfg), out, project)
    return 0


def cmd_glofas(cfg: dict) -> int:
    out = output_dir(cfg)
    points = {zone: tuple(z["key"]["point"]) for zone, z in cfg["zones"].items()}
    s = cfg["seasons"]
    where = sources.fetch_glofas(points, cfg, f"{s['first']}-01-01", f"{s['last'] + 1}-02-28", out, cfg["user_agent"])
    for zone, w in where.items():
        series = sources.read_glofas(out, zone)
        print(f"{zone:14} asked {w['asked']}, cell {w['cell']}: {len(series)} days, max {series.max():.0f} m3/s on {series.idxmax().date()}")
    return 0


def cmd_hindcast(cfg: dict) -> int:
    out = output_dir(cfg)
    result = report.build(cfg, out, data_dir())
    (out / "hindcast.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    # The report and the thresholds are also kept beside the code, so they are read and reviewed
    # with it; the app's loader (A8) takes thresholds.yaml from here.
    for folder in (out, CONFIG_PATH.parent):
        (folder / "report.md").write_text(report.markdown(result, cfg), encoding="utf-8", newline="\n")
        (folder / "thresholds.yaml").write_text(report.thresholds_yaml(result, cfg), encoding="utf-8", newline="\n")
    print(report.summary(result))
    return 0


def cmd_seed(cfg: dict) -> int:
    import pandas as pd

    out = output_dir(cfg)
    result = json.loads((out / "hindcast.json").read_text(encoding="utf-8"))
    stations = pd.read_csv(data_dir() / "stations.csv")
    text, counts = seed.sql(cfg, result, read_basins(out), stations)
    dest = REPO_DIR / "supabase" / "seed" / "46_zones_gauges_thresholds.sql"
    seed.write(dest, text)
    print(f"wrote {dest} ({dest.stat().st_size // 1024} kB): {counts}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="thresholds", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("basins")
    sub.add_parser("rain").add_argument("--season", type=int, action="append")
    sub.add_parser("glofas")
    sub.add_parser("hindcast")
    sub.add_parser("seed")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "basins":
        return cmd_basins(cfg)
    if args.command == "rain":
        return cmd_rain(cfg, args.season)
    if args.command == "glofas":
        return cmd_glofas(cfg)
    if args.command == "seed":
        return cmd_seed(cfg)
    return cmd_hindcast(cfg)


if __name__ == "__main__":
    sys.exit(main())
