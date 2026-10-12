"""The hazard classes summed per tambon: area and buildings in each class.

Tambon outlines come from supabase/seed/30_tambons.sql (the detailed geometry, as the database has
it). A cell belongs to the tambon whose outline contains its centre. Buildings are the fractional
counts of Open Buildings on the same grid, so a count is an estimate, not a census.

The table says how much of a tambon is in each class. It does not say a tambon "is" a class: a
tambon with 5 % of its land High can hold most of its houses there, which is why both are given.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

import numpy as np

from ingest_thaiwater.settings import REPO_DIR

from .classes import NAMES

SEED_SQL = REPO_DIR / "supabase" / "seed" / "30_tambons.sql"
_ROW = re.compile(r"^\s*\('(\d{6})', '\d{4}', '\d{2}', '((?:[^']|'')*)', '((?:[^']|'')*)', "
                  r"extensions\.st_geomfromtext\('([^']+)', 4326\)")
ORDER = ("high", "medium", "low", "minimal")
CODES = {name: code for code, name in NAMES.items()}


def tambon_geometries(sql_path: Path = SEED_SQL) -> list[dict]:
    """[{code, name_th, name_en, geometry}] for every tambon in the seed, in the file's order."""
    import shapely

    out = []
    with open(sql_path, encoding="utf-8") as f:
        for line in f:
            m = _ROW.match(line)
            if m:
                out.append({"code": m[1], "name_th": m[2].replace("''", "'"), "name_en": m[3].replace("''", "'"),
                            "geometry": shapely.from_wkt(m[4])})
    if not out:
        raise SystemExit(f"No tambons found in {sql_path.name}. Run admin_boundaries first.")
    return out


def index_raster(tambons: list[dict], crs: str, transform, shape: tuple[int, int]) -> np.ndarray:
    """1-based position of the tambon each cell centre falls in (0 = none)."""
    import shapely
    from rasterio import features
    from rasterio.warp import transform_geom

    shapes = ((transform_geom("EPSG:4326", crs, shapely.geometry.mapping(t["geometry"])), i + 1)
              for i, t in enumerate(tambons))
    return features.rasterize(shapes, out_shape=shape, transform=transform, fill=0, dtype="uint16")


def summarise(index: np.ndarray, cls: np.ndarray, basis: np.ndarray, buildings: np.ndarray, n: int,
              cell_km2: float) -> list[dict]:
    """One row per tambon position 1..n: km2 and buildings per class, and the share that rests on
    elevation alone (basis 2 or 3) among the cells classed Medium or High."""
    rows = []
    idx = index.ravel()
    inside = cls.ravel() > 0
    b = np.nan_to_num(buildings.ravel().astype("float64"))
    area = {name: np.bincount(idx[inside & (cls.ravel() == CODES[name])], minlength=n + 1) for name in ORDER}
    count = {name: np.bincount(idx, weights=np.where(inside & (cls.ravel() == CODES[name]), b, 0.0), minlength=n + 1)
             for name in ORDER}
    warned = inside & (cls.ravel() >= CODES["medium"])
    by_elevation = np.bincount(idx[warned & (basis.ravel() >= 2)], minlength=n + 1)
    warned_cells = np.bincount(idx[warned], minlength=n + 1)
    for i in range(1, n + 1):
        cells = sum(int(area[name][i]) for name in ORDER)
        total_b = sum(float(count[name][i]) for name in ORDER)
        row = {"land_km2": round(cells * cell_km2, 2), "buildings": int(round(total_b))}
        for name in ORDER:
            row[f"{name}_km2"] = round(int(area[name][i]) * cell_km2, 2)
            row[f"{name}_pct"] = round(100 * int(area[name][i]) / cells, 1) if cells else None
            row[f"{name}_buildings"] = int(round(float(count[name][i])))
        hm = float(count["high"][i] + count["medium"][i])
        row["buildings_medium_or_high_pct"] = round(100 * hm / total_b, 1) if total_b >= 0.5 else None
        row["medium_or_high_by_elevation_only_pct"] = (round(100 * int(by_elevation[i]) / int(warned_cells[i]), 1)
                                                       if warned_cells[i] else None)
        rows.append(row)
    return rows


def write_csv(dest: Path, tambons: list[dict], rows: list[dict], radar_run: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fields = ["tambon_code", "name_th", "name_en", *rows[0].keys(), "radar_run"]
    with open(dest, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for t, r in zip(tambons, rows):
            w.writerow({"tambon_code": t["code"], "name_th": t["name_th"], "name_en": t["name_en"], **r,
                        "radar_run": radar_run})


COLUMNS = ("land_km2", "buildings", "high_km2", "high_pct", "high_buildings", "medium_km2", "medium_pct",
           "medium_buildings", "low_km2", "low_pct", "low_buildings", "minimal_km2", "minimal_pct", "minimal_buildings",
           "buildings_medium_or_high_pct", "medium_or_high_by_elevation_only_pct")


def seed_sql(tambons: list[dict], rows: list[dict], radar_run: str) -> str:
    """supabase/seed/45_hazard_by_tambon.sql: the whole table, replaced in one go. Generated, never
    edited by hand. A tambon without any classed land is left out."""
    lines = ["-- Generated by pipeline/hazard (`tambons`). Do not edit by hand.",
             "-- Area and buildings per flood-hazard class in every tambon. Not checked against observed",
             "-- floods; building counts are estimates (Google Open Buildings, CC BY 4.0). Heights: FABDEM",
             "-- (CC BY-NC-SA 4.0). Radar: Copernicus Sentinel-1.", "",
             "delete from public.hazard_by_tambon;", "",
             "insert into public.hazard_by_tambon (tambon_code, radar_run, " + ", ".join(COLUMNS) + ") values"]
    values = []
    for t, r in zip(tambons, rows):
        if r["land_km2"] <= 0:
            continue
        cells = ["null" if r[c] is None else repr(r[c]) for c in COLUMNS]
        values.append(f"  ('{t['code']}', '{radar_run}', " + ", ".join(cells) + ")")
    return "\n".join(lines) + "\n" + ",\n".join(values) + ";\n"
