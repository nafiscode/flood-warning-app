"""Everything that talks to Google Earth Engine.

First run against Earth Engine on 2026-10-05: `check`, scene listing, the look direction and the
tile histograms work; the classification and export steps have not run yet. The offline tests only
execute this module against a stand-in `ee`, which catches typos but not wrong API behaviour.
METHODS.md, "To verify on first run", lists what is still to confirm.

Nothing here runs at import time: `ee` is imported and initialised only inside `init`.
The Code Editor script (code_editor/sar_floods.js) mirrors these functions one to one.
"""

from __future__ import annotations

import math

from . import naming
from .grid import Grid, TileLattice
from .plan import Export, Pass
from .settings import histogram_bins

_ee = None

# Margin around the area when measuring an orbit's look direction (see look_direction).
LOOK_DIRECTION_MARGIN_M = 100_000


def ee():
    if _ee is None:
        raise RuntimeError("Earth Engine is not initialised; call ee_ops.init(project) first.")
    return _ee


def init(project: str) -> str:
    """Sign in with the stored `earthengine authenticate` credentials. Returns the client version."""
    global _ee
    import ee as ee_module

    ee_module.Initialize(project=project)
    _ee = ee_module
    return ee_module.__version__


# ---------------------------------------------------------------- scenes

def area(geometry: dict):
    return ee().Geometry(geometry)


def s1_collection(cfg: dict, aoi, start_ms: int, end_ms: int):
    """Sentinel-1 GRD scenes over the area in [start, end), dual-pol IW at 10 m."""
    s1 = cfg["sentinel1"]
    col = (ee().ImageCollection(s1["collection"])
           .filterBounds(aoi)
           .filterDate(start_ms, end_ms)
           .filter(ee().Filter.eq("instrumentMode", s1["instrument_mode"]))
           .filter(ee().Filter.eq("resolution_meters", s1["resolution_meters"])))
    for pol in s1["polarisations"]:
        col = col.filter(ee().Filter.listContains("transmitterReceiverPolarisation", pol))
    return col


def list_scenes(col) -> list[dict]:
    """Metadata of every scene in the collection as GeoJSON features (footprint + properties).
    One request; Earth Engine returns at most 5000 features, far more than one season has."""
    def describe(img):
        return ee().Feature(img.geometry(), {
            "id": img.get("system:index"),
            "time_start": img.get("system:time_start"),
            "platform": img.get("platform_number"),
            "relative_orbit": img.get("relativeOrbitNumber_start"),
            "absolute_orbit": img.get("orbitNumber_start"),
            "direction": img.get("orbitProperties_pass"),
        })

    return ee().FeatureCollection(col.map(describe)).getInfo()["features"]


def _scenes(cfg: dict, scene_ids: list[str]):
    """The named scenes: polarisation bands plus 'angle', swath edges trimmed."""
    s1 = cfg["sentinel1"]
    lo, hi = s1["incidence_angle_deg"]
    bands = list(s1["polarisations"]) + ["angle"]

    def prepare(img):
        angle = img.select("angle")
        return img.select(bands).updateMask(angle.gt(lo).And(angle.lt(hi)))

    # Loaded by asset id: exactly the scenes in the run log, and no search through the whole archive.
    return ee().ImageCollection([ee().Image(f"{s1['collection']}/{i}") for i in scene_ids]).map(prepare)


def _despeckle(img, cfg: dict):
    """Focal median on the dB image. Focal operations also fill masked pixels next to valid ones,
    so the original mask is put back."""
    sp = cfg["speckle"]
    if sp["filter"] == "none":
        return img
    return img.focalMedian(sp["radius_m"], sp["kernel"], "meters").updateMask(img.mask())


# ---------------------------------------------------------------- masks

