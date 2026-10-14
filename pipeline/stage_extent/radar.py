"""The radar passes of S2 as they are on disk, brought onto the 30 m grid of the reach.

Scene files (sar_floods METHODS): jaga_sar_scene_<YYYYMMDDTHHMMZ>_<sat>_<orbit>_<10m|20m>_<hash>.tif,
UTM 47N, codes 0 dry, 1 VV flood, 2 VH only, 3 both, 250 terrain mask, 251 permanent water, 255 no
data. A pass exported at 10 m (the two events) and at 20 m (the seasons) is read once, at 10 m.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

NAME = re.compile(r"^jaga_sar_scene_(\d{8}T\d{4})Z_(S1[A-D])_([AD]\d{3})_(\d+)m_([0-9a-f]{7})\.tif$")


def parse_scene(name: str) -> dict | None:
    m = NAME.match(name)
    if not m:
        return None
    when, sat, orbit, res, digest = m.groups()
    return {"time": pd.Timestamp(when, tz="UTC"), "sat": sat, "orbit": orbit, "res_m": int(res), "hash": digest,
            "name": name}


def pick_scenes(names: list[str], digest: str) -> list[dict]:
    """One entry per pass (time, satellite, orbit) of the given hash, at its finest resolution, in time order."""
    best: dict[tuple, dict] = {}
    for n in names:
        s = parse_scene(n)
        if not s or s["hash"] != digest:
            continue
        key = (s["time"], s["sat"], s["orbit"])
        if key not in best or s["res_m"] < best[key]["res_m"]:
            best[key] = s
    return sorted(best.values(), key=lambda s: s["time"])


def season_of(t: pd.Timestamp) -> int:
    """Seasons are named by the year they start in (October to January); September counts with them."""
    return t.year if t.month >= 7 else t.year - 1


def aggregate(codes: np.ndarray, res_m: int, target_m: int, flooded: tuple, dry: tuple) -> tuple[np.ndarray, np.ndarray]:
    """Radar codes -> (share of known pixels, share of the known pixels that are flooded) on the
    coarser target grid. `codes` must cover whole target cells. Works through the common finer step
    (10 m for 10, 20 and 30 m), so 20 m pixels are split exactly where a 30 m cell cuts them."""
    fine = math.gcd(res_m, target_m)
    up, block = res_m // fine, target_m // fine
    is_f = np.isin(codes, flooded)
    known = is_f | np.isin(codes, dry)
    if up > 1:
        is_f = np.repeat(np.repeat(is_f, up, axis=0), up, axis=1)
        known = np.repeat(np.repeat(known, up, axis=0), up, axis=1)
    rows, cols = is_f.shape[0] // block, is_f.shape[1] // block
    if rows * block != is_f.shape[0] or cols * block != is_f.shape[1]:
        raise ValueError("the radar window does not cover whole target cells")
    k = known.reshape(rows, block, cols, block).sum(axis=(1, 3)).astype("float32")
    f = is_f.reshape(rows, block, cols, block).sum(axis=(1, 3)).astype("float32")
    n = float(block * block)
    with np.errstate(invalid="ignore", divide="ignore"):
        return k / n, np.where(k > 0, f / k, 0.0).astype("float32")


def classify(known_share: np.ndarray, flood_share: np.ndarray, min_known: float, flood_share_min: float) -> np.ndarray:
    """Per 30 m cell: 1 flooded, 0 dry, -1 unknown."""
    out = np.full(known_share.shape, -1, dtype="int8")
    known = known_share >= min_known
    out[known] = (flood_share[known] >= flood_share_min).astype("int8")
    return out


def radar_window(target_transform, row_off: int, col_off: int, rows: int, cols: int, radar_transform) -> tuple[int, int, int, int]:
    """(row, col, rows, cols) of the radar pixels under a window of the target grid. Raises when the
    two grids do not line up on whole pixels."""
    x0, y0 = target_transform * (col_off, row_off)
    res = radar_transform.a
    c = (x0 - radar_transform.c) / res
    r = (radar_transform.f - y0) / res
    h, w = rows * abs(target_transform.e) / res, cols * target_transform.a / res
    vals = (r, c, h, w)
    if any(abs(v - round(v)) > 1e-6 for v in vals):
        raise ValueError(f"radar grid does not line up with the window: {vals}")
    return tuple(int(round(v)) for v in vals)  # type: ignore[return-value]


def read_codes(path: Path, window: tuple[int, int, int, int]) -> np.ndarray:
    """The radar codes under the window; outside the raster, 255."""
    import rasterio
    from rasterio.windows import Window

    r, c, h, w = window
    with rasterio.open(path) as src:
        return src.read(1, window=Window(c, r, w, h), boundless=True, fill_value=255)
