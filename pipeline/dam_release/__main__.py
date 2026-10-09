"""Command line: `uv run python -m dam_release <command>` from the pipeline folder.

Commands
  geometry [--dry-run]   the release path from OpenStreetMap: the reservoir outline, the channel
                         leaving the dam, the river down to the sea and the lower reaches of the
                         streams that join it. Writes GeoJSON into <output_dir>/geojson/ for the
                         owner's look in ArcGIS Pro and supabase/seed/40_dams.sql for the app.
                         --dry-run reports what it found and writes nothing.
  thresholds             what the archive says about each grade criterion in config.yaml: how
                         often it would have fired, and the record's own ceilings. Writes
                         <output_dir>/thresholds.json.

Settings: dam_release/config.yaml. See docs/science-plan.md Module 7 and METHODS.md.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, data_dir, env_value

from . import build, thresholds

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("dam_release")


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


def cmd_geometry(cfg: dict, dry_run: bool) -> int:
    out = output_dir(cfg)
    built_all = [build.build(dam, cfg, out, PIPELINE_DIR) for dam in cfg["dams"]]
    for built in built_all:
        dam = built["dam"]
        print(f"\n{dam['name']['en']} ({dam['code']})")
        print(f"  reservoir          {built['reservoir_km2']:.1f} km2")
        print(f"  outlet channel     {built['outlet']['length_km']:.2f} km "
              f"(OSM way {built['outlet']['osm_way']})")
        print(f"  river to the sea   {built['main']['length_km']:.1f} km "
              f"in {len(built['main']['osm_ways'])} mapped ways, mouth at "
              f"{built['main']['mouth'][0]:.4f}, {built['main']['mouth'][1]:.4f}")
        print(f"  tributaries        {len(built['tributaries'])} with "
              f"{dam['tributaries']['min_network_km']} km of network or more, "
              f"lower {dam['tributaries']['lower_reach_km']} km of each")
        for trib in built["tributaries"]:
            print(f"    joins at km {trib['junction_km_from_dam']:6.1f}  "
                  f"network {trib['network_km']:6.1f} km  reach {trib['reach_km']:4.1f} km  "
                  f"{trib['waterway']}  {trib['osm_name'] or ''}")
    summary = {
        b["dam"]["code"]: {
            "reservoir_km2": b["reservoir_km2"],
            "outlet_km": b["outlet"]["length_km"],
            "reach_km": b["main"]["length_km"],
            "mouth": list(b["main"]["mouth"]),
            "tributaries": [{k: v for k, v in t.items() if k != "pts"} for t in b["tributaries"]],
        } for b in built_all
    }
    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    for built in built_all:
        build.write_geojson(built, out / "geojson")
    build.write_seed(built_all, cfg["grades"], REPO_DIR / "supabase" / "seed" / "40_dams.sql")
    (out / "geometry.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    print(f"\nGeoJSON in {out / 'geojson'}  (open the *_all.geojson in ArcGIS Pro, "
          "or one file per layer)")
    print(f"seed      {REPO_DIR / 'supabase' / 'seed' / '40_dams.sql'}")
    return 0


def cmd_thresholds(cfg: dict) -> int:
    out = output_dir(cfg)
    tidy = data_dir() / "tidy"
    results = {}
    for dam in cfg["dams"]:
        data = thresholds.frame(tidy, dam["thaiwater"]["hourly_id"])
        found = thresholds.evidence(data, cfg["grades"], dam["storage"])
        results[dam["code"]] = found
        print(f"\n{dam['name']['en']}: {found['hours_in_archive']} hourly readings, "
              f"{found['first'][:10]} to {found['last'][:10]}")
        print(f"  spill            {found['spill']['hours']} hours "
              f"({found['spill']['share_of_hours'] * 100:.2f}% of the record)")
        for year, row in found["spill"]["by_year"].items():
            print(f"    {year}  {row['hours']:5d} h  peak {row['peak_cms']:7.1f} m3/s")
        flow = found["outflow_cms"]
        print(f"  outflow          median {flow['median']} m3/s, max {flow['max']}, "
              f"max without spill {flow['max_without_spill']} "
              f"(99th without spill {flow['p99_without_spill']})")
        print(f"    above the turbine ceiling of {cfg['grades']['turbine_max_cms']} m3/s: "
              f"{flow['hours_above_turbine_max']} hours "
              f"({flow['share_above_turbine_max'] * 100:.2f}%)")
        store = found["storage_mcm"]
        print(f"  storage          max {store['max']} Mm3, above normal high "
              f"({store['normal_high']}) for {store['hours_above_normal_high']} hours; "
              f"now {store['percent_full_now']}% full")
        rise = found["rise_mcm_per_h"]
        print(f"  rise over {rise['window_h']} h   max {rise['max']} Mm3/h, 99th {rise['p99']}, "
              f"above the rule {rise['hours_above_rule']} hours")
        inflow = found["inflow_cms"]
        print(f"  inflow           max {inflow['max']} m3/s, 99th {inflow['p99']}, "
              f"above the rule {inflow['hours_above_rule']} hours")
        tiers = found["tiers"]
        print(f"  would have fired (confirmed over {tiers['confirmed_over_h']} readings)")
        print(f"    watchful   {tiers['watchful_hours']} hours in "
              f"{tiers['watchful_spells']} spells (unconfirmed: {tiers['watchful_hours_raw']} h)")
        print(f"    releasing  {tiers['releasing_hours']} hours in "
              f"{tiers['releasing_spells']} spells (unconfirmed: {tiers['releasing_hours_raw']} h)")
        print(f"    single readings held back for confirmation: "
              f"{tiers['single_readings_held_back']}")
    (out / "thresholds.json").write_text(json.dumps(results, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    print(f"\nwrote {out / 'thresholds.json'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dam_release", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    geometry = sub.add_parser("geometry", help="the release path from OpenStreetMap")
    geometry.add_argument("--dry-run", action="store_true")
    sub.add_parser("thresholds", help="what the archive says about the grade criteria")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "geometry":
        return cmd_geometry(cfg, args.dry_run)
    return cmd_thresholds(cfg)


if __name__ == "__main__":
    sys.exit(main())
