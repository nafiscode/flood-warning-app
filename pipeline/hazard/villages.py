"""The hazard classes summed per village (muban): buildings in each class, around each village point.

There is no open layer of village outlines here, only points, so a village's share of the land is
made the way a census office would without a map: every cell of a tambon goes to the nearest
village point of that tambon (a Voronoi cell cut at the tambon's edge). The buildings counted are
the fractional Open Buildings counts on the hazard grid, as for the tambon table.

Two sources of points (decision 2026-10-16):
- the 2012 national village layer (a copy on GitHub, no licence stated): names, no village number.
  Used where it has points. Its rows are for teams and admins only, never public, because its terms
  are unknown; the seed made from it goes to the private data repo, not this public one.
- OpenStreetMap villages and hamlets (ODbL, HOT's monthly export on HDX): used for tambons the 2012
  layer has no point in. A 2012 village with an OpenStreetMap village of the same name within
  `match_m` is marked public, named as OpenStreetMap names it.
"""

from __future__ import annotations

import csv
import re
import zipfile
from pathlib import Path

import numpy as np

from .classes import NAMES

ORDER = ("high", "medium", "low", "minimal")
CODES = {name: code for code, name in NAMES.items()}
PROVINCES = ("90", "94", "95", "96")
PROVINCE_NAMES = ("สงขลา", "ปัตตานี", "ยะลา", "นราธิวาส")


def fetch(urls: dict[str, str], dest: Path) -> dict[str, Path]:
    """Download the two sources once into dest (kept; delete to fetch again)."""
    import urllib.request

    dest.mkdir(parents=True, exist_ok=True)
    out = {}
    for key, url in urls.items():
        path = dest / Path(url).name
        if not path.exists():
            req = urllib.request.Request(url, headers={"User-Agent": "Jaga flood early-warning (non-profit)"})
            with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
                f.write(r.read())
        out[key] = path
    return out


def norm_name(name: str | None) -> str:
    """A village name for matching: no บ้าน prefix, no bracketed other name, no spaces."""
    s = re.sub(r"\(.*?\)", "", str(name or ""))
    s = re.sub(r"^\s*(บ้าน|บ\.)\s*", "", s)
    return re.sub(r"\s+", "", s)


def read_dopa2012(zip_path: Path) -> list[dict]:
    """Points of the 2012 layer in the four provinces: [{id, name_th, lon, lat}]."""
    import geopandas as gpd

    with zipfile.ZipFile(zip_path) as z:
        shp = next(n for n in z.namelist() if n.lower().endswith(".shp"))
    g = gpd.read_file(f"zip://{zip_path.as_posix()}!{shp}", encoding="utf-8")
    g = g[g["PRV_NAME"].isin(PROVINCE_NAMES)].to_crs(4326)
    return [{"id": f"v12:{int(r.MAIN_ID)}", "name_th": str(r.NAME).strip(), "name_en": None,
             "lon": float(r.geometry.x), "lat": float(r.geometry.y)} for r in g.itertuples()]


def read_osm(zip_path: Path, box: tuple[float, float, float, float]) -> list[dict]:
    """OpenStreetMap villages and hamlets inside box: [{id, name_th, name_en, lon, lat}]."""
    import geopandas as gpd

    with zipfile.ZipFile(zip_path) as z:
        gpkg = next(n for n in z.namelist() if n.endswith(".gpkg"))
    g = gpd.read_file(f"zip://{zip_path.as_posix()}!{gpkg}", bbox=box)
    g = g[g["place"].isin(["village", "hamlet"])].to_crs(4326)
    out = []
    for r in g.itertuples():
        name = r.name_th if isinstance(r.name_th, str) and r.name_th else r.name
        if not isinstance(name, str) or not name.strip():
            continue
        p = r.geometry.representative_point()
        out.append({"id": f"osm:{r.id}", "name_th": name.strip(),
                    "name_en": r.name_en if isinstance(r.name_en, str) and r.name_en else None,
                    "lon": float(p.x), "lat": float(p.y)})
    return out


def place_in_tambons(points: list[dict], tambons: list[dict]) -> None:
    """Sets point["tambon"] to the code of the tambon containing it (None outside all of them)."""
    import shapely

    tree = shapely.STRtree([t["geometry"] for t in tambons])
    geoms = shapely.points([p["lon"] for p in points], [p["lat"] for p in points])
    hit_point, hit_tambon = tree.query(geoms, predicate="within")
    for p in points:
        p["tambon"] = None
    for i, j in zip(hit_point, hit_tambon):
        points[i]["tambon"] = tambons[j]["code"]


def project(points: list[dict], crs: str) -> np.ndarray:
    from pyproj import Transformer

    t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    x, y = t.transform([p["lon"] for p in points], [p["lat"] for p in points])
    return np.column_stack([x, y])


def match_osm(dopa: list[dict], osm: list[dict], crs: str, match_m: float) -> int:
    """Marks 2012 villages that OpenStreetMap also has (same name, within match_m): public, with
    OpenStreetMap's names. Returns how many matched."""
    from scipy.spatial import cKDTree

    if not dopa or not osm:
        return 0
    tree = cKDTree(project(osm, crs))
    names = [norm_name(o["name_th"]) for o in osm]
    matched = 0
    for p, xy in zip(dopa, project(dopa, crs)):
        p["public"] = False
        key = norm_name(p["name_th"])
        for j in tree.query_ball_point(xy, match_m):
            if key and names[j] == key:
                p["public"], p["osm_id"] = True, osm[j]["id"]
                p["name_en"] = osm[j]["name_en"]
                matched += 1
                break
    return matched


