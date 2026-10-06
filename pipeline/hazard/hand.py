"""HAND (height above nearest drainage) from the DEM, with WhiteboxTools. Local, no Earth Engine.

Chain, one GeoTIFF per step in <output_dir>/work/:
  dem_utm        the source DEM on the working grid (UTM, 30 m, bilinear); sea and missing cells = nodata
  dem_breached   depressions removed by least-cost breaching (cuts through dams and road embankments
                 instead of flooding the valley behind them), then filled where a breach was too costly
  d8_pointer     D8 flow direction
  d8_accum       contributing area in cells
  streams_<n>    cells with at least n contributing cells
  hand_<n>       elevation above the stream cell each cell drains to

The stream threshold n is not fixed here: `run` makes one streams/HAND pair per candidate and
`compare.py` scores each network against mapped rivers.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio import features
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_geom
from rasterio.warp import transform as warp_transform

log = logging.getLogger("hazard")
NODATA = -32768.0


def to_working_grid(src_path: Path, dst_path: Path, crs: str, scale: int, sea_value_m: float | None = None,
                    bbox_deg: list[float] | None = None) -> dict:
    """Reproject the DEM (all of it, or the part inside `bbox_deg`) to the working CRS at `scale`
    metres, origin snapped to whole cells.
    Source cells that are missing or exactly `sea_value_m` become nodata, so that streams end at the
    coast. FABDEM stores the sea and Songkhla Lake as exactly 0 and all-sea tiles as missing; land
    below sea level (a few thousand cells, pits down to -57 m) is kept, or it would act as an outlet."""
    with rasterio.open(src_path) as src:
        window = from_bounds(*bbox_deg, src.transform).round_offsets().round_lengths() if bbox_deg else None
        source = src.read(1, window=window)
        src_transform = src.window_transform(window) if window else src.transform
        bounds = rasterio.transform.array_bounds(*source.shape, src_transform)
        sea = np.isnan(source)
        if src.nodata is not None:
            sea |= source == src.nodata
        if sea_value_m is not None:
            sea |= source == sea_value_m
        source[sea] = NODATA
        del sea
        transform, width, height = calculate_default_transform(src.crs, crs, source.shape[1], source.shape[0], *bounds,
                                                               resolution=scale)
        west = np.floor(transform.c / scale) * scale
        north = np.ceil(transform.f / scale) * scale
        transform = rasterio.Affine(scale, 0, west, 0, -scale, north)
        data = np.full((height + 1, width + 1), NODATA, dtype="float32")
        reproject(source, data, src_transform=src_transform, src_crs=src.crs, src_nodata=NODATA,
                  dst_transform=transform, dst_crs=crs, dst_nodata=NODATA, resampling=Resampling.bilinear)
    del source
    # No floating-point predictor: WhiteboxTools' GeoTIFF reader does not support PREDICTOR=3.
    profile = dict(driver="GTiff", dtype="float32", count=1, width=data.shape[1], height=data.shape[0], crs=crs,
                   transform=transform, nodata=NODATA, compress="deflate", tiled=True,
                   blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER")
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dst_path, "w", **profile) as dst:
        dst.write(data, 1)
    valid = data != NODATA
    return {"width": int(data.shape[1]), "height": int(data.shape[0]), "transform": list(transform)[:6],
            "valid_cells": int(valid.sum()), "min_m": float(data[valid].min()), "max_m": float(data[valid].max())}


def _wbt(work: Path):
    import whitebox

    wbt = whitebox.WhiteboxTools()
    wbt.set_working_dir(str(work))
    wbt.set_verbose_mode(False)
    wbt.set_compress_rasters(True)
    return wbt


def _run(step: str, code: int, out: Path) -> None:
    if code != 0 or not out.exists():
        raise RuntimeError(f"WhiteboxTools step '{step}' failed (exit {code}, output {'present' if out.exists() else 'missing'}).")
    log.info("%s -> %s", step, out.name)


def condition(work: Path, breach_dist_cells: int, breach_max_cost: float | None, force: bool = False) -> None:
    """dem_utm.tif -> dem_breached.tif, d8_pointer.tif, d8_accum.tif (skipped if already there)."""
    wbt = _wbt(work)
    breached, filled = work / "dem_breach_only.tif", work / "dem_breached.tif"
    if force or not filled.exists():
        _run("breach depressions (least cost)",
             wbt.breach_depressions_least_cost("dem_utm.tif", breached.name, dist=breach_dist_cells,
                                               max_cost=breach_max_cost, min_dist=True, fill=False), breached)
        _run("fill remaining depressions", wbt.fill_depressions(breached.name, filled.name, fix_flats=True), filled)
        breached.unlink()
    pointer, accum = work / "d8_pointer.tif", work / "d8_accum.tif"
    if force or not pointer.exists():
        _run("D8 flow direction", wbt.d8_pointer(filled.name, pointer.name), pointer)
    if force or not accum.exists():
        _run("D8 flow accumulation", wbt.d8_flow_accumulation(pointer.name, accum.name, out_type="cells",
                                                             pntr=True), accum)


# WhiteboxTools D8 pointer value -> (row step, column step). 0 and nodata: the path ends.
D8_STEPS = {1: (-1, 1), 2: (0, 1), 4: (1, 1), 8: (1, 0), 16: (1, -1), 32: (0, -1), 64: (-1, -1), 128: (-1, 0)}


def downslope_paths(pointer: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """Cells on the D8 flow paths that start at the seed cells (seeds included)."""
    step_r, step_c = np.zeros(256, dtype="int64"), np.zeros(256, dtype="int64")
    for value, (dr, dc) in D8_STEPS.items():
        step_r[value], step_c[value] = dr, dc
    code = np.where((pointer > 0) & (pointer < 256), pointer, 0).astype("uint8")
    visited = np.zeros(pointer.shape, dtype=bool)
    rows, cols = np.nonzero(seeds)
    while rows.size:
        visited[rows, cols] = True
        c = code[rows, cols]
        moving = c > 0
        rows, cols = rows[moving] + step_r[c[moving]], cols[moving] + step_c[c[moving]]
        inside = (rows >= 0) & (rows < pointer.shape[0]) & (cols >= 0) & (cols < pointer.shape[1])
        rows, cols = rows[inside], cols[inside]
        fresh = ~visited[rows, cols]
        flat = np.unique(rows[fresh] * pointer.shape[1] + cols[fresh])
        rows, cols = flat // pointer.shape[1], flat % pointer.shape[1]
    return visited


def edge_check(work: Path, bbox_deg: list[float], area_geometry: dict, margin_deg: float = 0.001) -> dict:
    """Does water from the edge of the computed window reach the area? If it does, a catchment of the
    area is cut by the window and its streams and HAND are wrong there.

    Every land cell on the window's edge is followed down the D8 flow directions; the result counts
    the cells of those flow paths that fall inside `area_geometry` (EPSG:4326). 0 means no cut."""
    with rasterio.open(work / "dem_utm.tif") as src:
        valid = src.read(1) != src.nodata
        crs, transform = src.crs, src.transform
    rim = valid.copy()
    rim[1:-1, 1:-1] &= ~(valid[:-2, 1:-1] & valid[2:, 1:-1] & valid[1:-1, :-2] & valid[1:-1, 2:])
    rows, cols = np.nonzero(rim)
    xs, ys = rasterio.transform.xy(transform, rows, cols)
    lon, lat = warp_transform(crs, "EPSG:4326", xs, ys)
    lon, lat = np.asarray(lon), np.asarray(lat)
    w, s, e, n = bbox_deg
    on_edge = (lon < w + margin_deg) | (lon > e - margin_deg) | (lat < s + margin_deg) | (lat > n - margin_deg)
    seeds = np.zeros(valid.shape, dtype=bool)
    seeds[rows[on_edge], cols[on_edge]] = True
    with rasterio.open(work / "d8_pointer.tif") as src:
        reached = downslope_paths(src.read(1), seeds)
    area = features.rasterize([transform_geom("EPSG:4326", crs.to_string(), area_geometry)], out_shape=valid.shape,
                              transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)
    return {"edge_land_cells": int(on_edge.sum()), "path_cells": int(reached.sum()),
            "path_cells_in_area": int((reached & area).sum())}


def hand_for_threshold(work: Path, threshold_cells: int, force: bool = False) -> tuple[Path, Path]:
    """streams_<n>.tif and hand_<n>.tif for one stream threshold."""
    wbt = _wbt(work)
    streams, hand = work / f"streams_{threshold_cells}.tif", work / f"hand_{threshold_cells}.tif"
    if force or not streams.exists():
        _run(f"streams, {threshold_cells} cells",
             wbt.extract_streams("d8_accum.tif", streams.name, threshold=threshold_cells, zero_background=False), streams)
    if force or not hand.exists():
        _run(f"HAND, {threshold_cells} cells",
             wbt.elevation_above_stream("dem_breached.tif", streams.name, hand.name), hand)
    return streams, hand