def static_masks(cfg: dict) -> dict:
    """Scene-independent masks as 0/1 images (1 = excluded), plus the DEM terrain for layover."""
    m = cfg["masks"]
    water = (ee().Image(m["permanent_water"]["asset"]).select(m["permanent_water"]["band"])
             .unmask(0).gt(m["permanent_water"]["min_occurrence_pct"]))

    if m["slope"]["dem_is_collection"]:
        tiles = ee().ImageCollection(m["slope"]["dem_asset"]).select(m["slope"]["dem_band"])
        dem_projection = tiles.first().projection()
        dem = tiles.mosaic().setDefaultProjection(dem_projection)
    else:
        dem = ee().Image(m["slope"]["dem_asset"]).select(m["slope"]["dem_band"])
        dem_projection = dem.projection()
    # Slope and aspect are forced onto the DEM's own grid. Without this Earth Engine computes them
    # on the 10 m output grid from nearest-neighbour-resampled 30 m cells: zero inside each DEM
    # cell and a spike at its edges.
    slope = ee().Terrain.slope(dem).reproject(dem_projection)
    aspect = ee().Terrain.aspect(dem).reproject(dem_projection)

    steep = slope.unmask(0).gt(m["slope"]["max_deg"])
    high = ee().Image(m["hand"]["asset"]).select(m["hand"]["band"]).unmask(0).gt(m["hand"]["max_m"])
    return {"water": water, "terrain": steep.Or(high), "slope": slope, "aspect": aspect}


def look_direction(cfg: dict, scene_ids: list[str], aoi) -> float:
    """Compass direction from the ground towards the satellite for one orbit, in degrees
    (measured 2026-10-05: 258-259 ascending, 101-102 descending).

    A plane is fitted to the orbit's incidence angle (angle ~ a + b*east + c*north, in the export
    CRS); the angle falls towards the satellite, so the direction is that of (-b, -c). Taken from the
    untrimmed scenes over the area plus a margin: where an orbit only clips the area, the swath
    inside it is too narrow for a stable fit. `ee.Terrain.aspect` is not used: the `angle` band is
    a ~16 km grid, so its aspect exists only along cell edges (and nowhere at all for orbit D062).
    """
    s1 = cfg["sentinel1"]
    crs = cfg["export"]["crs"]
    angle = ee().ImageCollection([ee().Image(f"{s1['collection']}/{i}").select("angle")
                                  for i in scene_ids]).median()
    stack = (ee().Image.constant(1).addBands(ee().Image.pixelCoordinates(ee().Projection(crs)).select(["x", "y"]))
             .addBands(angle).updateMask(angle.mask()))
    region = aoi.bounds(1).buffer(LOOK_DIRECTION_MARGIN_M, 1000).bounds(1)
    fit = stack.reduceRegion(reducer=ee().Reducer.linearRegression(3, 1), geometry=region, crs=crs,
                             scale=5000, maxPixels=1e9).get("coefficients").getInfo()
    return bearing_towards_radar(fit)


def bearing_towards_radar(coefficients) -> float:
    """Bearing (degrees clockwise from north) of (-b, -c) from the 3x1 plane-fit coefficients."""
    if not coefficients or len(coefficients) != 3:
        raise ValueError("The incidence-angle plane fit returned no result (no scenes over the area?).")
    east, north = float(coefficients[1][0]), float(coefficients[2][0])
    if east == 0 and north == 0:
        raise ValueError("The incidence angle is flat over the area; the look direction is undefined.")
    return math.degrees(math.atan2(-east, -north)) % 360


