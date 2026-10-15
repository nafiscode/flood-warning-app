"""Reading rasters at many points without holding the whole raster in memory.

The rasters here are 11,000 to 13,000 cells square (half a gigabyte for one float band) and the
laptop has one or two gigabytes free, so values are read in strips of rows, each strip cut to the
columns its points need, and nothing else is kept.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


def cells(transform, x: np.ndarray, y: np.ndarray, shape: tuple[int, int]):
    """(row, col, inside) of points on a north-up grid."""
    col = np.floor((x - transform.c) / transform.a).astype("int64")
    row = np.floor((y - transform.f) / transform.e).astype("int64")
    inside = (row >= 0) & (row < shape[0]) & (col >= 0) & (col < shape[1])
    return row, col, inside


def lattice_offset(master, other) -> tuple[int, int] | None:
    """(rows, cols) by which `other`'s first cell lies inside `master`'s grid, when both are north-up
    grids of the same cell size whose cells line up; None otherwise."""
    if abs(other.a - master.a) > 1e-6 or abs(other.e - master.e) > 1e-6 or other.b or other.d:
        return None
    c = (other.c - master.c) / master.a
    r = (other.f - master.f) / master.e
    if abs(c - round(c)) > 1e-6 or abs(r - round(r)) > 1e-6:
        return None
    return int(round(r)), int(round(c))


def strips(rows: np.ndarray, height: int, strip: int):
    """(r0, r1, index) for every strip of `strip` rows that holds at least one of `rows`; `index`
    are the positions in `rows` that fall in it."""
    order = np.argsort(rows, kind="stable")
    sorted_rows = rows[order]
    for r0 in range(0, height, strip):
        a, b = np.searchsorted(sorted_rows, [r0, r0 + strip])
        if b > a:
            yield r0, min(r0 + strip, height), order[a:b]


def sample(src, band: int, rows: np.ndarray, cols: np.ndarray, fill, dtype=None, strip: int = 512) -> np.ndarray:
    """Values of `band` of the open rasterio dataset `src` at (rows, cols); `fill` where a point is
    outside the raster. Reads one strip of rows at a time."""
    from rasterio.windows import Window

    dtype = dtype or src.dtypes[band - 1]
    out = np.full(len(rows), fill, dtype=dtype)
    inside = (rows >= 0) & (rows < src.height) & (cols >= 0) & (cols < src.width)
    idx_in = np.nonzero(inside)[0]
    for r0, r1, local in strips(rows[idx_in], src.height, strip):
        idx = idx_in[local]
        c0, c1 = int(cols[idx].min()), int(cols[idx].max()) + 1
        block = src.read(band, window=Window(c0, r0, c1 - c0, r1 - r0))
        out[idx] = block[rows[idx] - r0, cols[idx] - c0]
    return out


def sample_path(path: Path, band: int, x: np.ndarray, y: np.ndarray, fill, dtype=None, strip: int = 512) -> np.ndarray:
    """`sample` at map coordinates, opening and closing the file."""
    import rasterio

    with rasterio.open(path) as src:
        row, col, _ = cells(src.transform, x, y, (src.height, src.width))
        return sample(src, band, row, col, fill, dtype, strip)
