"""Configuration, validation and local paths. All paths are relative to the repo, never absolute."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PureWindowsPath

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, env_value

PACKAGE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PACKAGE_DIR / "config.yaml"
AOI_PATH = PACKAGE_DIR / "aoi.geojson"

FLOOD_RULES = ("vv", "vh", "vv_or_vh", "vv_and_vh")
# Sections that change pixel values. Their hash goes into every file name, so rasters made with
# different parameters never share a name. Seasons, the Drive folder and local paths are left out.
HASHED_KEYS = ("provinces", "sentinel1", "reference", "speckle", "threshold", "flood_rule",
               "min_connected_area_m2", "masks")
# The counts in the per-event raster are 8-bit and 250+ are status codes (see naming.CODES).
MAX_PASSES_PER_EVENT = 249


class ConfigError(Exception):
    """A problem in config.yaml or the environment that the user can fix; the message says how."""


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def runs(self) -> Path:
        return self.root / "runs"

    @property
    def drive(self) -> Path:
        """Files exactly as downloaded from Google Drive."""
        return self.root / "drive"

    @property
    def products(self) -> Path:
        """Rasters computed locally (per-event maximum, flood frequency)."""
        return self.root / "products"

    def thresholds(self, params_hash: str) -> Path:
        return self.root / "thresholds" / params_hash


def output_paths(cfg: dict) -> Paths:
    text = str(cfg["output_dir"])
    root = (PIPELINE_DIR / text).resolve()
    if PureWindowsPath(text).anchor or text.startswith("/") or not root.is_relative_to(PIPELINE_DIR):
        raise ConfigError("output_dir must be relative to pipeline/ and inside it (no absolute paths or drive letters).")
    return Paths(root)


def ee_project() -> str:
    """The Earth Engine Cloud project ID: environment, else .env.local, else .env.example."""
    project = env_value("EE_PROJECT")
    if not project:
        raise ConfigError("EE_PROJECT is not set. Put the Cloud project ID in .env.local "
                          "(see .env.example), then sign in once with `earthengine authenticate`.")
    return project


def _mmdd(value, name: str) -> tuple[int, int]:
    try:
        d = date.fromisoformat(f"2001-{value}")  # 2001: not a leap year, so 02-29 is rejected
    except (TypeError, ValueError):
        raise ConfigError(f"{name} must be a month-day like \"10-01\", got {value!r}.") from None
    return d.month, d.day


def _need(cond: bool, message: str) -> None:
    if not cond:
        raise ConfigError(message)


def _pair(value, name: str) -> tuple[float, float]:
    _need(isinstance(value, (list, tuple)) and len(value) == 2 and value[0] < value[1],
          f"{name} must be [low, high] with low < high.")
    return float(value[0]), float(value[1])


def validate(cfg: dict) -> dict:
    """Check the values that would otherwise fail late (inside an Earth Engine task) or silently."""
    for key in ("provinces", "sentinel1", "seasons", "priority_events", "reference", "speckle",
                "threshold", "flood_rule", "min_connected_area_m2", "masks", "export", "output_dir"):
        _need(key in cfg, f"config.yaml: missing section '{key}'.")

    _need(all(isinstance(c, str) and len(c) == 2 and c.isdigit() for c in cfg["provinces"]),
          "provinces: keys must be 2-digit DOPA codes in quotes, e.g. \"94\".")

    s1 = cfg["sentinel1"]
    pols = s1["polarisations"]
    _need(pols and set(pols) <= {"VV", "VH"} and len(set(pols)) == len(pols),
          "sentinel1.polarisations must be a list out of VV and VH.")
    _pair(s1["incidence_angle_deg"], "sentinel1.incidence_angle_deg")

    se = cfg["seasons"]
    _need(isinstance(se["first"], int) and isinstance(se["last"], int) and 2014 <= se["first"] <= se["last"],
          "seasons: first and last must be years with 2014 <= first <= last (Sentinel-1A launched in 2014).")
    start, end = _mmdd(se["start"], "seasons.start"), _mmdd(se["end"], "seasons.end")
    _need(end < start, "seasons: the season must cross the new year (end month-day before start month-day).")
    _need(isinstance(se["scale_m"], int) and se["scale_m"] > 0, "seasons.scale_m must be a whole number of metres.")

    ids = set()
    for ev in cfg["priority_events"]:
        _need({"id", "start", "end"} <= set(ev), "priority_events: each entry needs id, start and end.")
        try:
            a, b = date.fromisoformat(str(ev["start"])), date.fromisoformat(str(ev["end"]))
        except ValueError:
            raise ConfigError(f"priority_events '{ev['id']}': start and end must be YYYY-MM-DD.") from None
        _need(a <= b, f"priority_events '{ev['id']}': start is after end.")
        _need(str(ev["id"]) not in ids, f"priority_events: duplicate id '{ev['id']}'.")
        _need(all(ch.isalnum() or ch == "-" for ch in str(ev["id"])),
              f"priority_events '{ev['id']}': ids may only contain letters, digits and '-'.")
        ids.add(str(ev["id"]))

    ref = cfg["reference"]
    rs, re_ = _mmdd(ref["start"], "reference.start"), _mmdd(ref["end"], "reference.end")
    _need(rs <= re_, "reference: the dry window must lie inside one calendar year (start <= end).")
    _need(not (re_ >= start or rs <= end), "reference: the dry window overlaps the flood season.")
    _need(ref["year_offsets"] and all(isinstance(o, int) for o in ref["year_offsets"]),
          "reference.year_offsets must be a list of whole numbers, e.g. [0].")
    _need(int(ref["min_passes"]) >= 1, "reference.min_passes must be at least 1.")

    sp = cfg["speckle"]
    _need(sp["filter"] in ("focal_median", "none"), "speckle.filter must be focal_median or none.")
    _need(sp["filter"] == "none" or sp["radius_m"] > 0, "speckle.radius_m must be positive.")

    th = cfg["threshold"]
    _need(0 < th["tile_size_deg"] <= 1, "threshold.tile_size_deg must be between 0 and 1.")
    h = th["histogram"]
    _need(h["min_db"] < 0 < h["max_db"], "threshold.histogram: min_db must be negative and max_db positive.")
    _need(h["bin_db"] > 0 and histogram_bins(cfg) >= 20, "threshold.histogram: need at least 20 bins.")
    _need(h["scale_m"] > 0, "threshold.histogram.scale_m must be positive.")
    b = th["bimodality"]
    _need(0 < b["min_class_fraction"] < 0.5, "bimodality.min_class_fraction must be between 0 and 0.5.")
    _need(0 < b["max_valley_ratio"] < 1, "bimodality.max_valley_ratio must be between 0 and 1.")
    _need(isinstance(b["smooth_bins"], int) and b["smooth_bins"] >= 1 and b["smooth_bins"] % 2 == 1,
          "bimodality.smooth_bins must be an odd whole number.")
    _need(b["min_pixels"] >= 1 and b["min_mode_separation_db"] > 0, "bimodality: values must be positive.")
    lo, hi = _pair(th["otsu_range_db"], "threshold.otsu_range_db")
    _need(h["min_db"] < lo and hi < 0, "threshold.otsu_range_db must lie inside the histogram and below 0 dB.")
    for pol in pols:
        drop = th["fallback_drop_db"].get(pol)
        _need(isinstance(drop, (int, float)) and h["min_db"] < drop < 0,
              f"threshold.fallback_drop_db.{pol} must be a negative drop in dB inside the histogram range.")

    _need(cfg["flood_rule"] in FLOOD_RULES, "flood_rule must be one of: " + ", ".join(FLOOD_RULES) + ".")
    needed = {"vv": {"VV"}, "vh": {"VH"}}.get(cfg["flood_rule"], {"VV", "VH"})
    _need(needed <= set(pols), f"flood_rule '{cfg['flood_rule']}' needs polarisations {sorted(needed)}.")
    _need(isinstance(cfg["min_connected_area_m2"], (int, float)) and 0 <= cfg["min_connected_area_m2"] <= 1_000_000,
          "min_connected_area_m2 must be an area from 0 to 1,000,000 m2.")

    m = cfg["masks"]
    _need(0 <= m["permanent_water"]["min_occurrence_pct"] < 100, "masks.permanent_water: 0 <= percent < 100.")
    _need(0 < m["slope"]["max_deg"] < 90 and m["hand"]["max_m"] > 0, "masks: slope and HAND limits must be positive.")
    _need(0 <= m["slope"]["min_hand_m"] <= m["hand"]["max_m"],
          "masks.slope.min_hand_m must lie between 0 and masks.hand.max_m (0 = the slope rule applies everywhere).")
    _need(isinstance(m["slope"]["dem_is_collection"], bool), "masks.slope.dem_is_collection must be true or false.")
    _need(m["layover_shadow"]["buffer_m"] >= 0, "masks.layover_shadow.buffer_m cannot be negative.")

    ex = cfg["export"]
    _need(str(ex["crs"]).startswith("EPSG:"), "export.crs must be an EPSG code like EPSG:32647.")
    for key in ("scale_m", "snap_m"):
        _need(isinstance(ex[key], int) and ex[key] > 0, f"export.{key} must be a whole number of metres.")
    folder = str(ex["drive_folder"])
    _need(folder and "/" not in folder and "\\" not in folder, "export.drive_folder must be one folder name.")
    _need("gs://" not in folder, "Exports go to Google Drive only (Cloud Storage bills).")
    assets = str(ex["asset_folder"])
    _need(assets and all(ch.isalnum() or ch in "_-" for ch in assets),
          "export.asset_folder must be one folder name made of letters, digits, '_' and '-'.")
    _need(ex["reference_margin_m"] >= 0, "export.reference_margin_m cannot be negative.")
    _need(ex["maximum"] in ("local", "earth_engine"), "export.maximum must be local or earth_engine.")
    output_paths(cfg)
    return cfg


def load_config(path: Path = CONFIG_PATH, scale_m: int | None = None) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if scale_m is not None:
        cfg["export"]["scale_m"] = scale_m
    return validate(cfg)


def min_connected_pixels(cfg: dict) -> int:
    """The small-patch filter in pixels at the export scale: 800 m2 is 8 pixels at 10 m and 2 at 20 m.
    0 when the filter is off; never less than 1 pixel otherwise."""
    area = cfg["min_connected_area_m2"]
    return max(1, round(area / cfg["export"]["scale_m"] ** 2)) if area > 0 else 0


def histogram_bins(cfg: dict) -> int:
    h = cfg["threshold"]["histogram"]
    return int(round((h["max_db"] - h["min_db"]) / h["bin_db"]))


def aoi_sha256(path: Path = AOI_PATH) -> str:
    """Hash of the area's geometry (the parsed coordinates, so line endings do not matter)."""
    geometry = json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"]
    text = json.dumps(geometry, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def params_hash(cfg: dict, aoi_sha: str) -> str:
    """7 hex characters identifying the processing parameters, the area and the grid's CRS and snap."""
    payload = {k: cfg[k] for k in HASHED_KEYS}
    payload["grid"] = {"crs": cfg["export"]["crs"], "snap_m": cfg["export"]["snap_m"]}
    payload["aoi_sha256"] = aoi_sha
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:7]