def layover_shadow(ref_angle, towards_radar: float, masks: dict, cfg: dict):
    """0/1 image, 1 = radar layover or shadow for this orbit's viewing geometry.

    The angular model of Vollrath, Mullissa & Reiche (2020, Remote Sensing 12(11), 1867):
    the terrain slope is split into its component along the radar's range direction (alpha_r) and
    along the flight direction (alpha_az);
      layover where alpha_r >= the incidence angle (the slope faces the radar more steeply than
                              the radar looks down),
      shadow  where the local incidence angle >= shadow_lia_deg (the slope faces away).
    The range direction (`towards_radar`, one value per orbit) comes from `look_direction`.

    Limits: this flags the slopes that CAUSE layover and shadow, at the DEM's 30 m. It does not
    trace where the displaced signal lands (the valley floor in front of a mountain) or how far a
    shadow reaches; `buffer_m` only pads the mask. See METHODS.md.
    """
    ls = cfg["masks"]["layover_shadow"]
    if not ls["enabled"]:
        return ee().Image.constant(0)
    rad = math.pi / 180
    phi_r = ee().Image.constant(towards_radar).subtract(masks["aspect"]).multiply(rad)
    alpha_s = masks["slope"].multiply(rad)
    theta = ref_angle.multiply(rad)
    alpha_r = alpha_s.tan().multiply(phi_r.cos()).atan()
    alpha_az = alpha_s.tan().multiply(phi_r.sin()).atan()
    lia = alpha_az.cos().multiply(theta.subtract(alpha_r).cos()).acos()
    bad = alpha_r.gte(theta).Or(lia.gte(ls["shadow_lia_deg"] * rad)).unmask(0)
    if ls["buffer_m"] > 0:
        bad = bad.focalMax(ls["buffer_m"], "circle", "meters")
    return bad.rename("layover_shadow")


# ---------------------------------------------------------------- reference, change, thresholds

def reference(cfg: dict, scene_ids: list[str]):
    """Dry reference for one orbit: per-pixel median of the listed scenes (dB), then the same
    speckle filter as the event scene. Returns (backscatter image, median incidence angle)."""
    median = _scenes(cfg, scene_ids).median()
    pols = cfg["sentinel1"]["polarisations"]
    return _despeckle(median.select(pols), cfg), median.select("angle")


def change_image(cfg: dict, p: Pass, ref_backscatter):
    """event - reference in dB for one pass (its slices mosaicked). Masked where either is missing."""
    pols = cfg["sentinel1"]["polarisations"]
    event = _scenes(cfg, [s.id for s in p.scenes]).mosaic().select(pols)
    return _despeckle(event, cfg).subtract(ref_backscatter)


def validity(change, masks: dict, layover):
    """(observed, valid) as 0/1 images defined everywhere. observed = the pass and its reference
    both have data in every polarisation; valid = observed and not masked."""
    observed = change.mask().reduce(ee().Reducer.min()).gt(0).unmask(0, False)
    excluded = masks["water"].Or(masks["terrain"]).Or(layover)
    return observed, observed.And(excluded.Not()).unmask(0, False)


def tile_index_image(lattice: TileLattice):
    """Integer image of the tile index (row * ncols + col), the same numbering as grid.TileLattice."""
    lonlat = ee().Image.pixelLonLat()
    col = lonlat.select("longitude").subtract(lattice.lon0).divide(lattice.size).floor()
    row = lonlat.select("latitude").subtract(lattice.lat0).divide(lattice.size).floor()
    return row.multiply(lattice.ncols).add(col).toInt().rename("tile")


def tile_histograms(cfg: dict, change, valid, aoi, lattice: TileLattice, tiles: list[int]) -> dict:
    """Histogram of the change image per tile and polarisation, valid pixels inside the area only.

    One request per pass. Returns {tile index: {pol: [count per bin]}}; tiles without data are left out.
    """
    h = cfg["threshold"]["histogram"]
    pols = cfg["sentinel1"]["polarisations"]
    n_bins = histogram_bins(cfg)
    # fixedHistogram ignores values outside [min, max): clamp them into the first and last bin instead.
    image = (change.updateMask(valid).clip(aoi)
             .max(h["min_db"]).min(h["max_db"] - h["bin_db"] / 2))
    regions = ee().FeatureCollection([
        ee().Feature(ee().Geometry.Rectangle(list(lattice.bounds(i)), None, False), {"tile": i})
        for i in tiles])
    reduced = image.reduceRegions(
        collection=regions, reducer=ee().Reducer.fixedHistogram(h["min_db"], h["max_db"], n_bins),
        scale=h["scale_m"], crs=cfg["export"]["crs"], tileScale=2)
    return parse_histograms(reduced.getInfo()["features"], pols, n_bins)


