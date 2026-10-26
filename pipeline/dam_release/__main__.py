"""Command line: `uv run python -m dam_release <command>` from the pipeline folder.

Commands
  geometry [--dry-run]   the release path from OpenStreetMap: the reservoir outline, the channel
                         leaving the dam, the river down to the sea and the lower reaches of the
                         streams that join it. Writes GeoJSON into <output_dir>/geojson/ for the
                         owner's look in ArcGIS Pro and supabase/seed/40_dams.sql for the app.
                         --dry-run reports what it found and writes nothing.
  travel [--dry-run]     how long released water takes to each gauge (measured from the archive:
                         the turbines' daily pulses and the floods since 2020), and the arrival
                         range for every tambon on the path from the decided times in
                         config.yaml. Writes <output_dir>/travel.json, arrival_by_tambon.csv and
                         supabase/seed/41_dam_arrivals.sql. Needs `geometry` to have run.
  thresholds             what the archive says about each grade criterion in config.yaml: how
                         often it would have fired, and the record's own ceilings. Writes
                         <output_dir>/thresholds.json.

  zone                   the land a rise in the river can reach below the dam: height above the
                         river from the elevation model, joined to the channel, checked against
                         the radar's flood maps. Writes <output_dir>/zone.json, zone_by_tambon.csv,
                         <dam>_zone.tif and geojson/<dam>_zone.geojson. Needs `geometry`, the
                         hazard module's elevation model and the radar products on disk.

  spill [--seed]         the overflow zone of each reservoir with no gauge below it: the flow path
                         the elevation model itself gives, cut where the water joins a channel ten
                         times its size, and the level that holds one day of spill from a full
                         reservoir. Writes <output_dir>/spill/<code>.json and _by_tambon.csv,
                         geojson/<code>_spill.geojson and, with --seed,
                         supabase/seed/43_dam_spill_zone.sql. Needs the hazard module's elevation
                         model and flow directions, and the daily rain archive.

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

from . import build, find, osm, spill, thresholds, travel, zone

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
        print(f"  reservoir          {built['reservoir_km2']:.1f} km2"
              + ("" if built["reservoir"] is not None else "  (not mapped in OSM)"))
        if built["outlet"] is None:
            # A reservoir whose outflow nobody has mapped: figures only, and the app says so.
            print("  release path       none mapped in OpenStreetMap - figures only")
            continue
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
            "outlet_km": b["outlet"]["length_km"] if b["outlet"] else None,
            "reach_km": b["main"]["length_km"] if b["main"] else None,
            "mouth": list(b["main"]["mouth"]) if b["main"] else None,
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


def cmd_find(cfg: dict, lon: float, lat: float) -> int:
    """Which mapped channel leaves a reservoir (find.py). Prints candidates for config.yaml."""
    ways = osm.load_waterways((PIPELINE_DIR / str(cfg["waterway_cache"])).resolve())
    rows = find.candidates(ways, (lon, lat))
    if not rows:
        print("no mapped channel starts within "
              f"{find.SEARCH_KM} km of {lat}, {lon} and runs {find.MIN_CHAIN_KM} km or more.")
        print("Either OSM has not mapped the outflow, or the point is wrong.")
        return 1
    print(f"channels leaving {lat}, {lon} (best first; outlet_way for config.yaml):")
    for row in rows:
        print(f"  way {row['way']:>12}  {row['class']:<7} {row['chain_km']:>6.1f} km "
              f"in {row['chain_ways']:>3} ways  starts {row['starts_km_from_dam']:.2f} km away, "
              f"heads {row['heads']:<2}  ends {row['ends_at']}  {row['name']}")
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


def cmd_travel(cfg: dict, dry_run: bool) -> int:
    from hazard.tambons import tambon_geometries

    out = output_dir(cfg)
    tidy = data_dir() / "tidy"
    t = cfg["travel"]
    tambons = tambon_geometries()
    names = {x["code"]: (x["name_th"], x["name_en"]) for x in tambons}
    result = {}
    for dam in cfg["dams"]:
        code = dam["code"]
        reach = json.loads((out / "geojson" / f"{code}_reach.geojson").read_text(encoding="utf-8"))
        main_pts = next(f["geometry"]["coordinates"] for f in reach["features"] if f["properties"]["kind"] == "main")
        tribs = json.loads((out / "geojson" / f"{code}_tributaries.geojson").read_text(encoding="utf-8"))["features"]
        junctions = json.loads((out / "geometry.json").read_text(encoding="utf-8"))[code]["tributaries"]

        gauges = {g["code"]: g for g in t["gauges"]}
        for g in gauges.values():
            g["km"], g["off_line_m"] = travel.river_km(main_pts, tuple(g["point"]))
            if g["off_line_m"] > 200:
                raise ValueError(f"gauge {g['code']} is {g['off_line_m']:.0f} m off the river line.")
        levels = {c: travel.read_hourly(tidy, "water_level_msl", g["id"]) for c, g in gauges.items()}
        outflow = thresholds.frame(tidy, dam["thaiwater"]["hourly_id"])["outflow_cms"].resample("1h").mean()

        print(f"\n{dam['name']['en']}: the turbines' pulses (best lag per dry month)")
        pulses = {}
        for c, g in gauges.items():
            rows = travel.pulse_lags(outflow, levels[c], t["pulses"]["months"], t["pulses"]["max_lag_h"], t["pulses"]["min_r"])
            pulses[c] = {"km": round(g["km"], 1), "months": rows, "spread": travel.spread([r["lag_h"] for r in rows])}
            s = pulses[c]["spread"]
            print(f"  {c:8s} km {g['km']:6.1f}  " + (f"{s['n']:2d} months, median {s['median']:.0f} h "
                  f"(quartiles {s['low']:.0f}-{s['high']:.0f})" if s else "no month with a clear fit"))
        print("floods since 2020 (hours between gauges: quartiles and median)")
        floods = []
        f = t["floods"]
        for up, down, max_h in t["pairs"]:
            for label, rise in (("all", f["min_rise_m"]), ("large", f["large_rise_m"])):
                ev = travel.event_lags(levels[up], levels[down], quantile=f["quantile"], gap_days=f["gap_days"],
                                       min_rise_m=rise, max_h=max_h, max_up_m=gauges[up].get("max_level_m"),
                                       max_down_m=gauges[down].get("max_level_m"))
                row = {"up": up, "down": down, "km": round(gauges[down]["km"] - gauges[up]["km"], 1), "floods": label,
                       "events": len(ev), "front": travel.spread([e["front_lag_h"] for e in ev]),
                       "peak": travel.spread([e["peak_lag_h"] for e in ev]), "list": ev}
                floods.append(row)
                fr, pk = row["front"], row["peak"]
                print(f"  {up:8s} -> {down:8s} {row['km']:5.1f} km  {label:5s} {len(ev):2d} floods  "
                      + (f"front {fr['low']:.0f}/{fr['median']:.0f}/{fr['high']:.0f}  " if fr else "front -  ")
                      + (f"peak {pk['low']:.0f}/{pk['median']:.0f}/{pk['high']:.0f}" if pk else "peak -"))

        anchors = [{**a, "km": gauges[a["gauge"]]["km"]} for a in t["anchors"]]
        entries = {c: {"km": k, "via": "main"} for c, k in travel.tambon_entry_km(main_pts, tambons).items()}
        from shapely.geometry import LineString
        for feature, junction in zip(tribs, junctions):
            line = LineString(feature["geometry"]["coordinates"])
            for x in tambons:
                if x["code"] not in entries and x["geometry"].intersects(line):
                    entries[x["code"]] = {"km": junction["junction_km_from_dam"], "via": "tributary"}
        rows = travel.table(entries, anchors, t["safety_margin"])
        print(f"arrival ranges: {len(rows)} tambons ({sum(r['via'] == 'main' for r in rows)} on the river, "
              f"{sum(r['via'] == 'tributary' for r in rows)} on a tributary's lower reach)")
        for r in rows:
            print(f"  {r['tambon_code']} {names[r['tambon_code']][1][:22]:22s} km {r['km_from_dam']:6.1f}  warn from "
                  f"{r['warn_from_h']:5.1f} h  first rise {r['earliest_h']:5.1f}-{r['latest_h']:5.1f} h  "
                  f"peak {r['peak_earliest_h']}-{r['peak_latest_h']} h  {r['via']}")
        result[code] = {"gauges": {c: {"km": round(g["km"], 2), "place": g["place"]} for c, g in gauges.items()},
                        "pulses": pulses, "floods": floods, "anchors": anchors, "rows": rows}
        if dry_run:
            continue
        travel.write_csv(out / "arrival_by_tambon.csv", rows, names)
        method = {"source": t["source"], "safety_margin": t["safety_margin"],
                  "basis_en": "Ranges from the river gauges: the turbines' daily pulses and the floods since 2020. "
                              "Not a forecast and not a hydraulic model."}
        seed = REPO_DIR / "supabase" / "seed" / "41_dam_arrivals.sql"
        seed.write_text(travel.seed_sql(code, t["source"], rows, method), encoding="utf-8", newline="\n")
        print(f"wrote {out / 'arrival_by_tambon.csv'} and {seed}")
    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    travel.write_json(out / "travel.json", result)
    return 0


def cmd_zone(cfg: dict, seed: bool = False) -> int:
    out = output_dir(cfg)
    names = list(cfg["zone"]["radar"])
    for dam in cfg["dams"]:
        found = zone.run(dam, cfg["zone"], cfg["travel"]["gauges"], data_dir() / "tidy", out, PIPELINE_DIR)
        print(f"\n{dam['name']['en']}: river surface {found['river_surface_m']['at_dam']} m at the dam, "
              f"{found['river_surface_m']['at_mouth']} m at the mouth")
        print("  rise   zone km2   " + "   ".join(f"{name}: held / seen wet" for name in names))
        for row in found["curve"]:
            cells = "   ".join(f"{row[name]['flood_held_pct']:5.1f}% / {row[name]['zone_seen_wet_pct']:5.1f}%"
                               for name in names)
            print(f"  {row['rise_m']:4} m  {row[names[0]]['zone_km2']:7.1f}   {cells}")
        for g in found["gauges"]:
            print(f"  {g['code']:8} km {g['km_from_dam']:6.1f}  highest {g['peak_m']:6.2f} m ({g['peak_at'][:10]})  "
                  f"river surface {g['river_surface_m']:6.2f}  rise {g['rise_m']:.2f} m")
        for name in names:
            z, o = found["against_radar"][name]["zone"], found["against_radar"][name]["outer"]
            print(f"  {name}: zone holds {z['flood_held_pct']}% of the radar flood in the corridor, "
                  f"{z['zone_seen_wet_pct']}% of it seen wet; outer {o['flood_held_pct']}% / {o['zone_seen_wet_pct']}%")
        print(f"  zone: {found['zone_km2']} km2, {found['zone_buildings']} buildings, "
              f"{found['tambons_in_zone']} tambons; with the outer band: {found['outer_km2']} km2, "
              f"{found['outer_buildings']} buildings, {found['tambons_in_outer']} tambons")
        print(f"  on the interim path but outside the zone: {found['interim_not_in_zone']}")
        print(f"  in the zone but not on the interim path:  {found['zone_not_on_interim']}")
        if seed:
            travelled = json.loads((out / "travel.json").read_text(encoding="utf-8"))[dam["code"]]
            t = cfg["travel"]
            note = {
                "source": "s7", "rise": "highest recorded levels at the gauges", "outer_extra_m": found["outer_extra_m"],
                "max_distance_km": found["max_distance_km"], "zone_km2": found["zone_km2"], "outer_km2": found["outer_km2"],
                "basis_en": "Land the river has been high enough to reach, from a 30 m elevation model. Not a hydraulic model.",
                "arrivals_source": t["source"],
                "arrivals_method": {"source": t["source"], "safety_margin": t["safety_margin"],
                                    "basis_en": "Ranges from the river gauges: the turbines' daily pulses and the floods since 2020. "
                                                "Not a forecast and not a hydraulic model. A place off the channel takes the "
                                                "time of the nearest point of the river."},
                "geometry_note": {"zone_source": "s7", "zone": True, "zone_km2": found["zone_km2"], "outer_km2": found["outer_km2"],
                                  "river_line": "osm"},
            }
            sql, rows = zone.seed_sql(dam["code"], "s7", found["_seed"], travelled, t["safety_margin"], note)
            dest = REPO_DIR / "supabase" / "seed" / "42_dam_zone.sql"
            dest.write_text(sql, encoding="utf-8", newline="\n")
            print(f"  wrote {dest} ({dest.stat().st_size // 1024} kB): {len(rows)} tambons, "
                  f"{sum(r['via'] == 'main' for r in rows)} on the river")
    return 0


def cmd_spill(cfg: dict, write_seed: bool) -> int:
    """The overflow zone of every reservoir with no gauge below it (spill.py)."""
    out = output_dir(cfg)
    wanted = set(cfg["spill"]["reservoirs"])
    dams = [dam for dam in cfg["dams"] if dam["code"] in wanted]
    missing = wanted - {dam["code"] for dam in dams}
    if missing:
        raise SystemExit(f"spill.reservoirs names a dam config.yaml has no entry for: {missing}")
    results = []
    for dam in dams:
        result = spill.run(dam, cfg, PIPELINE_DIR, data_dir(), out)
        results.append(result)
        print(f"\n{dam['name']['en']} ({result['code']}), {result['storage_max_mcm']} Mm3 full")
        print(f"  catchment above it   {result['catchment_km2']} km2")
        print(f"  flow path            {result['traced_km']} km traced, "
              f"{result['reach_km']} km kept ({result['stopped_because']})")
        print(f"  channel surface      {result['channel_surface_m'][0]} m at the wall to "
              f"{result['channel_surface_m'][1]} m at the end of the reach")
        rain = result["rain"]
        print(f"  wettest day           {rain['rain_mm']} mm, from the {rain['kind']}")
        if rain.get("satellite"):
            sat = rain["satellite"]
            print(f"    satellite           {sat['rain_mm']} mm over the catchment, 24 h ending "
                  f"{sat['ending']} ({sat['seasons']})")
        gauge = rain["gauges"]
        print(f"    rain gauges         {gauge['rain_mm']} mm at {gauge['stations'][0]['name_th']}, "
              f"{gauge['stations'][0]['km']} km away, on {gauge['stations'][0]['max_on']} "
              f"({len(gauge['stations'])} stations within {gauge['radius_km']:.0f} km, "
              f"{gauge['from']} to {gauge['to']})")
        if rain.get("basin_check"):
            check = rain["basin_check"]
            print(f"    whole basin         {check['mm']} mm over {check['basin']} "
                  f"(24 h ending {check['ending']}) - a check, not an input")
        for band in ("zone", "outer"):
            figures = result["bands"][band]
            note = f"  [{figures['bound']}]" if figures["bound"] else ""
            print(f"  {band:5s} {figures['wanted_mcm']:7.3f} Mm3 of spill stands "
                  f"{figures['depth_m']:.2f} m above the channel{note}")
        print(f"  zone                 {result['zone_km2']} km2, "
              f"{result['buildings_zone']} buildings")
        print(f"  with the outer band  {result['outer_km2']} km2, "
              f"{result['buildings_outer']} buildings, {result['tambons']} tambons")
        print(f"  the water arrives    {result['arrival_h'][0]} to {result['arrival_h'][1]} h "
              f"after it leaves, at {result['velocity_ms'][0]} to {result['velocity_ms'][1]} m/s "
              "(assumed, not measured)")
        for name, against in (result["radar"] or {}).items():
            print(f"  against {name:12s} holds {against['zone']['flood_held_pct']}% of the "
                  f"radar's flood in the corridor, {against['zone']['zone_seen_wet_pct']}% of the "
                  f"zone seen wet (outer: {against['outer']['flood_held_pct']}% / "
                  f"{against['outer']['zone_seen_wet_pct']}%)")
        for entry in result["tambon_rows"]:
            tambon, row = entry["tambon"], entry["row"]
            arrival = next(a for a in result["arrivals"] if a["tambon_code"] == tambon["code"])
            print(f"    {tambon['name_th']:12s} {tambon['name_en']:16s} km {row['km_from_dam']:5.1f}  "
                  f"zone {row['zone_km2']:6.2f} km2  outer {row['outer_km2']:6.2f}  "
                  f"buildings {row.get('buildings_outer', 0):5d}  "
                  f"{arrival['earliest_h']}-{arrival['latest_h']} h  {arrival['via']}")
    print(f"\njson and per-tambon csv in {out / 'spill'}")
    print(f"geojson            {out / 'geojson'}/<code>_spill.geojson")
    if not write_seed:
        print("\n--seed not given: no seed written.")
        return 0
    # The rain gauges cannot carry a design rain: the archive holds single "days" of 1,052 mm and
    # three 420 mm days in a row (spill.py, `daily_rain`). A seed is only written once the
    # satellite has been asked about these catchments.
    on_gauges = [result["code"] for result in results if result["rain"]["kind"] != "satellite"]
    if on_gauges:
        raise SystemExit("run `spill-rain` first: " + ", ".join(on_gauges)
                         + " would rest on the rain gauges, which the archive shows cannot carry "
                           "a single day's figure.")
    path = REPO_DIR / "supabase" / "seed" / "43_dam_spill_zone.sql"
    path.write_text(spill.seed_sql(results, cfg), encoding="utf-8")
    print(f"seed               {path}")
    return 0


def cmd_spill_rain(cfg: dict, season: list[int] | None) -> int:
    """Ask the satellite how much rain the reservoir catchments have taken (spill.py)."""
    project = env_value("EE_PROJECT")
    if not project:
        raise SystemExit("EE_PROJECT is not set in .env.local.")
    out = output_dir(cfg)
    spill.fetch_catchment_rain(out, cfg, project, season)
    print(f"wrote {out / 'spill' / 'rain'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dam_release", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    geometry = sub.add_parser("geometry", help="the release path from OpenStreetMap")
    geometry.add_argument("--dry-run", action="store_true")
    sub.add_parser("thresholds", help="what the archive says about the grade criteria")
    finder = sub.add_parser("find", help="which mapped channel leaves a reservoir, for config.yaml")
    finder.add_argument("lon", type=float)
    finder.add_argument("lat", type=float)
    finder.add_argument("--within", type=float, default=None, help="search radius in km")
    finder.add_argument("--min-km", type=float, default=None, help="shortest chain worth printing")
    sub.add_parser("travel", help="travel times and arrival ranges per tambon").add_argument("--dry-run", action="store_true")
    sub.add_parser("zone", help="the land a rise in the river can reach, from the elevation model").add_argument(
        "--seed", action="store_true", help="also write supabase/seed/42_dam_zone.sql (the zone as the dam's geometry)")
    spiller = sub.add_parser("spill", help="the overflow zone of a reservoir with no gauge below it")
    spiller.add_argument("--seed", action="store_true",
                         help="also write supabase/seed/43_dam_spill_zone.sql")
    spiller.add_argument("--only", nargs="+", default=None, metavar="CODE",
                         help="just these reservoirs")
    rainer = sub.add_parser("spill-rain", help="GSMaP over the reservoir catchments (Earth Engine)")
    rainer.add_argument("--season", type=int, nargs="+", default=None,
                        help="just these seasons (by their first year)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "geometry":
        return cmd_geometry(cfg, args.dry_run)
    if args.command == "travel":
        return cmd_travel(cfg, args.dry_run)
    if args.command == "zone":
        return cmd_zone(cfg, args.seed)
    if args.command == "spill":
        if args.only:
            cfg["spill"]["reservoirs"] = args.only
        return cmd_spill(cfg, args.seed)
    if args.command == "spill-rain":
        return cmd_spill_rain(cfg, args.season)
    if args.command == "find":
        if args.within is not None:
            find.SEARCH_KM = args.within
        if args.min_km is not None:
            find.MIN_CHAIN_KM = args.min_km
        return cmd_find(cfg, args.lon, args.lat)
    return cmd_thresholds(cfg)


if __name__ == "__main__":
    sys.exit(main())
