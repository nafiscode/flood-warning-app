"""supabase/seed/46_zones_gauges_thresholds.sql: the warning zones, the gauges and the provisional
thresholds, for the app (A8). Generated from the station list, the catchments and the hindcast.

What a gauge's two levels mean on the public map (`station_status`): `warning_m` is the bank,
the level at which the river leaves its channel; `watch_m` is set only on a zone's key gauge and is
the hindcast's Warning level, the river coming close to its bank. A gauge without a bank level in
ThaiWater's list has neither and says so. Nothing here is an alert level: alerts are issued by
people (safety rule 2).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path

import pandas as pd


def zone_id(zone: str) -> str:
    """A fixed id per zone, so a re-seed keeps what points at it."""
    return str(uuid.UUID(hashlib.md5(f"jaga-zone-{zone}".encode()).hexdigest()))


def q(text: str | None) -> str:
    return "null" if text is None else "'" + str(text).replace("'", "''") + "'"


def num(value) -> str:
    return "null" if value is None or pd.isna(value) else repr(round(float(value), 3))


def gauges(stations: pd.DataFrame, cfg: dict, result: dict) -> list[dict]:
    """One row per gauge that reports a water level in the four provinces."""
    known: dict[int, dict] = {}
    for zone, z in cfg["zones"].items():
        warn = (result["zones"][zone]["proposal"].get("warning") or {})
        for role, items in (("key", [z["key"]]), ("upstream", [z["upstream"]]), ("other", z.get("downstream", []) + z.get("extra", []))):
            for g in items:
                known[int(g["id"])] = {"zone": zone, "bank": float(g["bank_m"]), "point": g.get("point"),
                                       "watch": warn.get("threshold") if role == "key" and warn.get("signal") == "key_level_m" else None}
    rows = []
    use = stations[(stations["wl_reporting"] == True) & (stations["in_bbox"] == True)  # noqa: E712
                   & stations["lat"].notna() & stations["province_code"].isin([90, 94, 95, 96, "90", "94", "95", "96"])]
    for r in use.itertuples():
        k = known.get(int(r.station_id), {})
        bank = k.get("bank", None if pd.isna(r.min_bank_m) or float(r.min_bank_m) <= 0 else float(r.min_bank_m))
        lon, lat = k["point"] if k.get("point") else (float(r.lon), float(r.lat))
        code = None if pd.isna(r.old_code) else str(r.old_code)
        rows.append({
            "thaiwater_id": int(r.station_id), "code": code or str(int(r.station_id)),
            "name": {"th": None if pd.isna(r.name_th) else str(r.name_th), "en": None if pd.isna(r.name_en) else str(r.name_en),
                     "code": code},
            "lon": lon, "lat": lat, "basin": None if pd.isna(r.basin_name_en) else str(r.basin_name_en),
            "agency": None if pd.isna(r.agency) else str(r.agency), "zone": k.get("zone"),
            "bank": bank, "watch": k.get("watch"),
        })
    # Two listings can share an old code (X.77 is listed twice): the code must be unique.
    seen: dict[str, int] = {}
    for row in rows:
        seen[row["code"]] = seen.get(row["code"], 0) + 1
    for row in rows:
        if seen[row["code"]] > 1:
            row["code"] = f"{row['code']}#{row['thaiwater_id']}"
    return sorted(rows, key=lambda x: x["code"])


def rain_points(geometries: list[dict], step: float, most: int) -> list[list[float]]:
    """Points on a regular grid inside the catchment, for a mean of forecast rain over it."""
    import shapely

    shape = shapely.unary_union([shapely.geometry.shape(g) for g in geometries])
    x0, y0, x1, y1 = shape.bounds
    pts = []
    y = round(y0 / step) * step
    while y <= y1 + 1e-9:
        x = round(x0 / step) * step
        while x <= x1 + 1e-9:
            if shape.contains(shapely.Point(x, y)):
                pts.append([round(x, 3), round(y, 3)])
            x += step
        y += step
    if not pts:
        c = shape.representative_point()
        pts = [[round(c.x, 3), round(c.y, 3)]]
    # Thin evenly if the catchment holds more points than one request should carry.
    return pts[:: max(1, -(-len(pts) // most))][:most]


def feed_setting(cfg: dict, basins: dict, glofas_cells: dict) -> dict:
    """The `signal_feed` setting: where each zone's forecast rain, discharge and tide are asked for."""
    f = cfg["feeds"]
    zones = {}
    for zone, z in cfg["zones"].items():
        geoms = [basins[f"{zone}.{z['rain_basin']}"]["geometry"]]
        zones[zone] = {
            "rain_points": rain_points(geoms, float(f["rain_grid_deg"]), int(f["rain_points_max"])),
            "glofas": glofas_cells.get(zone),
            "tide": z.get("tide_point"),
            "gauges": {"key": int(z["key"]["id"]), "upstream": int(z["upstream"]["id"])},
        }
    return {"rain_url": f["rain_url"], "flood_url": f["flood_url"], "marine_url": f["marine_url"],
            "timeout_s": 25, "zones": zones}