def parse_histograms(features: list[dict], pols: list[str], n_bins: int) -> dict:
    """Earth Engine names the output after the band for a multi-band image and "histogram" for a
    single band; each value is a list of [bin lower edge, count] rows, or null without data."""
    out: dict[int, dict[str, list[float]]] = {}
    for f in features:
        props = f["properties"]
        per_pol = {}
        for pol in pols:
            rows = props.get(pol)
            if rows is None and len(pols) == 1:
                rows = props.get("histogram")
            if not rows:
                continue
            if len(rows) != n_bins:
                raise ValueError(f"Tile {props['tile']} {pol}: expected {n_bins} bins, got {len(rows)}.")
            counts = [float(r[1]) for r in rows]
            if sum(counts) > 0:
                per_pol[pol] = counts
        if per_pol:
            out[int(props["tile"])] = per_pol
    return out


def threshold_image(cfg: dict, tile_index, decisions: dict, pol: str):
    """Per-pixel threshold in dB: each tile's chosen threshold, the fixed drop everywhere else.
    Sent as whole hundredths of a dB because remap matches and returns integers reliably."""
    fallback = cfg["threshold"]["fallback_drop_db"][pol]
    chosen = {i: d for i, d in sorted(decisions.items()) if d.method == "otsu"}
    if not chosen:
        return ee().Image.constant(fallback)
    return (tile_index.remap(list(chosen), [round(d.threshold_db * 100) for d in chosen.values()],
                             round(fallback * 100))
            .divide(100))


def _remove_small(flood, cfg: dict):
    """Drop flood patches smaller than min_connected_pixels (8-connected, at the output scale)."""
    n = cfg["min_connected_pixels"]
    if n <= 1:
        return flood
    size = flood.selfMask().connectedPixelCount(n + 1, True)
    return flood.where(size.lt(n), 0)


def classify(cfg: dict, change, valid, tile_index, decisions: dict[str, dict]):
    """Flood per polarisation for one pass: {"VV": 0/1 image, "VH": 0/1 image}, 0 where not valid."""
    out = {}
    for pol in cfg["sentinel1"]["polarisations"]:
        flood = change.select(pol).lt(threshold_image(cfg, tile_index, decisions[pol], pol))
        out[pol] = _remove_small(flood.unmask(0, False).And(valid), cfg).rename(pol.lower())
    return out


def _rule(cfg: dict, flood: dict):
    vv, vh = flood.get("VV"), flood.get("VH")
    return {"vv": lambda: vv, "vh": lambda: vh, "vv_or_vh": lambda: vv.Or(vh),
            "vv_and_vh": lambda: vv.And(vh)}[cfg["flood_rule"]]()


def _bits(flood: dict):
    """1 = VV, 2 = VH, 3 = both (naming.CODES). A polarisation that is not processed contributes 0."""
    zero = ee().Image.constant(0)
    return flood.get("VV", zero).add(flood.get("VH", zero).multiply(2))


# ---------------------------------------------------------------- products

def scene_product(flood: dict, observed, valid, masks: dict, layover, aoi):
    """Per-scene extent, one uint8 band with the codes in naming.CODES."""
    code = (_bits(flood)
            .where(valid.Not(), naming.NODATA)
            .where(observed.And(masks["terrain"].Or(layover)), 250)
            .where(observed.And(masks["water"]), 251))
    # sameFootprint=False: fill everything that is still masked, also outside the pass footprint.
    return code.toUint8().rename("extent").clip(aoi).unmask(naming.NODATA, False)


