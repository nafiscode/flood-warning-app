"""The per-event raster built locally from the downloaded per-scene rasters. No Earth Engine.

For the Nov-Dec 2025 event the Earth Engine event export cost 54 of 130 EECU-hours, and its flood
pixels and counts were exactly what the 19 scene files give (METHODS.md). So events are now exported
scene by scene and combined here.

Per pixel, over the scene files of the event's used passes:
  n_valid    scenes with a valid observation (codes 0-3)
  n_flooded  scenes flooded by the configured flood rule
  extent     VV bit + 2 x VH bit over all scenes where n_valid > 0; otherwise 251 if any scene shows
             permanent water, 250 if any scene shows masked ground, else 255

One difference from the Earth Engine event raster: a pixel that is never valid because every pass
that sees it has it in layover or shadow is 250 here (the scene files say so) and was 255 there.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from . import naming, runlog
from .frequency import BLOCK, FrequencyError
from .grid import Grid
from .settings import MAX_PASSES_PER_EVENT

log = logging.getLogger("sar_floods")
RULES = {"vv": lambda vv, vh: vv, "vh": lambda vv, vh: vh, "vv_or_vh": lambda vv, vh: vv | vh,
         "vv_and_vh": lambda vv, vh: vv & vh}


def used_passes(runs_dir: Path, event_id: str, scale: int, params_hash: str) -> list[str]:
    """Pass ids the latest real run of this event used, at this scale and with these parameters."""
    for rl in reversed(runlog.all_runs(runs_dir)):
        d = rl.data
        if (d["event"]["id"] == event_id and not d["dry_run"] and d.get("purpose") != "reference assets"
                and d["params_hash"] == params_hash and d["config"]["export"]["scale_m"] == scale):
            return [p["pass_id"] for p in d["passes"] if p["status"] == "used"]
    raise FrequencyError(f"No run of {event_id} at {scale} m with parameters {params_hash}. Run it first.")


def scene_files(drive_dir: Path, pass_ids: list[str], scale: int, params_hash: str) -> list[Path]:
    paths = [drive_dir / (naming.scene_name(p, scale, params_hash) + ".tif") for p in pass_ids]
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        raise FrequencyError(f"{len(missing)} of {len(paths)} scene files are not downloaded, e.g. {missing[0]}. "
                             "Wait for the exports and run `sar_floods download`.")
    return paths


def combine(codes: list[np.ndarray], flood_rule: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(extent, n_valid, n_flooded) for one window from the scenes' extent codes (255 where a scene has none)."""
    shape = codes[0].shape
    n_valid, n_flooded = np.zeros(shape, dtype=np.uint8), np.zeros(shape, dtype=np.uint8)
    any_vv, any_vh = np.zeros(shape, dtype=bool), np.zeros(shape, dtype=bool)
    water, masked = np.zeros(shape, dtype=bool), np.zeros(shape, dtype=bool)
    for code in codes:
        valid = code <= 3
        vv, vh = valid & (code & 1 == 1), valid & (code & 2 == 2)
        n_valid += valid
        n_flooded += RULES[flood_rule](vv, vh)
        any_vv |= vv
        any_vh |= vh
        water |= code == 251
        masked |= code == 250
    extent = any_vv.astype(np.uint8) + 2 * any_vh.astype(np.uint8)
    none = n_valid == 0
    extent[none] = naming.NODATA
    extent[none & masked] = 250
    extent[none & water] = 251
    return extent, n_valid, n_flooded


def write_maximum(scenes: list[Path], master: Grid, dest: Path, flood_rule: str, block: int = BLOCK) -> dict:
    """Combine the scene files block by block into a Cloud Optimized GeoTIFF on the master grid."""
    import rasterio
    from rasterio.shutil import copy as rio_copy
    from rasterio.transform import Affine
    from rasterio.windows import Window

    if not scenes:
        raise FrequencyError("No scene files to combine.")
    if len(scenes) > MAX_PASSES_PER_EVENT:
        raise FrequencyError(f"{len(scenes)} scenes; the 8-bit count bands hold at most {MAX_PASSES_PER_EVENT}.")
    items = []
    for path in scenes:
        ds = rasterio.open(path)
        t = ds.transform
        col, row = (t.c - master.x0) / master.scale, (master.y0 - t.f) / master.scale
        if (abs(t.a - master.scale) > 1e-6 or abs(t.e + master.scale) > 1e-6 or col != round(col) or row != round(row)
                or col < 0 or row < 0 or col + ds.width > master.width or row + ds.height > master.height
                or ds.crs is None or ds.crs.to_string().upper() != master.crs.upper()):
            raise FrequencyError(f"{path.name} is not on the export grid ({master.crs}, {master.scale} m).")
        items.append((ds, round(col), round(row)))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.tif")
    profile = dict(driver="GTiff", dtype="uint8", count=3, width=master.width, height=master.height, crs=master.crs,
                   transform=Affine(master.scale, 0, master.x0, 0, -master.scale, master.y0), nodata=naming.NODATA,
                   tiled=True, blockxsize=512, blockysize=512, compress="deflate", BIGTIFF="IF_SAFER")
    observed = flooded = 0
    try:
        with rasterio.open(tmp, "w", **profile) as dst:
            for i, name in enumerate(naming.EVENT_BANDS, start=1):
                dst.set_band_description(i, name)
            dst.update_tags(scenes=str(len(scenes)), flood_rule=flood_rule,
                            source="Jaga sar_floods, combined locally from the per-scene rasters")
            for row0 in range(0, master.height, block):
                for col0 in range(0, master.width, block):
                    w, h = min(block, master.width - col0), min(block, master.height - row0)
                    codes = []
                    for ds, dcol, drow in items:
                        c0, c1 = max(col0, dcol), min(col0 + w, dcol + ds.width)
                        r0, r1 = max(row0, drow), min(row0 + h, drow + ds.height)
                        if c1 <= c0 or r1 <= r0:
                            continue
                        code = np.full((h, w), naming.NODATA, dtype=np.uint8)
                        code[r0 - row0:r1 - row0, c0 - col0:c1 - col0] = ds.read(
                            1, window=Window(c0 - dcol, r0 - drow, c1 - c0, r1 - r0))
                        codes.append(code)
                    if not codes:
                        codes = [np.full((h, w), naming.NODATA, dtype=np.uint8)]
                    extent, n_valid, n_flooded = combine(codes, flood_rule)
                    window = Window(col0, row0, w, h)
                    for band, data in enumerate((extent, n_valid, n_flooded), start=1):
                        dst.write(data, band, window=window)
                    observed += int(np.count_nonzero(n_valid))
                    flooded += int(np.count_nonzero(n_flooded))
        rio_copy(tmp, dest, driver="COG", compress="deflate", bigtiff="if_safer")
    finally:
        for ds, _, _ in items:
            ds.close()
        tmp.unlink(missing_ok=True)
    return {"scenes": len(scenes), "pixels_observed": observed, "pixels_flooded": flooded}
