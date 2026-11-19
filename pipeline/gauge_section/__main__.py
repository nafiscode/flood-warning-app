"""Command line: `uv run python -m gauge_section <command>` from the pipeline folder.

Commands
  run          measure every gauge's channel and write the seed and the report
  one <CODE>   print one station's channel, measured the same way (nothing is written)

The channel at each river gauge: how deep it is, how wide, and how high each of its two banks
stands. It exists so the app's cross-section drawing (components/map/GaugeSection.tsx) can stop
being a schematic and show the shape of the real channel.

Nothing here is modelled and nothing is a level: the heights are ThaiWater's own station record
and the width is measured across OpenStreetMap's digitised water. A missing figure stays missing -
the app then draws its own channel and says the shape is a drawing (safety rules 8 and 10).
See METHODS.md.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import pandas as pd
from shapely.geometry import Point

from ingest_thaiwater.settings import PIPELINE_DIR, data_dir
from rivers.__main__ import load_config as rivers_config
from rivers.__main__ import output_dir as rivers_output

from . import seed as seed_mod
from . import width as width_mod

log = logging.getLogger("gauge_section")

PROVINCES = [90, 94, 95, 96, "90", "94", "95", "96"]
OUT = PIPELINE_DIR / "out" / "gauge_section"

# A channel deeper than this at a river gauge is almost certainly not the channel: the station's
# "ground level" is then a valley floor or a bridge deck somewhere else. Kept, but marked, and the
# app draws a break in the bed rather than a 30 m wall.
DEEP_M = 20.0
# Below this, the figure is not a channel either (a kerb, or two numbers that are the same datum).
SHALLOW_M = 0.3


def stations() -> pd.DataFrame:
    s = pd.read_csv(data_dir() / "stations.csv")
    use = s[(s["wl_reporting"] == True) & (s["in_bbox"] == True)  # noqa: E712
            & s["lat"].notna() & s["province_code"].isin(PROVINCES)].copy()
    return use


def _num(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    f = float(value)
    # ThaiWater writes an unknown height as 0, which at a station on the coast would be a real
    # level: a nought in this record always means "not given", because every bank is above its bed.
    return None if f == 0 else f


def channel(row, water: width_mod.Water | None, to_merc) -> dict:
    """One station's channel: the two banks and the bed from ThaiWater, the width from OSM."""
    left, right = _num(row.left_bank_m), _num(row.right_bank_m)
    bed = _num(row.ground_level_m)
    bank = min([b for b in (left, right) if b is not None], default=None)
    depth = None if bed is None or bank is None else round(bank - bed, 3)
    note = []
    if depth is not None and depth <= SHALLOW_M:
        note.append("bed not below the bank")
        bed, depth = None, None
    elif depth is not None and depth > DEEP_M:
        note.append("deep")
    if left is not None and right is not None and abs(left - right) > DEEP_M:
        note.append("banks disagree")
        left = right = bank
    out = {
        "thaiwater_id": int(row.station_id),
        "code": None if pd.isna(row.old_code) else str(row.old_code),
        "name": None if pd.isna(row.name_th) else str(row.name_th),
        "lat": float(row.lat), "lon": float(row.lon),
        "left_bank_m": left, "right_bank_m": right, "bed_m": bed, "depth_m": depth,
        "width_m": None, "width": None, "notes": note,
    }
    if water is not None:
        measured = width_mod.measure(water, Point(to_merc(float(row.lon), float(row.lat))), float(row.lat))
        if measured:
            out["width_m"] = measured["width_m"]
            out["width"] = measured
    return out


def rows(with_width: bool = True) -> list[dict]:
    use = stations()
    water, to_merc = None, None
    if with_width:
        from pyproj import Transformer

        cfg = rivers_config()
        cache = rivers_output(cfg) / "osm"
        if not cache.is_dir() or not any(cache.glob("water_*.json.gz")):
            raise SystemExit("No OSM water cache: run `uv run python -m rivers fetch` first.")
        from rivers import osm as rivers_osm
        from sar_floods import aoi as aoi_module
        from shapely.geometry import shape

        geometry = aoi_module.load()
        elements = rivers_osm.fetch(aoi_module.bounds(geometry), cfg["overpass_url"], cfg["user_agent"],
                                    cache, cfg["tile_deg"], area=shape(geometry))
        water = width_mod.prepare(elements, cfg["line_half_width_m"])
        to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
    out = [channel(r, water, to_merc) for r in use.itertuples()]
    return sorted(out, key=lambda r: r["code"] or "")


def report(found: list[dict]) -> str:
    have_depth = [r for r in found if r["bed_m"] is not None]
    have_width = [r for r in found if r["width_m"] is not None]
    lines = [
        "# The channel at each river gauge",
        "",
        "Generated by `uv run python -m gauge_section run`. See METHODS.md.",
        "",
        f"- Gauges: **{len(found)}**",
        f"- With a bed level (so a real depth): **{len(have_depth)}**",
        f"- With a measured width: **{len(have_width)}**",
        "",
        "The heights are ThaiWater's own station record (left bank, right bank, ground level).",
        "The width is measured across OpenStreetMap's digitised water, and is the width of the",
        "water surface its mappers drew, not the bank-to-bank width and not a survey.",
        "",
        "| Code | Name | Left bank | Right bank | Bed | Depth | Width | Notes |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    def m(v):
        return "—" if v is None else f"{v:.2f}"
    for r in found:
        lines.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            r["code"] or "", (r["name"] or "")[:26], m(r["left_bank_m"]), m(r["right_bank_m"]),
            m(r["bed_m"]), m(r["depth_m"]),
            "—" if r["width_m"] is None else f"{r['width_m']:.0f} m", ", ".join(r["notes"]) or ""))
    return "\n".join(lines) + "\n"


def cmd_run(args) -> int:
    found = rows(with_width=not args.no_width)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "channels.json").write_text(json.dumps(found, indent=1, ensure_ascii=False), encoding="utf-8")
    (Path(__file__).with_name("report.md")).write_text(report(found), encoding="utf-8")
    seed = PIPELINE_DIR.parent / "supabase" / "seed" / "62_gauge_channel.sql"
    seed.write_text(seed_mod.sql(found), encoding="utf-8")
    # The same rows the seed keeps: anything with a figure of any kind on it.
    kept = [r for r in found if any(r[k] is not None
                                    for k in ("bed_m", "width_m", "left_bank_m", "right_bank_m"))]
    print(f"{len(found)} gauges, {len([r for r in found if r['bed_m'] is not None])} with a bed level, "
          f"{len([r for r in found if r['width_m'] is not None])} with a measured width")
    print(f"seed: {seed} ({len(kept)} rows)")
    print(f"report: {Path(__file__).with_name('report.md')}")
    return 0


def cmd_one(args) -> int:
    found = [r for r in rows() if (r["code"] or "").upper() == args.code.upper()]
    if not found:
        raise SystemExit(f"No gauge with code {args.code}")
    print(json.dumps(found[0], indent=1, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gauge_section", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--no-width", action="store_true", help="heights only; do not read the OSM cache")
    one = sub.add_parser("one")
    one.add_argument("code")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return cmd_run(args) if args.command == "run" else cmd_one(args)


if __name__ == "__main__":
    sys.exit(main())
