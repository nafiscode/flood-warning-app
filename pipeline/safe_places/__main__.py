"""Command line: `uv run python -m safe_places <command>` from the pipeline folder.

Commands
  fetch          fill the OpenStreetMap cache in <output_dir>/osm/: candidate buildings (half-degree
                 tiles) and the road network (quarter-degree tiles touching the provinces). Finished
                 tiles are skipped, so it can be run again after a server has given up.
  run [--limit N]
                 candidates, their terrain and radar features, the dry-route check and the score.
                 Writes <output_dir>/safe_places.csv (the columns of the safe_places table),
                 field_sheet.csv (for volunteers, most houses served first), summary.json and
                 supabase/seed/50_safe_places.sql. --limit scores only the first N candidates (a
                 quick trial; nothing is written to the seed).

Needs the hazard module's outputs (HAND, classes, buildings) and the radar run named in config.yaml.
Settings: safe_places/config.yaml. See docs/science-plan.md Module 2 and METHODS.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, env_value
from sar_floods import aoi as aoi_module

from . import features, osm, roads, score

CONFIG_PATH = Path(__file__).with_name("config.yaml")
SHELTERS = Path(__file__).with_name("official_shelters.csv")
log = logging.getLogger("safe_places")
SOURCES = ("osm", "jaga-terrain", "jaga-highway", "official-list")


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


def cmd_fetch(cfg: dict) -> int:
    bounds = aoi_module.bounds(aoi_module.load())
    cache = output_dir(cfg) / "osm"
    found = osm.fetch_pois(bounds, cfg["overpass_url"], cfg["user_agent"], cache)
    from shapely.geometry import shape

    tiles = osm.fetch_roads(bounds, cfg["overpass_url"], cfg["user_agent"], cache, area=shape(aoi_module.load()))
    print(f"{len(found)} named candidates and {len(tiles)} road tiles in {cache}")
    return 0


def official_shelters(path: Path = SHELTERS) -> list[dict]:
    """Rows the owner and volunteers have filled into the template (none until they do)."""
    out = []
    if not path.exists():
        return out
    with open(path, encoding="utf-8-sig", newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if not (row.get("lat") or "").strip() or not (row.get("lon") or "").strip():
                continue
            name = {k: row[f"name_{k}"].strip() for k in ("th", "ms", "en") if (row.get(f"name_{k}") or "").strip()}
            if not name:
                raise ValueError(f"{path.name}, row {i + 2}: a shelter needs at least one name.")
            out.append({"osm": None, "source": "official-list", "type": "shelter", "name": name,
                        "lon": float(row["lon"]), "lat": float(row["lat"]),
                        "capacity": int(row["capacity"]) if (row.get("capacity") or "").strip() else None,
                        "parking": (row.get("parking") or "").strip().lower() in ("yes", "y", "true", "1")})
    return out


def rasters(cfg: dict) -> dict:
    """Everything read on the hazard grid."""
    import rasterio
    from rasterio.warp import Resampling

    from hazard import classes as hazard_classes
    from hazard import tambons as hazard_tambons
    from hazard.__main__ import hazard_grid, load_config as hazard_config, output_dir as hazard_out
    from sar_floods import settings as sar_settings

    hcfg = hazard_config()
    root = hazard_out(hcfg)
    transform, shape, crs, window = hazard_grid(hcfg)
    h = cfg["radar_hash"]
    with rasterio.open(root / "burned" / "hand.tif") as src:
        hand = src.read(1, window=window).astype("float64")
        hand[hand == src.nodata] = np.nan
    with rasterio.open(root / "work" / "dem_utm.tif") as src:
        dem = src.read(1, window=window).astype("float64")
        dem[dem == src.nodata] = np.nan
    with rasterio.open(root / "classes" / f"hazard_classes_{h}.tif") as src:
        cls, basis = src.read(1), src.read(2)
    with rasterio.open(root / "buildings" / f"buildings_{hcfg['buildings']['year']}_{hcfg['export']['scale_m']}m.tif") as src:
        houses = np.nan_to_num(src.read(2).astype("float64"))
    sar = sar_settings.output_paths(sar_settings.load_config())
    flooded = lambda a: np.isin(a, (1, 3)).astype("uint8")           # noqa: E731  the VV rule
    events = {}
    for year in cfg["events"]:
        name = f"jaga_sar_max_event-{year}-nov-dec_10m_{h}.tif"
        path = next(p / name for p in (sar.products, sar.drive) if (p / name).exists())
        events[year] = hazard_classes.on_grid(path, 1, transform, shape, crs, Resampling.max, flooded).astype(bool)
    with rasterio.open(sar.products / f"jaga_sar_frequency_2017-2025_20m_{h}.tif") as src:
        nodata = src.nodata
    freq = hazard_classes.on_grid(sar.products / f"jaga_sar_frequency_2017-2025_20m_{h}.tif", 1, transform, shape, crs,
                                  Resampling.max, dtype="float32", src_nodata=nodata, fill=np.nan)
    places = hazard_tambons.tambon_geometries()
    return {"transform": transform, "shape": shape, "crs": crs, "hand": hand, "dem": dem, "land": cls > 0,
            "radar_blind": basis >= 2, "houses": houses, "events": events, "freq": freq.astype("float64"),
            "tambons": places, "tambon_index": hazard_tambons.index_raster(places, crs, transform, shape)}


def cmd_run(cfg: dict, limit: int | None) -> int:
    from pyproj import Transformer
    from scipy.spatial import cKDTree

    from hazard.compare import dilate

    started = time.time()
    out = output_dir(cfg)
    r = rasters(cfg)
    transform, shape = r["transform"], r["shape"]
    to_xy = Transformer.from_crs("EPSG:4326", r["crs"], always_xy=True).transform
    to_lonlat = Transformer.from_crs(r["crs"], "EPSG:4326", always_xy=True).transform
    flood_any = np.zeros(shape, dtype=bool)
    for mask in r["events"].values():
        flood_any |= mask
    log.info("grid %s, radar flood in either event %.0f km2", shape, flood_any.sum() * transform.a ** 2 / 1e6)

    # ---- roads
    rc = cfg["roads"]
    tiles = sorted((out / "osm").glob("roads_*.npz"))
    if not tiles:
        raise SystemExit("No road tiles in the cache: run `safe_places fetch` first.")
    ways = roads.load_tiles(tiles, rc["drop"])
    g = roads.build(ways, to_xy, rc["no_walking"], rc["no_driving"])
    cut = roads.mark_flooded(g, dilate(features.keep_patches(flood_any, rc["min_flood_patch_cells"]),
                                       rc["flood_buffer_cells"]), transform)
    log.info("roads: %d nodes, %d road pieces, %.1f%% of them flooded in 2024 or 2025", g.nodes, len(g.to) // 2,
             100 * cut / max(len(g.to), 1))
    can = {"walk": np.zeros(g.nodes, dtype=bool), "drive": np.zeros(g.nodes, dtype=bool)}
    can["walk"][g.frm[g.walk]] = True
    can["drive"][g.frm[g.drive]] = True
    ids = {m: np.nonzero(can[m])[0] for m in can}
    trees = {m: cKDTree(g.xy[ids[m]]) for m in can}

    # ---- houses on the network
    hr, hc = np.nonzero(r["houses"] > 0)
    hx, hy = transform.c + (hc + 0.5) * transform.a, transform.f + (hr + 0.5) * transform.e
    houses_at = {}
    for m in can:
        near = roads.nearest(trees[m], np.column_stack([hx, hy]), cfg["reach"]["snap_house_m"])
        ok = near >= 0
        houses_at[m] = np.bincount(ids[m][near[ok]], weights=r["houses"][hr[ok], hc[ok]], minlength=g.nodes)
    log.info("houses: %.0f in all, %.0f within %d m of a walkable road", r["houses"].sum(), houses_at["walk"].sum(),
             cfg["reach"]["snap_house_m"])

    # ---- candidates
    sites = [{**p, "source": "osm", "capacity": None, "parking": False}
             for p in osm.fetch_pois(aoi_module.bounds(aoi_module.load()), cfg["overpass_url"], cfg["user_agent"], out / "osm")]
    sites += official_shelters()
    pc = cfg["parking"]
    road_cell = np.zeros(shape, dtype=bool)
    rr, cc, inside = features.cell(transform, g.xy[ids["drive"], 0], g.xy[ids["drive"], 1], shape)
    road_cell[rr[inside], cc[inside]] = True
    ok = dilate(road_cell, 1) & (np.nan_to_num(r["hand"], nan=-1) > pc["min_hand_m"]) & r["land"] & ~flood_any
    weight = features.box_sum(r["houses"], int(round(pc["houses_within_m"] / transform.a)))
    spacing = int(round(pc["spacing_m"] / transform.a))
    # The highway embankments first: points of the main roads (not their bridges) the radar saw dry.
    hw = pc["highway"]
    on_highway = np.isin(ways["kind"], hw["kinds"])[ways["way_of_point"]] & ~ways["bridge"][ways["way_of_point"]]
    hx, hy = to_xy(ways["lon"][on_highway], ways["lat"][on_highway])
    hr_, hc_, hin = features.cell(transform, hx, hy, shape)
    highway_cell = np.zeros(shape, dtype=bool)
    highway_cell[hr_[hin], hc_[hin]] = True
    on_fill = features.pick_parking(highway_cell & r["land"] & ~flood_any, weight, r["tambon_index"], hw["per_tambon"], spacing)
    picked = features.pick_parking(ok, weight, r["tambon_index"], pc["per_tambon"], spacing, taken=on_fill)
    log.info("parking: %d points on highway embankments, %d on high terrain", len(on_fill), len(picked))
    for cells, source, th, en in ((on_fill, "jaga-highway", "คันทางหลวง", "Highway embankment"),
                                  (picked, "jaga-terrain", "ที่สูงริมถนน", "High ground by the road")):
        numbers: dict[int, int] = {}
        for row, col in cells:
            t = r["tambons"][int(r["tambon_index"][row, col]) - 1]
            numbers[id(t)] = numbers.get(id(t), 0) + 1
            lon, lat = to_lonlat(transform.c + (col + 0.5) * transform.a, transform.f + (row + 0.5) * transform.e)
            sites.append({"osm": None, "source": source, "type": "high_ground_parking", "capacity": None, "parking": True,
                          "name": {"th": f"{th} ต.{t['name_th']} {numbers[id(t)]}", "en": f"{en}, {t['name_en']} {numbers[id(t)]}"},
                          "lon": float(lon), "lat": float(lat)})
    x, y = to_xy(np.array([s["lon"] for s in sites]), np.array([s["lat"] for s in sites]))
    row, col, inside = features.cell(transform, x, y, shape)
    in_tambon = np.zeros(len(sites), dtype="int64")
    in_tambon[inside] = r["tambon_index"][row[inside], col[inside]]
    keep = np.nonzero(inside & (in_tambon > 0))[0]
    if limit:
        keep = keep[:limit]
    log.info("candidates: %d of %d found (the rest are outside the four provinces%s)", len(keep), len(sites),
             " or beyond --limit" if limit else "")

    # ---- features
    edge = features.flood_edge(flood_any, r["land"]) & np.isfinite(r["hand"])
    er, ec = np.nonzero(edge)
    edge_xy = np.column_stack([transform.c + (ec + 0.5) * transform.a, transform.f + (er + 0.5) * transform.e])
    fc = cfg["freeboard"]
    pts = np.column_stack([x[keep], y[keep]])
    height = features.sample(r["dem"], row[keep], col[keep], inside[keep])
    stage = features.water_surface(edge_xy, r["hand"][er, ec], pts, fc["edge_cells"], fc["max_edge_km"] * 1000)
    fb, basis = features.freeboard(features.sample(r["hand"], row[keep], col[keep], inside[keep]), stage)
    freq = features.sample(r["freq"], row[keep], col[keep], inside[keep])
    blind = features.sample(r["radar_blind"], row[keep], col[keep], inside[keep], fill=0).astype(bool)
    in_event = {yr: features.sample(m, row[keep], col[keep], inside[keep], fill=0).astype(bool) for yr, m in r["events"].items()}
    node = {m: roads.nearest(trees[m], pts, cfg["reach"]["snap_site_m"]) for m in can}

    rows = []
    for n, i in enumerate(keep.tolist()):
        s = sites[i]
        mode = "drive" if s["type"] == "high_ground_parking" else "walk"
        minutes = cfg["reach"]["drive_minutes" if mode == "drive" else "walk_minutes"]
        speed = rc["drive_kmh" if mode == "drive" else "walk_kmh"] / 3.6
        source = int(ids[mode][node[mode][n]]) if node[mode][n] >= 0 else -1
        got = roads.served(g, source, minutes * 60, speed, g.drive if mode == "drive" else g.walk, houses_at[mode])
        t = r["tambons"][int(in_tambon[i]) - 1]
        fill = float(pc["highway"]["assumed_fill_m"]) if s["source"] == "jaga-highway" else 0.0
        site = {**s, **got, "tambon": t["code"], "tambon_th": t["name_th"], "tambon_en": t["name_en"], "mode": mode,
                "elevation_m": None if np.isnan(height[n]) else round(float(height[n]), 1),
                "freeboard_m": None if np.isnan(fb[n]) else round(float(fb[n]) + fill, 1), "freeboard_basis": str(basis[n]),
                "fill_m": fill or None,
                "flood_freq": None if np.isnan(freq[n]) else round(float(freq[n]), 4),
                "flooded_2024": bool(in_event.get(2024, np.zeros(len(keep), bool))[n]),
                "flooded_2025": bool(in_event.get(2025, np.zeros(len(keep), bool))[n]), "radar_blind": bool(blind[n])}
        parts = score.components(site, cfg, minutes)
        site["score"], missing = score.total(parts, cfg["weights"])
        site["flags"] = score.flags(site, cfg)
        site["score_components"] = {"parts": parts, "missing": missing, "flags": site["flags"], "travel": mode,
                                    "houses_within_reach": got["houses"], "houses_reaching_on_dry_roads": got["houses_dry"],
                                    "mean_minutes_on_dry_roads": got["mean_minutes_dry"],
                                    "freeboard_from": site["freeboard_basis"], "radar_run": cfg["radar_hash"],
                                    **({"embankment_fill_assumed_m": fill} if fill else {})}
        rows.append(site)
        if (n + 1) % 1000 == 0:
            log.info("%d of %d scored", n + 1, len(keep))

    summary = summarise(rows, r["tambons"], r["tambon_index"], r["houses"])
    summary["minutes"] = round((time.time() - started) / 60, 1)
    write_csv(out / "safe_places.csv", rows)
    write_field_sheet(out / "field_sheet.csv", rows)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    if not limit:
        seed = REPO_DIR / "supabase" / "seed" / "50_safe_places.sql"
        seed.write_text(seed_sql(rows), encoding="utf-8", newline="\n")
        print(f"seed {seed} ({seed.stat().st_size / 1e6:.1f} MB)")
    print(json.dumps({k: v for k, v in summary.items() if k != "tambons_under_3"}, ensure_ascii=False, indent=1))
    if not limit:
        print("tambons with houses and fewer than 3 candidates:", summary["tambons_under_3"] or "none")
    return 0


def summarise(rows: list[dict], tambons: list[dict], tambon_index: np.ndarray, houses: np.ndarray) -> dict:
    by_type, by_flag, per_tambon = {}, {}, {}
    for s in rows:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1
        per_tambon[s["tambon"]] = per_tambon.get(s["tambon"], 0) + 1
        for f in s["flags"]:
            by_flag[f] = by_flag.get(f, 0) + 1
    populated = np.bincount(tambon_index.ravel(), weights=houses.ravel(), minlength=len(tambons) + 1)[1:] >= 50
    under = [f"{t['code']} {t['name_en']} ({per_tambon.get(t['code'], 0)})" for t, p in zip(tambons, populated)
             if p and per_tambon.get(t["code"], 0) < 3]
    scores = [s["score"] for s in rows if s["score"] is not None]
    return {"candidates": len(rows), "by_type": dict(sorted(by_type.items())), "flags": dict(sorted(by_flag.items())),
            "without_any_flag": sum(1 for s in rows if not s["flags"]), "scored": len(scores),
            "score_quartiles": [round(float(np.percentile(scores, q)), 2) for q in (25, 50, 75)] if scores else None,
            "populated_tambons": int(populated.sum()), "tambons_under_3": under}


COLUMNS = ("name", "type", "lon", "lat", "tambon", "elevation_m", "freeboard_m", "flood_freq", "flooded_2024",
           "flooded_2025", "score", "score_components", "capacity", "facilities", "parking", "verification_status",
           "status", "suitable_for")


def table_row(s: dict) -> dict:
    """A site as the safe_places table holds it. Every site starts unverified and of unknown status."""
    return {"name": s["name"], "type": s["type"], "lon": round(s["lon"], 6), "lat": round(s["lat"], 6), "tambon": s["tambon"],
            "elevation_m": s["elevation_m"], "freeboard_m": s["freeboard_m"], "flood_freq": s["flood_freq"],
            "flooded_2024": s["flooded_2024"], "flooded_2025": s["flooded_2025"], "score": s["score"],
            "score_components": s["score_components"], "capacity": s["capacity"],
            "facilities": {"source": s["source"], **({"osm": s["osm"]} if s["osm"] else {})}, "parking": bool(s["parking"]),
            "verification_status": "unverified", "status": "unknown", "suitable_for": "{flood}"}


def write_csv(path: Path, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for s in rows:
            row = table_row(s)
            for k in ("name", "score_components", "facilities"):
                row[k] = json.dumps(row[k], ensure_ascii=False)
            w.writerow(row)


QUESTIONS = ("photo_taken_yes_no", "flooded_2024_yes_no_depth_cm", "flooded_2025_yes_no_depth_cm",
             "road_passable_in_flood_yes_no", "people_it_can_hold", "toilets_and_water_yes_no",
             "cars_can_park_how_many", "contact_person_and_phone", "notes")


def write_field_sheet(path: Path, rows: list[dict]) -> None:
    """For volunteers: the sites serving the most houses first, a map link, why each was flagged, and
    empty columns for what only a visit can tell."""
    order = sorted(rows, key=lambda s: (-(s["houses"] or 0), s["tambon"]))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["priority", "tambon_code", "tambon_th", "tambon_en", "name_th", "name_other", "type", "houses_served",
                    "score", "check_because", "freeboard_m", "map_link", *QUESTIONS])
        for n, s in enumerate(order, start=1):
            w.writerow([n, s["tambon"], s["tambon_th"], s["tambon_en"], s["name"].get("th", ""),
                        s["name"].get("en") or s["name"].get("ms", ""), s["type"], s["houses"] if s["houses"] is not None else "",
                        s["score"] if s["score"] is not None else "", "; ".join(s["flags"]),
                        s["freeboard_m"] if s["freeboard_m"] is not None else "",
                        f"https://www.google.com/maps/search/?api=1&query={s['lat']:.6f},{s['lon']:.6f}",
                        *[""] * len(QUESTIONS)])


def _q(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, dict):
        return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def seed_sql(rows: list[dict]) -> str:
    """supabase/seed/50_safe_places.sql. Reloading replaces only the pipeline's own unverified rows:
    a site an admin has verified, rejected or edited by hand is never touched."""
    lines = ["-- Generated by pipeline/safe_places. Do not edit by hand.",
             "-- Candidate safe places, every one UNVERIFIED: nobody has stood there yet.",
             "-- Buildings (c) OpenStreetMap contributors, ODbL. Heights: FABDEM (CC BY-NC-SA 4.0).", "",
             "delete from public.safe_places where verification_status = 'unverified'",
             "  and facilities->>'source' in (" + ", ".join(_q(s) for s in SOURCES) + ");", ""]
    if rows:
        lines.append("insert into public.safe_places (name, type, point, tambon, elevation_m, freeboard_m, flood_freq,")
        lines.append("    flooded_2024, flooded_2025, score, score_components, capacity, facilities, parking,")
        lines.append("    verification_status, status, suitable_for) values")
        values = []
        for s in rows:
            t = table_row(s)
            values.append("  (" + ", ".join([
                _q(t["name"]), _q(t["type"]), f"extensions.st_setsrid(extensions.st_makepoint({t['lon']}, {t['lat']}), 4326)",
                _q(t["tambon"]), _q(t["elevation_m"]), _q(t["freeboard_m"]), _q(t["flood_freq"]), _q(t["flooded_2024"]),
                _q(t["flooded_2025"]), _q(t["score"]), _q(t["score_components"]), _q(t["capacity"]), _q(t["facilities"]),
                _q(t["parking"]), "'unverified'", "'unknown'", "'{flood}'"]) + ")")
        lines.append(",\n".join(values) + ";")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="safe_places", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch")
    sub.add_parser("run").add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    return cmd_fetch(cfg) if args.command == "fetch" else cmd_run(cfg, args.limit)


if __name__ == "__main__":
    sys.exit(main())