def event_product(cfg: dict, per_pass: list[dict], masks: dict, aoi):
    """Per-event raster, three uint8 bands: extent (codes; flooded in any pass), n_valid, n_flooded.

    per_pass: one {"flood": {...}, "valid": image} per used pass.
    """
    zero = ee().Image.constant(0)
    stack = ee().ImageCollection.fromImages([
        ee().Image.cat(p["flood"].get("VV", zero), p["flood"].get("VH", zero), p["valid"],
                       _rule(cfg, p["flood"])).rename(["vv", "vh", "n_valid", "n_flooded"]).toUint8()
        for p in per_pass])
    counts = stack.select(["n_valid", "n_flooded"]).sum()
    anytime = stack.select(["vv", "vh"]).max()
    extent = (anytime.select("vv").add(anytime.select("vh").multiply(2))
              .where(counts.select("n_valid").eq(0), naming.NODATA)
              .where(masks["terrain"], 250)
              .where(masks["water"], 251)
              .rename("extent"))
    # Outside the area and wherever nothing was observed: extent 255 (no data), counts 0.
    return ee().Image.cat(extent.toUint8().clip(aoi).unmask(naming.NODATA, False),
                          counts.toUint8().clip(aoi).unmask(0, False))


def export_task(image, export: Export, cfg: dict):
    """An UNSTARTED Drive export on the exact pixel grid. The caller decides whether to start it."""
    ex = cfg["export"]
    grid: Grid = export.grid
    options = dict(
        image=image.select(list(export.bands)), description=export.name, folder=ex["drive_folder"],
        fileNamePrefix=export.name, crs=grid.crs, crsTransform=grid.transform, dimensions=grid.dimensions,
        maxPixels=int(ex["max_pixels"]), fileFormat="GeoTIFF",
        formatOptions={"cloudOptimized": True, "noData": naming.NODATA})
    if ex["single_file"]:
        options["fileDimensions"] = grid.file_dimensions()
    return ee().batch.Export.image.toDrive(**options)


# ---------------------------------------------------------------- housekeeping

def task_status(task_ids: list[str]) -> dict[str, dict]:
    """State and compute used per task id. EECU-seconds appear once a task has finished."""
    out = {}
    for status in ee().data.getTaskStatus(task_ids):
        keep = {k: status[k] for k in ("state", "batch_eecu_usage_seconds", "error_message",
                                       "start_timestamp_ms", "update_timestamp_ms") if k in status}
        out[status["id"]] = keep
    return out


def check(cfg: dict, aoi_geometry: dict) -> list[tuple[str, bool, str]]:
    """Small requests that confirm sign-in, every dataset id and every band name used here."""
    m = cfg["masks"]
    results = []

    def probe(label, fn):
        try:
            results.append((label, True, str(fn())))
        except Exception as e:  # report every failure, then let the caller decide
            results.append((label, False, f"{type(e).__name__}: {e}"))

    def bands(asset, band, is_collection=False):
        img = ee().ImageCollection(asset).first() if is_collection else ee().Image(asset)
        names = img.bandNames().getInfo()
        if band not in names:
            raise ValueError(f"band '{band}' not in {names}")
        return f"band '{band}' present, scale {img.select(band).projection().nominalScale().getInfo():.1f} m"

    aoi = area(aoi_geometry)
    probe("area (km2)", lambda: round(aoi.area(100).getInfo() / 1e6))
    probe(m["permanent_water"]["asset"], lambda: bands(m["permanent_water"]["asset"], m["permanent_water"]["band"]))
    probe(m["hand"]["asset"], lambda: bands(m["hand"]["asset"], m["hand"]["band"]))
    probe(m["slope"]["dem_asset"],
          lambda: bands(m["slope"]["dem_asset"], m["slope"]["dem_band"], m["slope"]["dem_is_collection"]))

    def s1_sample():
        from .seasons import utc_millis
        from datetime import date
        col = s1_collection(cfg, aoi, *utc_millis(date(2024, 11, 1), date(2024, 11, 30)))
        first = col.first()
        return (f"{col.size().getInfo()} scenes in Nov 2024; bands {first.bandNames().getInfo()}; "
                f"platform {first.get('platform_number').getInfo()}, "
                f"orbit {first.get('relativeOrbitNumber_start').getInfo()} "
                f"{first.get('orbitProperties_pass').getInfo()}")

    probe(cfg["sentinel1"]["collection"], s1_sample)
    return results
