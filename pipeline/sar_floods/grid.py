"""The export pixel grid and the Otsu tile lattice. Pure Python (pyproj, shapely).

Every raster is cut from one master grid (same CRS, pixel size and origin), so per-scene, per-event
and frequency rasters line up pixel for pixel and can be added up locally without resampling.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Grid:
    crs: str
    scale: int      # pixel size in metres
    x0: int         # west edge of the first column
    y0: int         # north edge of the first row
    width: int
    height: int

    @property
    def transform(self) -> list[float]:
        """Earth Engine crsTransform: [xScale, xShear, xTranslation, yShear, yScale, yTranslation]."""
        return [self.scale, 0, self.x0, 0, -self.scale, self.y0]

    @property
    def dimensions(self) -> str:
        return f"{self.width}x{self.height}"

    @property
    def pixels(self) -> int:
        return self.width * self.height

    @property
    def bounds(self) -> tuple[int, int, int, int]:
        """(west, south, east, north) in the grid's CRS."""
        return self.x0, self.y0 - self.height * self.scale, self.x0 + self.width * self.scale, self.y0

    def file_dimensions(self, shard: int = 256) -> list[int]:
        """Smallest multiples of Earth Engine's shard size that hold the whole grid in one file."""
        return [math.ceil(self.width / shard) * shard, math.ceil(self.height / shard) * shard]

    def window(self, lonlat_bounds: tuple[float, float, float, float]) -> "Grid | None":
        """The part of this grid covering a lon/lat box, on the same pixel lattice. None if outside."""
        west, south, east, north = project_bounds(lonlat_bounds, self.crs)
        gw, gs, ge, gn = self.bounds
        col0 = max(0, math.floor((west - self.x0) / self.scale))
        col1 = min(self.width, math.ceil((east - self.x0) / self.scale))
        row0 = max(0, math.floor((self.y0 - north) / self.scale))
        row1 = min(self.height, math.ceil((self.y0 - south) / self.scale))
        if col1 <= col0 or row1 <= row0:
            return None
        return Grid(self.crs, self.scale, self.x0 + col0 * self.scale, self.y0 - row0 * self.scale,
                    col1 - col0, row1 - row0)

    def as_dict(self) -> dict:
        return {"crs": self.crs, "crs_transform": self.transform, "dimensions": self.dimensions,
                "pixels": self.pixels}


def project_bounds(lonlat_bounds, crs: str, densify: int = 20) -> tuple[float, float, float, float]:
    """Bounding box, in `crs`, of a lon/lat box. The edges are densified because they curve."""
    from pyproj import Transformer

    west, south, east, north = lonlat_bounds
    steps = [i / densify for i in range(densify + 1)]
    lons = [west + (east - west) * s for s in steps]
    lats = [south + (north - south) * s for s in steps]
    edge = ([(x, south) for x in lons] + [(x, north) for x in lons]
            + [(west, y) for y in lats] + [(east, y) for y in lats])
    t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    xs, ys = t.transform([p[0] for p in edge], [p[1] for p in edge])
    return min(xs), min(ys), max(xs), max(ys)


def effective_snap(scale: int, snap: int) -> int:
    """The grid origin is snapped to a multiple of both the pixel size and the configured snap."""
    return math.lcm(scale, snap)


def master_grid(lonlat_bounds, crs: str, scale: int, snap: int) -> Grid:
    """The grid covering the whole area, snapped outwards."""
    step = effective_snap(scale, snap)
    west, south, east, north = project_bounds(lonlat_bounds, crs)
    x0 = math.floor(west / step) * step
    y0 = math.ceil(north / step) * step
    x1 = math.ceil(east / step) * step
    y1 = math.floor(south / step) * step
    return Grid(crs, scale, x0, y0, (x1 - x0) // scale, (y0 - y1) // scale)


@dataclass(frozen=True)
class TileLattice:
    """Square lon/lat tiles for the per-tile thresholds. Tile index = row * ncols + col, counted from
    the south-west corner. Earth Engine rebuilds the same index from pixel coordinates (ee_ops)."""
    lon0: float
    lat0: float
    size: float
    ncols: int
    nrows: int

    def index(self, col: int, row: int) -> int:
        return row * self.ncols + col

    def bounds(self, index: int) -> tuple[float, float, float, float]:
        row, col = divmod(index, self.ncols)
        r = lambda v: round(v, 6)  # noqa: E731
        return (r(self.lon0 + col * self.size), r(self.lat0 + row * self.size),
                r(self.lon0 + (col + 1) * self.size), r(self.lat0 + (row + 1) * self.size))

    def index_at(self, lon: float, lat: float) -> int:
        return self.index(math.floor((lon - self.lon0) / self.size), math.floor((lat - self.lat0) / self.size))

    def as_dict(self) -> dict:
        return {"lon0": self.lon0, "lat0": self.lat0, "size_deg": self.size, "ncols": self.ncols,
                "nrows": self.nrows}


def tile_lattice(lonlat_bounds, size: float) -> TileLattice:
    west, south, east, north = lonlat_bounds
    eps = 1e-9
    c0, r0 = math.floor(west / size + eps), math.floor(south / size + eps)
    c1, r1 = math.ceil(east / size - eps), math.ceil(north / size - eps)
    return TileLattice(round(c0 * size, 6), round(r0 * size, 6), size, c1 - c0, r1 - r0)


def tiles_in_area(lattice: TileLattice, area) -> list[int]:
    """Indices of the tiles that touch the area (a shapely geometry in lon/lat)."""
    from shapely import prepare
    from shapely.geometry import box

    prepare(area)
    return [i for i in range(lattice.ncols * lattice.nrows) if area.intersects(box(*lattice.bounds(i)))]