def choose(dopa: list[dict], osm: list[dict]) -> list[dict]:
    """The village points the table uses: the 2012 layer's in every tambon it covers, else
    OpenStreetMap's. OpenStreetMap points are public."""
    covered = {p["tambon"] for p in dopa if p["tambon"]}
    out = [dict(p, source="dopa2012") for p in dopa if p["tambon"]]
    out += [dict(p, source="osm", public=True) for p in osm if p["tambon"] and p["tambon"] not in covered]
    return out


def summarise(villages: list[dict], tambons: list[dict], cls: np.ndarray, buildings: np.ndarray,
              transform, crs: str, cell_km2: float, index_window) -> list[dict]:
    """One row per village: land and buildings per class in its share of its tambon. Works one
    tambon window at a time so the whole grid never needs a second copy in memory.

    `index_window(tambon, rows, cols)` returns a boolean mask of the tambon's cells in that window."""
    from rasterio.windows import from_bounds
    from rasterio.warp import transform_bounds
    from scipy.spatial import cKDTree

    xy = project(villages, crs)
    by_tambon: dict[str, list[int]] = {}
    for i, v in enumerate(villages):
        by_tambon.setdefault(v["tambon"], []).append(i)
    rows = [None] * len(villages)
    for t in tambons:
        members = by_tambon.get(t["code"])
        if not members:
            continue
        w = from_bounds(*transform_bounds("EPSG:4326", crs, *t["geometry"].bounds), transform=transform)
        r0, c0 = max(int(np.floor(w.row_off)), 0), max(int(np.floor(w.col_off)), 0)
        r1 = min(int(np.ceil(w.row_off + w.height)) + 1, cls.shape[0])
        c1 = min(int(np.ceil(w.col_off + w.width)) + 1, cls.shape[1])
        inside = index_window(t, (r0, r1), (c0, c1))
        rr, cc = np.nonzero(inside)
        rr, cc = rr + r0, cc + c0
        x = transform.c + (cc + 0.5) * transform.a
        y = transform.f + (rr + 0.5) * transform.e
        _, nearest = cKDTree(xy[members]).query(np.column_stack([x, y]))
        c = cls[rr, cc]
        b = np.nan_to_num(buildings[rr, cc].astype("float64"))
        classed = c > 0
        for k, vi in enumerate(members):
            mine = (nearest == k) & classed
            row = {"land_km2": round(int(mine.sum()) * cell_km2, 3),
                   "buildings": int(round(float(b[mine].sum())))}
            for name in ORDER:
                sel = mine & (c == CODES[name])
                row[f"{name}_buildings"] = int(round(float(b[sel].sum())))
            # From the unrounded counts: rounding each class first can make the share pass 100 %.
            hm = float(b[mine & (c >= CODES["medium"])].sum())
            total = float(b[mine].sum())
            row["buildings_medium_or_high_pct"] = round(100 * hm / total, 1) if total >= 0.5 else None
            rows[vi] = row
    return rows


COLUMNS = ("land_km2", "buildings", "high_buildings", "medium_buildings", "low_buildings", "minimal_buildings",
           "buildings_medium_or_high_pct")


def write_csv(dest: Path, villages: list[dict], rows: list[dict], radar_run: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fields = ["id", "source", "public", "tambon_code", "name_th", "name_en", "lon", "lat", *COLUMNS, "radar_run"]
    with open(dest, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for v, r in zip(villages, rows):
            w.writerow({"id": v["id"], "source": v["source"], "public": v.get("public", False),
                        "tambon_code": v["tambon"], "name_th": v["name_th"], "name_en": v.get("name_en") or "",
                        "lon": round(v["lon"], 6), "lat": round(v["lat"], 6), **(r or {}), "radar_run": radar_run})


def _q(s: str | None) -> str:
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def seed_sql(villages: list[dict], rows: list[dict], radar_run: str) -> str:
    """The whole villages table, replaced in one go. Generated, never edited by hand."""
    lines = ["-- Generated by pipeline/hazard (`villages`). Do not edit by hand.",
             "-- Village points and the buildings per flood-hazard class around each (its share of its tambon).",
             "-- Points: the 2012 national village layer (teams and admins only; terms unknown) and",
             "-- OpenStreetMap (ODbL, (c) OpenStreetMap contributors). Buildings: Google Open Buildings",
             "-- (CC BY 4.0), estimates. Classes: not checked against observed floods.", "",
             "delete from public.villages;", "",
             "insert into public.villages (id, source, public, tambon_code, name_th, name_en, point, radar_run, "
             + ", ".join(COLUMNS) + ") values"]
    values = []
    for v, r in zip(villages, rows):
        r = r or {c: (0 if c != "buildings_medium_or_high_pct" else None) for c in COLUMNS}
        cells = ["null" if r[c] is None else repr(r[c]) for c in COLUMNS]
        values.append(f"  ({_q(v['id'])}, '{v['source']}', {str(bool(v.get('public'))).lower()}, '{v['tambon']}', "
                      f"{_q(v['name_th'])}, {_q(v.get('name_en'))}, "
                      f"extensions.st_setsrid(extensions.st_makepoint({v['lon']:.6f}, {v['lat']:.6f}), 4326), "
                      f"'{radar_run}', " + ", ".join(cells) + ")")
    return "\n".join(lines) + "\n" + ",\n".join(values) + ";\n"
