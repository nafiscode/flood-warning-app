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
from rasterio.warp import Resampling, calculate_default_transform, reproject

log = logging.getLogger("hazard")
NODATA = -32768.0


def to_working_grid(src_path: Path, dst_path: Path, crs: str, scale: int, sea_level_m: float | None = None) -> dict:
    """Reproject the DEM to the working CRS at `scale` metres, origin snapped to whole cells.
    Cells at or below `sea_level_m` become nodata (FABDEM stores the sea as 0), so that streams
    end at the coast."""
    with rasterio.open(src_path) as src:
        transform, width, height = calculate_default_transform(src.crs, crs, src.width, src.height, *src.bounds,
                                                               resolution=scale)
        west = np.floor(transform.c / scale) * scale
        north = np.ceil(transform.f / scale) * scale
        transform = rasterio.Affine(scale, 0, west, 0, -scale, north)
        data = np.full((height + 1, width + 1), NODATA, dtype="float32")
        reproject(rasterio.band(src, 1), data, src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                  dst_transform=transform, dst_crs=crs, dst_nodata=NODATA, resampling=Resampling.bilinear)
    if sea_level_m is not None:
        data[(data != NODATA) & (data <= sea_level_m)] = NODATA
    profile = dict(driver="GTiff", dtype="float32", count=1, width=data.shape[1], height=data.shape[0], crs=crs,
                   transform=transform, nodata=NODATA, compress="deflate", predictor=3, tiled=True,
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
