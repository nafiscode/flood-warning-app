"""The land a rise in the Pattani River can reach below Bang Lang dam (S7 step 3, done properly).

The interim path (build.py) says where the river runs. This says how far to its sides the water
can spread when the river stands higher, from the elevation model, and checks that against what the
radar saw in the season of the one large release on record (6-11 January 2021).

Method, in the order the functions run:

1. The river's own surface. The elevation model along the mapped channel is noisy (a 30 m cell is
   often bank, not water), so the surface is a low percentile of the heights on and beside the line
   in each stretch of river, made to fall towards the sea. The model must be the unburned one: the
   hazard module's routing copy has the rivers cut 10 m into it.
2. Height above the river. Every land cell takes the surface height of the river cell nearest to
   it; its own height minus that is how far the river must rise to stand level with it.
3. How high the river has stood. At each gauge on the main stem, the highest level in the
   archive (a six-hour median, so one bad reading cannot set it) minus the river surface of step 1
   at that point: the rise the river has actually shown there. Between gauges the rise goes by
   river distance. It is about four metres at Yala and about one at the coast.
4. The zone: the cells whose height above the river is no more than that rise, within a set
   distance of the channel, that are joined to the channel through other such cells. The outer
   band is the same with a metre added. A low field
   behind a ridge is left out; the lower valley of a side stream is taken in, which is the
   backwater the interim path drew as "the lowest 5 km of each tributary".
5. The check. For the zone, and for a set of uniform rises beside it, the share of the radar's flood inside the corridor that the zone holds,
   and how much of the zone the radar saw wet.

It is a level-pool reading of a 30 m elevation model. It is not a hydraulic model: it knows nothing
of how much water, for how long, or of embankments and bridges narrower than a cell. It answers
"which land is low enough and joined to the river", and nothing about depth or timing.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

RADAR_FLOOD = (1, 3)        # the VV rule (sar_floods METHODS.md)
RADAR_SEEN = (0, 1, 2, 3)   # observed land, dry or wet


def river_surface(chain_m: np.ndarray, height: np.ndarray, length_m: float, bin_m: float,
                  low_percentile: float) -> tuple[np.ndarray, np.ndarray]:
    """The river's surface as (chainage of bin centres, height), falling towards the sea.

    chain_m, height: the cells near the channel. Bins without cells are filled from their
    neighbours before the running minimum is taken.
    """
    n = max(1, int(math.ceil(length_m / bin_m)))
    which = np.clip((chain_m // bin_m).astype(int), 0, n - 1)
    surf = np.full(n, np.nan)
    for b in np.unique(which):
        surf[b] = np.percentile(height[which == b], low_percentile)
    centres = (np.arange(n) + 0.5) * bin_m
    known = ~np.isnan(surf)
    if not known.any():
        raise ValueError("no elevation along the river")
    surf = np.interp(centres, centres[known], surf[known])
    return centres, falling(surf)


def falling(values: np.ndarray) -> np.ndarray:
    """The closest series to `values` that never rises (pool adjacent violators).

    A running minimum would let one pit in the elevation model lower the whole river below it;
    this spreads a violation over the stretch that holds it.
    """
    sums, counts = [], []
    for v in values:
        sums.append(float(v))
        counts.append(1)
        while len(sums) > 1 and sums[-2] / counts[-2] < sums[-1] / counts[-1]:
            s, c = sums.pop(), counts.pop()
            sums[-1] += s
            counts[-1] += c
    return np.concatenate([np.full(c, s / c) for s, c in zip(sums, counts)])


def height_above_river(dem: np.ndarray, river: np.ndarray, river_chain_m: np.ndarray,
                       centres: np.ndarray, surface: np.ndarray, cell_m: float):
    """(height above the river, distance to it in metres, chainage of the nearest river cell).

    dem: NaN where there is no land. river: boolean. river_chain_m: chainage on river cells.
    """
    from scipy import ndimage

    dist, (ir, ic) = ndimage.distance_transform_edt(~river, return_indices=True)
    chain = river_chain_m[ir, ic]
    level = np.interp(chain, centres, surface)
    return dem - level, dist * cell_m, chain


def recorded_rise(gauges: list[dict], centres: np.ndarray, surface: np.ndarray, min_rise_m: float):
    """(chainage, rise) to interpolate along the river, from each gauge's highest recorded level.

    gauges: [{chain_m, peak_m}]. The rise is floored: in the gorge below the dam the elevation
    model's "river surface" is partly bank and can stand above the gauge's own highest water.
    """
    pts = sorted((g["chain_m"], max(min_rise_m, g["peak_m"] - float(np.interp(g["chain_m"], centres, surface))))
                 for g in gauges)
    if not pts:
        raise ValueError("no gauge with a recorded level")
    return np.array([p[0] for p in pts]), np.array([p[1] for p in pts])


def zone(har: np.ndarray, dist_m: np.ndarray, river: np.ndarray, rise_m, max_dist_m: float) -> np.ndarray:
    """Cells within reach of a rise of `rise_m` (a number, or one per cell), joined to the river."""
    from scipy import ndimage

    low = ((har <= rise_m) & (dist_m <= max_dist_m)) | river
    low &= ~np.isnan(har) | river
    labels, _ = ndimage.label(low, structure=np.ones((3, 3), bool))
    keep = np.unique(labels[river])
    return np.isin(labels, keep[keep > 0])


def check(zone_mask: np.ndarray, flood: np.ndarray, seen: np.ndarray, corridor: np.ndarray, cell_km2: float) -> dict:
    """How a zone sits against one radar map inside the corridor."""
    flood_in = flood & corridor
    seen_zone = zone_mask & seen
    return {
        "zone_km2": round(float(zone_mask.sum()) * cell_km2, 1),
        "radar_flood_in_corridor_km2": round(float(flood_in.sum()) * cell_km2, 1),
        "flood_held_pct": round(100 * float((flood_in & zone_mask).sum()) / max(1, int(flood_in.sum())), 1),
        "zone_seen_wet_pct": round(100 * float((seen_zone & flood).sum()) / max(1, int(seen_zone.sum())), 1),
    }


def by_tambon(index: np.ndarray, n: int, inner: np.ndarray, outer: np.ndarray, chain_m: np.ndarray,
              buildings: np.ndarray | None, land: np.ndarray, cell_km2: float) -> list[dict | None]:
    """Per tambon position 1..n: area and buildings inside the zone, and where along the river.

    None for a tambon with nothing in the outer zone.
    """
    rows: list[dict | None] = []
    idx = index.ravel()
    b = None if buildings is None else np.nan_to_num(buildings.ravel().astype("float64"))
    land_cells = np.bincount(idx[land.ravel()], minlength=n + 1)
    counts = {}
    for name, mask in (("zone", inner), ("outer", outer)):
        m = mask.ravel() & land.ravel()
        counts[name] = (np.bincount(idx[m], minlength=n + 1),
                        None if b is None else np.bincount(idx, weights=np.where(m, b, 0.0), minlength=n + 1))
    km = np.full(n + 1, np.inf)
    m = outer.ravel()
    np.minimum.at(km, idx[m], chain_m.ravel()[m] / 1000.0)
    for i in range(1, n + 1):
        if counts["outer"][0][i] == 0:
            rows.append(None)
            continue
        row = {"km_from_dam": round(float(km[i]), 1), "land_km2": round(int(land_cells[i]) * cell_km2, 2)}
        for name in ("zone", "outer"):
            cells, built = counts[name]
            row[f"{name}_km2"] = round(int(cells[i]) * cell_km2, 2)
            row[f"{name}_pct_of_tambon"] = round(100 * int(cells[i]) / max(1, int(land_cells[i])), 1)
            row[f"{name}_buildings"] = None if built is None else int(round(float(built[i])))
        rows.append(row)
    return rows


def polygons(mask: np.ndarray, transform, crs: str, simplify_m: float, min_km2: float) -> list[dict]:
    """The zone as GeoJSON geometries in longitude and latitude."""
    import shapely
    from rasterio import features
    from rasterio.warp import transform_geom

    out = []
    for geom, value in features.shapes(mask.astype("uint8"), mask=mask, transform=transform, connectivity=8):
        if not value:
            continue
        shape = shapely.geometry.shape(geom)
        if shape.area < min_km2 * 1e6:
            continue
        shape = shape.simplify(simplify_m)
        out.append(transform_geom(crs, "EPSG:4326", shapely.geometry.mapping(shape), precision=6))
    return out


def write_csv(path: Path, tambons: list[dict], rows: list[dict | None], interim: dict[str, str]) -> int:
    kept = [(t, r) for t, r in zip(tambons, rows) if r is not None]
    kept.sort(key=lambda tr: (tr[1]["km_from_dam"], tr[0]["code"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["tambon_code", "name_th", "name_en", *kept[0][1].keys(), "on_interim_path"]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for t, r in kept:
            w.writerow({"tambon_code": t["code"], "name_th": t["name_th"], "name_en": t["name_en"], **r,
                        "on_interim_path": interim.get(t["code"], "")})
    return len(kept)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(dam: dict, zcfg: dict, gauges: list[dict], tidy_dir: Path, out: Path, pipeline_dir: Path) -> dict:
    """Build the zone for one dam from the files the hazard and radar modules left on disk."""
    import rasterio
    import shapely
    from pyproj import Transformer
    from rasterio import features
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import from_bounds
    from scipy import ndimage
    from shapely.ops import transform as shp_transform

    from hazard import tambons as tb

    from .travel import read_hourly

    reach = json.loads((out / "geojson" / f"{dam['code']}_reach.geojson").read_text(encoding="utf-8"))
    parts = {f["properties"]["kind"]: f["geometry"]["coordinates"] for f in reach["features"]}
    coords = list(parts.get("outlet", [])) + list(parts["main"])
    max_dist = float(zcfg["max_distance_km"]) * 1000.0

    with rasterio.open(pipeline_dir / zcfg["dem"]) as src:
        crs = src.crs.to_string()
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        line = shp_transform(to_grid, shapely.LineString(coords))
        x0, y0, x1, y1 = line.buffer(max_dist + 300).bounds
        window = from_bounds(x0, y0, x1, y1, src.transform).round_offsets().round_lengths()
        window = window.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        dem = src.read(1, window=window).astype("float32")
        dem[dem == src.nodata] = np.nan
        transform = src.window_transform(window)
        cell = float(src.res[0])
    shape = dem.shape
    cell_km2 = cell * cell / 1e6

    river = features.rasterize([(shapely.geometry.mapping(line), 1)], out_shape=shape, transform=transform,
                               all_touched=True, dtype="uint8").astype(bool)
    rows, cols = np.nonzero(river)
    xs, ys = rasterio.transform.xy(transform, rows, cols)
    river_chain = np.zeros(shape, "float32")
    river_chain[rows, cols] = [line.project(shapely.Point(x, y)) for x, y in zip(xs, ys)]

    # Heights near the channel, for the river's own surface.
    near = ndimage.binary_dilation(river, iterations=int(zcfg["surface"]["within_cells"])) & ~np.isnan(dem)
    _, (ir, ic) = ndimage.distance_transform_edt(~river, return_indices=True)
    centres, surface = river_surface(river_chain[ir, ic][near], dem[near], line.length,
                                     float(zcfg["surface"]["bin_m"]), float(zcfg["surface"]["low_percentile"]))
    har, dist_m, chain = height_above_river(dem, river, river_chain, centres, surface, cell)
    corridor = (dist_m <= max_dist) & ~np.isnan(dem)

    def radar(path: str) -> tuple[np.ndarray, np.ndarray]:
        dst = np.full(shape, 255, "uint8")
        with rasterio.open(pipeline_dir / path) as r:
            reproject(rasterio.band(r, 1), dst, dst_transform=transform, dst_crs=crs, dst_nodata=255,
                      resampling=Resampling.nearest)
        return np.isin(dst, RADAR_FLOOD), np.isin(dst, RADAR_SEEN)

    maps = {name: radar(path) for name, path in zcfg["radar"].items()}
    curve = []
    for rise in zcfg["rises_m"]:
        z = zone(har, dist_m, river, float(rise), max_dist)
        curve.append({"rise_m": rise, **{name: check(z, f, s, corridor, cell_km2) for name, (f, s) in maps.items()}})

    fs = zcfg["flood_surface"]
    wanted = {g["code"]: g for g in gauges if g["code"] in fs["gauges"]}
    found = []
    for code in fs["gauges"]:
        g = wanted[code]
        level = read_hourly(tidy_dir, "water_level_msl", int(g["id"])).dropna()
        if g.get("max_level_m") is not None:
            level = level[level < float(g["max_level_m"])]
        level = level.rolling(f"{int(fs['smooth_h'])}h").median()
        if level.empty:
            continue
        chain_g = float(line.project(shapely.Point(to_grid(*g["point"]))))
        found.append({"code": code, "place": g["place"], "chain_m": chain_g, "peak_m": float(level.max()),
                      "peak_at": level.idxmax().isoformat(),
                      "river_surface_m": float(np.interp(chain_g, centres, surface))})
    rise_at, rise = recorded_rise(found, centres, surface, float(fs["min_rise_m"]))
    limit = np.interp(chain, rise_at, rise).astype("float32")
    extra = float(fs["outer_extra_m"])
    inner = zone(har, dist_m, river, limit, max_dist)
    outer = zone(har, dist_m, river, limit + extra, max_dist)
    chosen = {name: {"zone": check(inner, f, s, corridor, cell_km2), "outer": check(outer, f, s, corridor, cell_km2)}
              for name, (f, s) in maps.items()}
    # Land is what lies inside a tambon. The elevation model gives the tidal flats of Pattani Bay
    # a height of a metre or so, and they are not anybody's land.
    tambons = tb.tambon_geometries()
    index = tb.index_raster(tambons, crs, transform, shape)
    land = ~np.isnan(dem) & (index > 0)
    inner &= land | river
    outer &= land | river

    buildings = None
    if zcfg.get("buildings") and (pipeline_dir / zcfg["buildings"]).exists():
        buildings = np.zeros(shape, "float32")
        with rasterio.open(pipeline_dir / zcfg["buildings"]) as r:
            reproject(rasterio.band(r, 2), buildings, dst_transform=transform, dst_crs=crs,
                      resampling=Resampling.nearest)

    per = by_tambon(index, len(tambons), inner, outer, chain, buildings, land, cell_km2)
    interim = {}
    arrivals = out / "arrival_by_tambon.csv"
    if arrivals.exists():
        with open(arrivals, encoding="utf-8") as f:
            interim = {r["tambon_code"]: r["via"] for r in csv.DictReader(f)}
    kept = write_csv(out / "zone_by_tambon.csv", tambons, per, interim)

    profile = {"driver": "GTiff", "height": shape[0], "width": shape[1], "count": 2, "dtype": "float32",
               "crs": crs, "transform": transform, "nodata": -9999.0, "compress": "deflate", "tiled": True}
    with rasterio.open(out / f"{dam['code']}_zone.tif", "w", **profile) as dst:
        cls = np.where(inner, 1.0, np.where(outer, 2.0, 0.0)).astype("float32")
        cls[~land & ~river] = -9999.0
        dst.write(cls, 1)
        dst.write(np.where(corridor, har, -9999.0).astype("float32"), 2)
        dst.set_band_description(1, "zone (1 inner, 2 outer)")
        dst.set_band_description(2, "height above the river, m")

    feats = []
    for name, mask, label in (("zone", inner, "recorded"), ("outer", outer & ~inner, f"recorded + {extra:g} m")):
        for geom in polygons(mask, transform, crs, float(zcfg["simplify_m"]), float(zcfg["min_patch_km2"])):
            feats.append({"type": "Feature", "geometry": geom,
                          "properties": {"dam": dam["code"], "layer": name, "rise": label, "source": "s7"}})
    (out / "geojson" / f"{dam['code']}_zone.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")

    names = {t["code"]: t["name_en"] for t in tambons}
    in_zone = {t["code"] for t, r in zip(tambons, per) if r and r["zone_km2"] > 0}
    built = None if buildings is None else np.nan_to_num(buildings)
    summary = {
        "dam": dam["code"], "source": "s7", "outer_extra_m": extra, "min_rise_m": fs["min_rise_m"],
        "gauges": [{**g, "km_from_dam": round(g["chain_m"] / 1000, 1), "peak_m": round(g["peak_m"], 2),
                    "river_surface_m": round(g["river_surface_m"], 2),
                    "rise_m": round(float(np.interp(g["chain_m"], rise_at, rise)), 2)} for g in found],
        "against_radar": chosen,
        "max_distance_km": zcfg["max_distance_km"], "cell_m": cell,
        "river_surface_m": {"at_dam": round(float(surface[0]), 1), "at_mouth": round(float(surface[-1]), 1)},
        "zone_km2": round(float((inner & land).sum()) * cell_km2, 1),
        "outer_km2": round(float((outer & land).sum()) * cell_km2, 1),
        "zone_buildings": None if built is None else int(round(float(built[inner & land].sum()))),
        "outer_buildings": None if built is None else int(round(float(built[outer & land].sum()))),
        "tambons_in_outer": kept, "tambons_in_zone": len(in_zone),
        "interim_tambons": len(interim),
        "interim_not_in_zone": [f"{c} {names.get(c, '')}" for c in sorted(set(interim) - in_zone)],
        "zone_not_on_interim": [f"{c} {names.get(c, '')}" for c in sorted(in_zone - set(interim))],
        "curve": curve,
    }
    write_json(out / "zone.json", summary)
    return summary
