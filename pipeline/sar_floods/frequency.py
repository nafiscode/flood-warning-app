"""Flood frequency across seasons, computed locally from the downloaded per-event rasters.

frequency = flooded observations / valid observations, summed over every season's n_flooded and
n_valid bands. Doing this locally (numpy + rasterio) instead of in one Earth Engine task over ~1000
scenes costs no Earth Engine quota, and the arithmetic is covered by the offline tests.

Output: one Cloud Optimized GeoTIFF, float32, bands frequency (0-1, -1 = never validly observed),
n_flooded, n_valid.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from . import naming
from .grid import Grid
from .settings import MAX_PASSES_PER_EVENT

log = logging.getLogger("sar_floods")
BLOCK = 2048


class FrequencyError(Exception):
    """A problem with the input rasters that the user can fix; the message says how."""


def season_files(folders: Path | list[Path], years: list[int], scale: int, params_hash: str) -> dict[int, list[Path]]:
    """Per season, its raster: one file, or the parts Earth Engine split it into. `folders` are
    searched in order (locally combined rasters first, then downloads); the first that has it wins."""
    out: dict[int, list[Path]] = {}
    for year in years:
        base = naming.event_name(f"season-{year}", scale, params_hash)
        for folder in ([folders] if isinstance(folders, Path) else folders):
            parts = [p for p in sorted(folder.glob(base + "*.tif"))
                     if (naming.split_part(p.name) or ("", ""))[0] == base]
            if parts:
                out[year] = parts
                break
    return out


class _Parts:
    """The files of one season, read by window of the master grid."""

    def __init__(self, paths: list[Path], master: Grid):
        import rasterio

        self.items = []
        for path in paths:
            ds = rasterio.open(path)
            t = ds.transform
            col = (t.c - master.x0) / master.scale
            row = (master.y0 - t.f) / master.scale
            aligned = (abs(t.a - master.scale) < 1e-6 and abs(t.e + master.scale) < 1e-6 and t.b == 0 and t.d == 0
                       and abs(col - round(col)) < 1e-6 and abs(row - round(row)) < 1e-6)
            if not aligned or ds.crs is None or ds.crs.to_string().upper() != master.crs.upper():
                raise FrequencyError(f"{path.name} is not on the export grid ({master.crs}, {master.scale} m). "
                                     "Was it made with a different scale or config?")
            if ds.count != len(naming.EVENT_BANDS):
                raise FrequencyError(f"{path.name}: expected bands {naming.EVENT_BANDS}.")
            self.items.append((ds, round(col), round(row)))

    def read(self, band: int, col0: int, row0: int, width: int, height: int) -> np.ndarray:
        """Counts for one master-grid window; 0 where no file covers it or the value is not a count."""
        from rasterio.windows import Window

        out = np.zeros((height, width), dtype=np.uint16)
        for ds, dcol, drow in self.items:
            c0, c1 = max(col0, dcol), min(col0 + width, dcol + ds.width)
            r0, r1 = max(row0, drow), min(row0 + height, drow + ds.height)
            if c1 <= c0 or r1 <= r0:
                continue
            data = ds.read(band, window=Window(c0 - dcol, r0 - drow, c1 - c0, r1 - r0))
            data = np.where(data > MAX_PASSES_PER_EVENT, 0, data)
            out[r0 - row0:r1 - row0, c0 - col0:c1 - col0] = data
        return out

    def close(self) -> None:
        for ds, _, _ in self.items:
            ds.close()


def frequency_block(n_flooded: np.ndarray, n_valid: np.ndarray) -> np.ndarray:
    """flooded / valid as float32, -1 where there is no valid observation."""
    if np.any(n_flooded > n_valid):
        raise FrequencyError("n_flooded exceeds n_valid somewhere: the input rasters are inconsistent.")
    out = np.full(n_valid.shape, naming.FREQUENCY_NODATA, dtype=np.float32)
    np.divide(n_flooded, n_valid, out=out, where=n_valid > 0)
    return out


def write_frequency(files: dict[int, list[Path]], master: Grid, dest: Path, block: int = BLOCK) -> dict:
    """Sum the seasons block by block and write the COG. Returns a small summary for the log."""
    import rasterio
    from rasterio.shutil import copy as rio_copy
    from rasterio.transform import Affine
    from rasterio.windows import Window

    if not files:
        raise FrequencyError("No season rasters found. Run `sar_floods download` first.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.tif")
    profile = dict(driver="GTiff", dtype="float32", count=3, width=master.width, height=master.height,
                   crs=master.crs, transform=Affine(master.scale, 0, master.x0, 0, -master.scale, master.y0),
                   nodata=naming.FREQUENCY_NODATA, tiled=True, blockxsize=512, blockysize=512,
                   compress="deflate", BIGTIFF="IF_SAFER")
    seasons = {year: _Parts(paths, master) for year, paths in sorted(files.items())}
    observed = flooded = 0
    try:
        with rasterio.open(tmp, "w", **profile) as dst:
            for i, name in enumerate(naming.FREQUENCY_BANDS, start=1):
                dst.set_band_description(i, name)
            dst.update_tags(seasons=",".join(str(y) for y in seasons), source="Jaga sar_floods",
                            frequency="n_flooded / n_valid; -1 = never validly observed")
            for row0 in range(0, master.height, block):
                for col0 in range(0, master.width, block):
                    w, h = min(block, master.width - col0), min(block, master.height - row0)
                    n_valid = np.zeros((h, w), dtype=np.uint16)
                    n_flooded = np.zeros((h, w), dtype=np.uint16)
                    for parts in seasons.values():
                        n_valid += parts.read(naming.EVENT_BANDS.index("n_valid") + 1, col0, row0, w, h)
                        n_flooded += parts.read(naming.EVENT_BANDS.index("n_flooded") + 1, col0, row0, w, h)
                    window = Window(col0, row0, w, h)
                    dst.write(frequency_block(n_flooded, n_valid), 1, window=window)
                    dst.write(n_flooded.astype(np.float32), 2, window=window)
                    dst.write(n_valid.astype(np.float32), 3, window=window)
                    observed += int(np.count_nonzero(n_valid))
                    flooded += int(np.count_nonzero(n_flooded))
        rio_copy(tmp, dest, driver="COG", compress="deflate", predictor="yes", bigtiff="if_safer")
    finally:
        for parts in seasons.values():
            parts.close()
        tmp.unlink(missing_ok=True)
    return {"seasons": sorted(seasons), "pixels_observed": observed, "pixels_ever_flooded": flooded}
