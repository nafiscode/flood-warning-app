"""The processing area: the four provinces as one simplified outline, stored in aoi.geojson.

Earth Engine gets the area as inline GeoJSON, so no asset has to be uploaded. The outline is built
from the detailed province geometry in supabase/seed/10_provinces.sql (written by admin_boundaries):
union, buffered outwards by ~1.1 km, then simplified by ~550 m. Simplifying can only pull the line in
by its tolerance, which is half the buffer, so the outline always contains the provinces; the
strip of sea and neighbouring land it adds is harmless (rasters are for use inside the provinces).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from ingest_thaiwater.settings import REPO_DIR

from .settings import AOI_PATH, PACKAGE_DIR

SEED_SQL = REPO_DIR / "supabase" / "seed" / "10_provinces.sql"
JS_PATH = PACKAGE_DIR / "code_editor" / "sar_floods.js"
BUFFER_DEG = 0.01       # ~1.1 km
SIMPLIFY_DEG = 0.005    # ~550 m
DECIMALS = 4            # ~11 m
JS_BEGIN, JS_END = "// AOI-BEGIN (written by `python -m sar_floods aoi`; do not edit)", "// AOI-END"

_ROW = re.compile(r"^\s*\('(\d{2})', .*?st_geomfromtext\('([^']+)', 4326\)")


def province_geometries(codes, sql_path: Path = SEED_SQL) -> dict:
    """Detailed geometry (the first geometry column, 'geom') of the given provinces from the seed SQL."""
    import shapely

    found = {}
    with open(sql_path, encoding="utf-8") as f:
        for line in f:
            m = _ROW.match(line)
            if m and m[1] in codes:
                found[m[1]] = shapely.from_wkt(m[2])
    missing = sorted(set(codes) - set(found))
    if missing:
        raise SystemExit(f"Provinces {missing} not found in {sql_path.name}. Run admin_boundaries first.")
    return found


def build_outline(geometries):
    """Union, buffer, simplify, drop holes, round. Returns a shapely Polygon or MultiPolygon."""
    import shapely
    from shapely.geometry import MultiPolygon, Polygon

    union = shapely.union_all(list(geometries))
    outline = union.buffer(BUFFER_DEG).simplify(SIMPLIFY_DEG, preserve_topology=True)
    parts = outline.geoms if outline.geom_type == "MultiPolygon" else [outline]
    filled = [Polygon(p.exterior) for p in parts]
    outline = filled[0] if len(filled) == 1 else MultiPolygon(filled)
    outline = shapely.make_valid(shapely.set_precision(outline, 10**-DECIMALS))
    if not outline.contains(union):
        raise SystemExit("The simplified outline no longer contains the provinces; lower SIMPLIFY_DEG.")
    return outline


def geometry_json(geometry: dict) -> str:
    return json.dumps(geometry, separators=(",", ":"))


def write(cfg: dict, path: Path = AOI_PATH, js_path: Path = JS_PATH) -> dict:
    import shapely

    outline = build_outline(province_geometries(set(cfg["provinces"])).values())
    geometry = json.loads(shapely.to_geojson(outline))
    feature = {"type": "Feature", "geometry": geometry, "properties": {
        "provinces": dict(sorted(cfg["provinces"].items())),
        "source": "Royal Thai Survey Department via OCHA HDX COD-AB Thailand (CC BY-IGO), "
                  "from supabase/seed/10_provinces.sql. Simplified for Jaga; not an official boundary.",
        "buffer_deg": BUFFER_DEG, "simplify_deg": SIMPLIFY_DEG}}
    text = json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text + "\n", encoding="utf-8", newline="\n")
    if js_path.exists():   # keep the Code Editor script on the same outline
        js = js_path.read_text(encoding="utf-8")
        a, b = js.index(JS_BEGIN), js.index(JS_END)
        js = js[:a] + JS_BEGIN + "\nvar AOI_GEOJSON = " + geometry_json(geometry) + ";\n" + js[b:]
        js_path.write_text(js, encoding="utf-8", newline="\n")
    return feature


def load(path: Path = AOI_PATH) -> dict:
    """The outline as a GeoJSON geometry dict."""
    return json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"]


def bounds(geometry: dict) -> tuple[float, float, float, float]:
    from shapely.geometry import shape

    return shape(geometry).bounds
