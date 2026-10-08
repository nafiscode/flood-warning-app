"""Buildings on the hazard grid, from Google's Open Buildings 2.5D Temporal rasters (CC BY 4.0).

Two bands at 30 m over the four provinces:
  presence   mean building presence in the cell, 0 to 1 (the share of the cell covered by buildings, roughly)
  count      buildings in the cell (the dataset's fractional count, summed over the cell)

Fetched tile by tile with interactive requests (no export task, a few minutes), from the newest year
the dataset has. Used for two things: the built-up mask, where the radar cannot see flooding, and the
share of buildings per hazard class in each tambon.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio

from sar_floods import ee_ops

log = logging.getLogger("hazard")
TILE = 1024


def fetch(cfg: dict, transform, shape: tuple[int, int], crs: str, dest: Path) -> dict:
    """Write the two-band raster for the grid given by `transform` and `shape` (rows, cols)."""
    ee = ee_ops.ee()
    b = cfg["buildings"]
    year = ee.ImageCollection(b["asset"]).filterDate(f"{b['year']}-01-01", f"{b['year'] + 1}-01-01")
    native = b["native_scale_m"]
    image = ee.Image.cat(
        year.select(b["presence_band"]).mosaic().unmask(0).rename("presence"),
        # The fractional count is per native pixel; averaged over a cell by the pyramid, so times the
        # number of native pixels in a cell gives buildings per cell.
        year.select(b["count_band"]).mosaic().unmask(0).multiply((transform.a / native) ** 2).rename("count")).toFloat()
    rows, cols = shape
    out = np.zeros((2, rows, cols), dtype="float32")
    for r0 in range(0, rows, TILE):
        for c0 in range(0, cols, TILE):
            h, w = min(TILE, rows - r0), min(TILE, cols - c0)
            x, y = transform * (c0, r0)
            tile = ee.data.computePixels({"expression": image, "fileFormat": "NUMPY_NDARRAY", "grid": {
                "dimensions": {"width": w, "height": h}, "crsCode": crs,
                "affineTransform": {"scaleX": transform.a, "shearX": 0, "translateX": x, "shearY": 0,
                                    "scaleY": transform.e, "translateY": y}}})
            out[0, r0:r0 + h, c0:c0 + w] = tile["presence"]
            out[1, r0:r0 + h, c0:c0 + w] = tile["count"]
        log.info("buildings: rows %d to %d of %d", r0, min(r0 + TILE, rows), rows)
    dest.parent.mkdir(parents=True, exist_ok=True)
    profile = dict(driver="GTiff", dtype="float32", count=2, width=cols, height=rows, crs=crs, transform=transform,
                   compress="deflate", tiled=True, blockxsize=512, blockysize=512)
    with rasterio.open(dest, "w", **profile) as dst:
        dst.write(out)
        dst.set_band_description(1, "presence")
        dst.set_band_description(2, "count")
        dst.update_tags(source=b["asset"], year=str(b["year"]), licence="CC BY 4.0", credit=b["attribution"])
    return {"buildings": float(out[1].sum()), "cells_with_buildings": int((out[0] > 0.05).sum())}
