"""Deterministic names: Earth Engine export names, local files and R2 keys. Pure Python.

  jaga_sar_scene_<UTC time>_<platform>_<A|D><orbit>_<scale>m_<hash>    one pass, priority events only
  jaga_sar_max_<event id>_<scale>m_<hash>                              one event: extent + counts
  jaga_sar_frequency_<first>-<last>_<scale>m_<hash>                    all seasons, computed locally
  jaga_sar_ref_<year(s)>_<A|D><orbit>_<scale>m_<hash>                  dry reference of one orbit: an
                                                                       Earth Engine asset, never a file

<hash> is settings.params_hash: rasters made with different parameters never share a name, and the
run log with the same hash says exactly how a file was made.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import PurePosixPath

PREFIX = "jaga_sar_"

# Pixel values of the "extent" band (per-scene files, and band 1 of the per-event file).
CODES = {
    0: "observed, not flooded",
    1: "flooded in VV only",
    2: "flooded in VH only",
    3: "flooded in VV and VH",
    250: "masked: slope, HAND, or radar layover/shadow",
    251: "masked: permanent water (JRC)",
    255: "no valid observation (outside the swath or the four provinces)",
}
NODATA = 255
EVENT_BANDS = ("extent", "n_valid", "n_flooded")
FREQUENCY_BANDS = ("frequency", "n_flooded", "n_valid")
FREQUENCY_NODATA = -1.0

# Earth Engine splits large exports into <name>-<row offset>-<column offset>.tif.
_PART = re.compile(r"^(?P<base>.+?)(?P<part>-\d{10}-\d{10})?\.tif$")


def scene_name(pass_id: str, scale: int, params_hash: str) -> str:
    return f"{PREFIX}scene_{pass_id}_{scale}m_{params_hash}"


def event_name(event_id: str, scale: int, params_hash: str) -> str:
    return f"{PREFIX}max_{event_id}_{scale}m_{params_hash}"


def frequency_name(first: int, last: int, scale: int, params_hash: str) -> str:
    return f"{PREFIX}frequency_{first}-{last}_{scale}m_{params_hash}"


REFERENCE_LAYOVER_BAND = "layover"


def reference_name(years: list[int], orbit: str, scale: int, params_hash: str) -> str:
    """Asset name of one orbit's dry reference; `years` are the calendar years of its dry windows."""
    return f"{PREFIX}ref_{'-'.join(str(y) for y in sorted(years))}_{orbit}_{scale}m_{params_hash}"


def split_part(filename: str) -> tuple[str, str] | None:
    """("jaga_sar_max_season-2024_10m_ab12cd3", "-0000000000-0000023296") for a GeoTIFF name; the
    second item is "" for an unsplit file. None if the name is not one of ours."""
    m = _PART.match(filename)
    if not m or not m["base"].startswith(PREFIX):
        return None
    return m["base"], m["part"] or ""


def r2_key(filename: str, day: date) -> str:
    """Write-once key in the private bucket: sar/<kind>/<rest of the name>/<date><part>.tif."""
    parsed = split_part(filename)
    if parsed is None:
        raise ValueError(f"Not a sar_floods raster: {filename}")
    base, part = parsed
    kind, _, rest = base.removeprefix(PREFIX).partition("_")
    return str(PurePosixPath("sar") / kind / rest / f"{day.isoformat()}{part}.tif")


def run_log_key(run_id: str) -> str:
    return f"sar/runs/{run_id}.json"
