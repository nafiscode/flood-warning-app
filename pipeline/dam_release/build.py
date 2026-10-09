"""Build the release path and write it out twice: as GeoJSON for the owner to look at in ArcGIS
Pro, and as the seed SQL the app's database is rebuilt from.

Both carry the same `source` tag ("osm"), because S7 steps 2-3 will produce a second version
from HAND and the radar extents and the two have to be comparable side by side before one
replaces the other (the owner's decision, 10 Oct 2026).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from shapely.geometry import MultiPolygon, mapping

from . import network, osm

log = logging.getLogger("dam_release")

SOURCE = "osm"
CREDIT = "Rivers and reservoir: (c) OpenStreetMap contributors, ODbL"


def build(dam: dict, cfg: dict, out_dir: Path, pipeline_dir: Path) -> dict:
    """Everything the map and the database need for one dam, as plain Python."""
    ways = osm.load_waterways((pipeline_dir / cfg["waterway_cache"]).resolve())
    relation = osm.fetch_relation(dam["reservoir_relation"], cfg["overpass_url"],
                                  cfg["user_agent"], out_dir / "osm")
    reservoir = osm.relation_polygon(relation)

    chain = network.walk_downstream(ways, dam["outlet_way"])
    if len(chain) < 2:
        raise RuntimeError(
            f"the walk downstream from OSM way {dam['outlet_way']} ended after "
            f"{len(chain)} way(s). Check outlet_way in config.yaml."
        )
    outlet, main = chain[0], chain[1:]
    main_pts = network.joined(main)
    tribs = network.lower_reaches(ways, chain,
                                  dam["tributaries"]["min_network_km"],
                                  dam["tributaries"]["lower_reach_km"])

    simplify_m = cfg["simplify_m"]
    simple = lambda pts: network.simplify(pts, simplify_m)  # noqa: E731
    reservoir_simple = reservoir.simplify(simplify_m / 111_320.0, preserve_topology=True)
    if reservoir_simple.geom_type == "Polygon":
        reservoir_simple = MultiPolygon([reservoir_simple])

    result = {
        "dam": dam,
        "source": SOURCE,
        "credit": CREDIT,
        "reservoir": reservoir_simple,
        "reservoir_km2": round(osm.area_km2(reservoir_simple), 1),
        # Where the released water first shows up on the map: the channel OSM maps leaving the
        # dam. The spillway's own channel is not mapped, so it stays a point, not a drawn line.
        "outlet": {"pts": simple(outlet["pts"]), "length_km": round(network.length_km(outlet["pts"]), 2),
                   "osm_way": outlet["id"]},
        "main": {"pts": simple(main_pts), "length_km": round(network.length_km(main_pts), 2),
                 "osm_ways": [w["id"] for w in main],
                 "mouth": main_pts[-1]},
        "tributaries": [{**t, "pts": simple(t["pts"])} for t in tribs],
    }
    log.info("built %s: reservoir %.1f km2, reach %.1f km, %d tributaries",
             dam["code"], result["reservoir_km2"], result["main"]["length_km"], len(tribs))
    return result


# --------------------------------------------------------------------------- GeoJSON (the look)

def _feature(geometry: dict, properties: dict) -> dict:
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _line(pts) -> dict:
    return {"type": "LineString", "coordinates": [list(p) for p in pts]}


def write_geojson(built: dict, folder: Path) -> list[Path]:
    """One file per layer, which is how ArcGIS Pro wants them: each becomes its own layer with
    its own symbology. Plus one combined file for a quick look anywhere else."""
    folder.mkdir(parents=True, exist_ok=True)
    dam = built["dam"]
    code = dam["code"]
    name_en = dam["name"]["en"]

    reservoir = _feature(mapping(built["reservoir"]),
                         {"layer": "reservoir", "dam": code, "name": name_en,
                          "area_km2": built["reservoir_km2"], "source": SOURCE})
    reaches = [
        _feature(_line(built["outlet"]["pts"]),
                 {"layer": "reach", "kind": "outlet", "dam": code,
                  "name": f"{name_en} outlet channel",
                  "length_km": built["outlet"]["length_km"], "source": SOURCE}),
        _feature(_line(built["main"]["pts"]),
                 {"layer": "reach", "kind": "main", "dam": code,
                  "name": dam["river"]["en"], "length_km": built["main"]["length_km"],
                  "source": SOURCE}),
    ]
    tributaries = [
        _feature(_line(t["pts"]),
                 {"layer": "tributary", "dam": code, "kind": "tributary",
                  "osm_name": t["osm_name"], "waterway": t["waterway"],
                  "network_km": t["network_km"], "reach_km": t["reach_km"],
                  "junction_km_from_dam": t["junction_km_from_dam"], "source": SOURCE})
        for t in built["tributaries"]
    ]
    points = [
        _feature({"type": "Point", "coordinates": list(dam["dam_point"])},
                 {"layer": "point", "kind": "dam", "dam": code, "name": name_en,
                  "source": "owner"}),
        _feature({"type": "Point", "coordinates": list(dam["spillway_point"])},
                 {"layer": "point", "kind": "spillway", "dam": code,
                  "name": f"{name_en} main spillway", "source": "owner",
                  "note": "its own channel is not mapped in OpenStreetMap"}),
        _feature({"type": "Point", "coordinates": list(built["outlet"]["pts"][0])},
                 {"layer": "point", "kind": "outlet", "dam": code,
                  "name": f"{name_en} outlet (powerhouse tailwater)", "source": SOURCE,
                  "note": "head of the mapped outlet channel, approximate"}),
        _feature({"type": "Point", "coordinates": list(built["main"]["mouth"])},
                 {"layer": "point", "kind": "mouth", "dam": code,
                  "name": f"{dam['river']['en']} mouth", "source": SOURCE}),
    ]

    written = []
    for name, features in (("reservoir", [reservoir]), ("reach", reaches),
                           ("tributaries", tributaries), ("points", points),
                           ("all", [reservoir, *reaches, *tributaries, *points])):
        path = folder / f"{code}_{name}.geojson"
        path.write_text(json.dumps(
            {"type": "FeatureCollection", "credit": CREDIT,
             "features": features}, ensure_ascii=False), encoding="utf-8")
        written.append(path)
    log.info("wrote %d GeoJSON files to %s", len(written), folder)
    return written


# ------------------------------------------------------------------------------- seed SQL

def _sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _sql_json(value) -> str:
    return _sql_text(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def _wkt_line(pts) -> str:
    inner = ", ".join(f"{x:.6f} {y:.6f}" for x, y in pts)
    return f"LINESTRING ({inner})"


def _wkt_point(pt) -> str:
    return f"POINT ({pt[0]:.6f} {pt[1]:.6f})"


def _wkt_multipolygon(shape: MultiPolygon) -> str:
    parts = []
    for polygon in shape.geoms:
        rings = [polygon.exterior, *polygon.interiors]
        parts.append("(" + ", ".join(
            "(" + ", ".join(f"{x:.6f} {y:.6f}" for x, y in ring.coords) + ")"
            for ring in rings) + ")")
    return "MULTIPOLYGON (" + ", ".join(parts) + ")"


def _geom(wkt: str) -> str:
    return f"extensions.st_geomfromtext('{wkt}', 4326)"


def write_seed(built_all: list[dict], grades: dict, path: Path) -> Path:
    """supabase/seed/40_dams.sql: the dam, its reservoir and the release path.

    Written in the same shape as the boundary seeds: generated, never hand-edited, and able to
    rebuild the database from nothing (CLAUDE.md, Stack: a paused free project must be
    rebuildable from migrations and seed).
    """
    lines = [
        "-- Generated by pipeline/dam_release. Do not edit by hand.",
        "-- " + CREDIT + ".",
        "-- Positions of the dam wall and the main spillway: the owner, 9 Oct 2026.",
        "-- The release path is OpenStreetMap's river network, the interim source decided on",
        "-- 10 Oct 2026. It says where the river runs, not how far the water spreads; S7 steps",
        "-- 2-3 will add a second version under source 's7' to compare before replacing it.",
        "",
        "delete from public.dam_reaches where source = " + _sql_text(SOURCE) + ";",
        "",
    ]
    for built in built_all:
        dam = built["dam"]
        code = _sql_text(dam["code"])
        note = {
            "source": SOURCE,
            "credit": CREDIT,
            "limits_en": (
                "The river line is OpenStreetMap's. It shows where the water runs, not how far "
                "it spreads, and only the tributaries somebody has mapped."
            ),
            "mapped_tributaries": len(built["tributaries"]),
            "reach_km": built["main"]["length_km"],
            "spillway_channel_mapped": False,
            "outlet_point": "head of the mapped outlet channel, approximate",
        }
        lines += [
            "insert into public.dams (code, name, river, operator, province_code,",
            "    thaiwater_hourly_id, thaiwater_daily_id, point, spillway_point, outlet_point,",
            "    reservoir, storage_max_mcm, storage_normal_mcm, geometry_source, geometry_note)",
            "  values (",
            f"    {code},",
            f"    {_sql_json(dam['name'])},",
            f"    {_sql_json(dam['river'])},",
            f"    {_sql_text(dam['operator'])},",
            f"    {_sql_text(dam['province'])},",
            f"    {dam['thaiwater']['hourly_id']}, {dam['thaiwater']['daily_id']},",
            f"    {_geom(_wkt_point(dam['dam_point']))},",
            f"    {_geom(_wkt_point(dam['spillway_point']))},",
            f"    {_geom(_wkt_point(built['outlet']['pts'][0]))},",
            f"    {_geom(_wkt_multipolygon(built['reservoir']))},",
            f"    {dam['storage']['max_mcm']}, {dam['storage']['normal_mcm']},",
            f"    {_sql_text(SOURCE)}, {_sql_json(note)}",
            "  )",
            "  on conflict (code) do update set",
            "    name = excluded.name, river = excluded.river, operator = excluded.operator,",
            "    province_code = excluded.province_code,",
            "    thaiwater_hourly_id = excluded.thaiwater_hourly_id,",
            "    thaiwater_daily_id = excluded.thaiwater_daily_id,",
            "    point = excluded.point, spillway_point = excluded.spillway_point,",
            "    outlet_point = excluded.outlet_point, reservoir = excluded.reservoir,",
            "    storage_max_mcm = excluded.storage_max_mcm,",
            "    storage_normal_mcm = excluded.storage_normal_mcm,",
            "    geometry_source = excluded.geometry_source,",
            "    geometry_note = excluded.geometry_note, updated_at = now();",
            "",
        ]
        rows = [
            ("outlet", 0, {"en": f"{dam['name']['en']} outlet channel"}, 0.0,
             built["outlet"]["length_km"], built["outlet"]["pts"]),
            ("main", 0, dam["river"], 0.0, built["main"]["length_km"], built["main"]["pts"]),
        ]
        for index, trib in enumerate(built["tributaries"]):
            rows.append(("tributary", index, {"osm": trib["osm_name"]} if trib["osm_name"] else {},
                         trib["junction_km_from_dam"], trib["reach_km"], trib["pts"]))
        lines.append("insert into public.dam_reaches (dam_code, kind, source, seq, name,"
                     " km_from_dam, length_km, line) values")
        values = [
            f"  ({code}, '{kind}', {_sql_text(SOURCE)}, {seq}, {_sql_json(name)},"
            f" {km_from}, {length}, {_geom(_wkt_line(pts))})"
            for kind, seq, name, km_from, length, pts in rows
        ]
        lines.append(",\n".join(values) + ";")
        lines += ["", f"select public.dam_tambons_rebuild({code}, {_sql_text(SOURCE)});", ""]

    lines += [
        "-- The criteria the live figures are graded by (pipeline/dam_release/config.yaml,",
        "-- measured against the archive in pipeline/dam_release/METHODS.md). Admins own them.",
        "insert into public.system_settings (key, value, note) values",
        f"  ('dam_grades', {_sql_json(grades)},",
        "   'When the app shows its own quiet dam notice (watchful) and when a release reaches the"
        " admins to review and send (releasing). Code never publishes an alert itself: safety rule 2.')",
        "  on conflict (key) do nothing;",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    log.info("wrote %s (%.0f kB)", path, path.stat().st_size / 1024)
    return path