def sql(cfg: dict, result: dict, basins: dict, stations: pd.DataFrame, glofas_cells: dict | None = None) -> tuple[str, dict]:
    out = ["-- Generated by pipeline/thresholds (`seed`). Do not edit by hand.",
           "-- The warning zones, the river gauges of the four provinces and the provisional thresholds from",
           "-- the hindcast (pipeline/thresholds/report.md). The thresholds suggest a level to an admin and",
           "-- never publish one; an admin's own change to a threshold is kept (provisional = false).", ""]
    zones = list(cfg["zones"])
    for zone in zones:
        z = cfg["zones"][zone]
        polys = [f["geometry"] for key, f in basins.items() if key.startswith(zone + ".")
                 and not f["properties"]["basin"].startswith("dam_to")]
        multi = {"type": "MultiPolygon", "coordinates": [p["coordinates"] for p in polys if p["type"] == "Polygon"]}
        out.append(
            f"insert into public.warning_zones (id, name, basin, hazard_type, geom) values ('{zone_id(zone)}', "
            f"{q(json.dumps(z['name'], ensure_ascii=False))}::jsonb, '{zone}', 'flood', "
            f"extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_setsrid("
            f"extensions.st_geomfromgeojson('{json.dumps(multi, separators=(',', ':'))}'), 4326)), 3)))\n"
            f"  on conflict (id) do update set name = excluded.name, basin = excluded.basin, geom = excluded.geom;")
    out.append("")
    rows = gauges(stations, cfg, result)
    out.append("insert into public.stations (source, code, name, point, basin, zone_id, bankfull_m, watch_m, warning_m, critical_m, thaiwater_id, agency) values")
    values = []
    for r in rows:
        zid = "null" if not r["zone"] else f"'{zone_id(r['zone'])}'"
        values.append(f"  ('thaiwater', {q(r['code'])}, {q(json.dumps(r['name'], ensure_ascii=False))}::jsonb, "
                      f"extensions.st_setsrid(extensions.st_makepoint({r['lon']:.6f}, {r['lat']:.6f}), 4326), {q(r['basin'])}, {zid}, "
                      f"{num(r['bank'])}, {num(r['watch'])}, {num(r['bank'])}, {num(r['bank'])}, {r['thaiwater_id']}, {q(r['agency'])})")
    out.append(",\n".join(values))
    out.append("  on conflict (source, code) do update set name = excluded.name, point = excluded.point, basin = excluded.basin,\n"
               "    zone_id = excluded.zone_id, bankfull_m = excluded.bankfull_m, watch_m = excluded.watch_m,\n"
               "    warning_m = excluded.warning_m, critical_m = excluded.critical_m, thaiwater_id = excluded.thaiwater_id,\n"
               "    agency = excluded.agency;")
    out.append("")
    n = 0
    for zone in zones:
        p = result["zones"][zone]["proposal"]
        by_signal: dict[str, dict] = {}
        for level in ("watch", "warning", "evacuate"):
            row = p.get(level)
            if row:
                by_signal.setdefault(row["signal"], {})[level] = row["threshold"]
        for signal, levels in by_signal.items():
            n += 1
            out.append(f"insert into public.thresholds (zone_id, signal, levels, provisional) values ('{zone_id(zone)}', '{signal}', "
                       f"'{json.dumps(levels)}'::jsonb, true)\n"
                       f"  on conflict (zone_id, signal) do update set levels = excluded.levels, updated_at = now()\n"
                       f"  where public.thresholds.provisional;")
    out.append("")
    setting = feed_setting(cfg, basins, glofas_cells or {})
    out.append("insert into public.system_settings (key, value, note) values ('signal_feed', "
               f"{q(json.dumps(setting))}::jsonb, 'Where each warning zone''s forecast rain, modelled discharge and tide are asked "
               "for, and which gauges are its key and upstream ones. Generated by pipeline/thresholds; fetched hourly by signals_fetch().')\n"
               "  on conflict (key) do update set value = excluded.value, note = excluded.note;")
    out.append("")
    return "\n".join(out), {"zones": len(zones), "rain_points": {z: len(v["rain_points"]) for z, v in setting["zones"].items()}, "stations": len(rows), "with_bank": sum(r["bank"] is not None for r in rows),
                            "in_a_zone": sum(r["zone"] is not None for r in rows), "thresholds": n}


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")
