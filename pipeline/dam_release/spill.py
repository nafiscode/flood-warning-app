"""Where a full reservoir's water goes, and the land it can reach (the owner, 26 Oct 2026).

S7 built the zone below Bang Lang from the river gauges: the land no higher above the river than
the river has been seen to rise. Five reservoirs cannot be done that way. They are the Royal
Irrigation Department's, they hold between 1.2 and 57 million cubic metres, **no gauge stands
below any of them**, and OpenStreetMap maps no channel at all below three of them. Until this
module they had no zone, which meant `admin_send_dam_release` refused to send for three of them
and the other two would have sent an alert with no arrival window.

The owner's question is the one an irrigation reservoir poses rather than a hydropower dam: it
collects water through the wet season, and when it is full what it takes in it must pass on. So:
when it fills, where does the water go, and whose tambon is in the way?

Method, in the order the functions run:

1. *The path.* The elevation model's own flow directions (the hazard module's D8 pointer, built on
   a breached and filled surface) are followed from the pool downstream. This works where nothing
   is mapped, which is the point. Checked against the one dam that has a zone: traced from Bang
   Lang it gives a catchment of 1,992 km2 (RID's figure above the dam is about 2,080) and 129 km
   to the Pattani river mouth, against 134 km for the mapped channel.
2. *Where the path stops.* At the first cell whose own catchment is `big_factor` times the
   reservoir's. Past that junction a flood is the receiving river's, and that river has gauges and
   thresholds of its own; a 6 million m3 reservoir must not put its name on Hat Yai's flood (the
   owner, 26 Oct 2026).
3. *The corridor.* Not a radius: the land that drains into the reach itself, below the wall,
   worked out by walking the flow directions upstream from the reach. A radius reaches over the
   divide into the next valley, which lies lower, and the volume balance of step 5 would then be
   spent filling somebody else's valley.
4. *A day's spill.* The reservoir is already full, so what arrives has to leave. The catchment
   above the wall (measured from the same flow accumulation) times the biggest day of rain the
   archive holds near it, times how much of that runs off. Two coefficients give the two bands.
5. *The fill.* The water surface, level above the channel's own falling surface, whose volume over
   the corridor equals that day's spill. The channel surface and the height above it are S7's
   (`zone.py`), so both kinds of zone are read the same way.
6. *The arrival.* No gauge, so no measurement: the length of the reach at an assumed channel
   speed, stated as assumed wherever it is shown.

What it is not: there is no hydraulic model here, no routing and no attenuation. It is a volume
balance on a level pool over a 30 m elevation model. It says which land is low enough, joined to
the channel, and inside the valley this reservoir's water travels down. It cannot say how deep the
water stands at a given hour, and the depth it reports is the depth of the band, not a forecast of
anybody's house (safety rule 8).
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

from .zone import RADAR_FLOOD, RADAR_SEEN, check, polygons, river_surface

# The hazard module's own convention (pipeline/hazard/hand.py): a cell's value says which of the
# eight neighbours its water goes to.
D8_STEPS = {1: (-1, 1), 2: (0, 1), 4: (1, 1), 8: (1, 0), 16: (1, -1), 32: (0, -1), 64: (-1, -1),
            128: (-1, 0)}


def shifted(mask: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """`mask` read at the neighbour (dr, dc) away: out[r, c] = mask[r + dr, c + dc], else False."""
    out = np.zeros_like(mask)
    rows_to = slice(max(0, -dr), mask.shape[0] - max(0, dr))
    cols_to = slice(max(0, -dc), mask.shape[1] - max(0, dc))
    rows_from = slice(max(0, dr), mask.shape[0] - max(0, -dr))
    cols_from = slice(max(0, dc), mask.shape[1] - max(0, -dc))
    out[rows_to, cols_to] = mask[rows_from, cols_from]
    return out


def drains_into(pointer: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Every cell whose flow path reaches `target`, the target included.

    The opposite walk to hazard.hand.downslope_paths: instead of following each cell down, it grows
    the set of cells that drain in. A cell belongs if the neighbour its pointer names already
    belongs, so one pass per direction adds a ring, and the walk ends when a pass adds nothing.
    """
    inside = target.copy()
    frontier = target
    while frontier.any():
        gained = np.zeros_like(inside)
        for value, (dr, dc) in D8_STEPS.items():
            gained |= (pointer == value) & shifted(frontier, dr, dc)
        frontier = gained & ~inside
        inside |= frontier
    return inside


def trace(pointer: np.ndarray, accum_km2: np.ndarray, start: tuple[int, int], own_km2: float,
          big_factor: float, max_cells: int) -> tuple[list[tuple[int, int]], int, str]:
    """The flow path from `start`, and how far down it is still this reservoir's own.

    Returns (the whole path, how many cells of it to keep, why it stopped). The cut is the first
    cell whose catchment is `big_factor` times the reservoir's own: there the water has joined
    something bigger than itself.
    """
    path: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    cut, why = 0, "ran out of flow directions"
    row, col = start
    while (row, col) not in seen:
        seen.add((row, col))
        path.append((row, col))
        if not cut and len(path) > 1 and accum_km2[row, col] > big_factor * own_km2:
            cut = len(path)
            why = f"joined a channel draining {accum_km2[row, col]:.0f} km2"
        value = int(pointer[row, col])
        if value not in D8_STEPS:
            break
        step_r, step_c = D8_STEPS[value]
        row, col = row + step_r, col + step_c
        if not (0 <= row < pointer.shape[0] and 0 <= col < pointer.shape[1]):
            # Only the reason for the cut is reported: a walk that goes further than the zone
            # needs is not why the zone ends.
            why = why if cut else "left the window"
            break
        if len(path) >= max_cells:
            if not cut:
                cut, why = len(path), "reached the longest reach allowed"
            break
    return path, cut or len(path), why


def held_mcm(har: np.ndarray, corridor: np.ndarray, channel: np.ndarray, depth_m: float,
             cell_m: float, floor_below_m: float) -> tuple[float, np.ndarray]:
    """(the water a level `depth_m` above the channel holds, the land it covers).

    The surface is level above the channel's own falling surface, so a cell's depth is that
    surface less the ground. Ground more than `floor_below_m` under the channel is treated as
    exactly that far under it: one pit in a 30 m elevation model must not swallow the whole volume
    and leave the valley dry.
    """
    from scipy import ndimage

    low = ((har <= depth_m) & corridor) | channel
    labels, _ = ndimage.label(low, structure=np.ones((3, 3), bool))
    keep = np.unique(labels[channel])
    wet = np.isin(labels, keep[keep > 0]) & (corridor | channel)
    depth = np.where(wet, np.clip(depth_m - np.maximum(har, -floor_below_m), 0, None), 0.0)
    depth = np.nan_to_num(depth, nan=0.0)
    return float(depth.sum()) * cell_m * cell_m / 1e6, wet


def fill_to_volume(har: np.ndarray, corridor: np.ndarray, channel: np.ndarray, target_mcm: float,
                   cell_m: float, floor_below_m: float, min_m: float, max_m: float):
    """The water surface that holds `target_mcm`, bisected between `min_m` and `max_m`.

    Returns (depth above the channel, the land it covers, the volume held, which bound bit). Both
    bounds are kept honestly: a valley wide and flat enough to hold the volume in a hand's depth
    still gets `min_m`, so the band can be drawn, and a gorge that would need more than `max_m` is
    cut there rather than drawn as a wall of water.
    """
    low_volume, low_mask = held_mcm(har, corridor, channel, min_m, cell_m, floor_below_m)
    if low_volume >= target_mcm:
        return min_m, low_mask, low_volume, "the smallest band already holds it"
    high_volume, high_mask = held_mcm(har, corridor, channel, max_m, cell_m, floor_below_m)
    if high_volume <= target_mcm:
        return max_m, high_mask, high_volume, "the deepest band allowed does not hold it"
    low, high = min_m, max_m
    for _ in range(24):
        middle = (low + high) / 2
        volume, _ = held_mcm(har, corridor, channel, middle, cell_m, floor_below_m)
        if volume < target_mcm:
            low = middle
        else:
            high = middle
    depth = (low + high) / 2
    volume, mask = held_mcm(har, corridor, channel, depth, cell_m, floor_below_m)
    return depth, mask, volume, ""


def daily_rain(frame, suspect_mm: float, run_days: int):
    """ThaiWater's daily rain for one station, with an accumulating gauge turned back into days.

    Some stations report a running total through a wet spell instead of the day's rain. Station 855
    at Sadao ran 164, 333, 455, 719, 980, 1,035 mm through 20-25 November 2025; taken at face value
    that is a 1,035 mm day, which would set a design rain nothing could justify. Differenced it is
    169, 121, 265, 261, 55 mm, which agrees with the satellite's 345 mm over the basin in the 24
    hours ending on the 24th - the Hat Yai flood of that week.

    A run of `run_days` or more days that never falls and reaches `suspect_mm` is read as a running
    total and differenced. A gauge that simply rained hard for several days is left alone, because
    real daily rain goes up and down.
    """
    import pandas as pd

    values = frame.sort_values("ts").reset_index(drop=True)
    series = values["value"].to_numpy(dtype="float64").copy()
    rising = 0
    for i in range(len(series)):
        if i and series[i] >= series[i - 1] > 0:
            rising += 1
        else:
            if rising + 1 >= run_days and series[i - 1] >= suspect_mm:
                first = i - rising - 1
                series[first + 1:i] = np.diff(series[first:i])
            rising = 0
    if rising + 1 >= run_days and len(series) and series[-1] >= suspect_mm:
        first = len(series) - rising - 1
        series[first + 1:] = np.diff(series[first:])
    out = values.copy()
    out["value"] = pd.Series(series).clip(lower=0)
    return out


def biggest_day(data_dir: Path, lon: float, lat: float, cfg: dict) -> dict:
    """The biggest day of rain the archive holds near a reservoir, and the stations it rests on.

    ThaiWater's daily rain, station by station (pipeline/data/tidy/rain_daily). The archive runs
    from 2021, so this is the biggest day in five seasons, not a return period: there is not
    enough of it to fit one, and saying so is better than implying one (safety rule 8). A reading
    above `rain_max_mm` is a broken gauge rather than rain and is left out; a station with less
    than `rain_min_days` of record is not used at all.
    """
    import pandas as pd

    tidy = data_dir / "tidy" / "rain_daily"
    stations = []
    with (data_dir / "stations.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["lat"] and row["lon"]:
                stations.append(row)
    limit = float(cfg["rain_max_mm"])
    found: list[dict] = []
    radius = float(cfg["rain_stations_km"])
    while True:
        for station in stations:
            km = math.hypot((float(station["lon"]) - lon) * 111.3 * math.cos(math.radians(lat)),
                            (float(station["lat"]) - lat) * 110.6)
            if km > radius:
                continue
            files = sorted((tidy / station["station_id"]).glob("*.parquet"))
            if not files:
                continue
            frame = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
            frame = frame.dropna(subset=["value"])
            frame = frame[frame["value"] >= 0]
            if len(frame) < int(cfg["rain_min_days"]):
                continue
            frame = daily_rain(frame, float(cfg["accumulation_mm"]), int(cfg["accumulation_days"]))
            frame = frame[frame["value"] <= limit]
            if len(frame) < int(cfg["rain_min_days"]):
                continue
            biggest = frame.loc[frame["value"].idxmax()]
            found.append({"station_id": int(station["station_id"]), "name_th": station["name_th"],
                          "agency": station["agency"], "km": round(km, 1), "days": int(len(frame)),
                          "max_mm": round(float(biggest["value"]), 1),
                          "max_on": str(biggest["ts"])[:10],
                          "from": str(frame["ts"].min())[:10], "to": str(frame["ts"].max())[:10]})
        if found or radius >= 40:
            break
        radius += 10
    if not found:
        raise ValueError("no usable rain station within 40 km of the reservoir")
    found.sort(key=lambda station: -station["max_mm"])
    return {"rain_mm": found[0]["max_mm"], "radius_km": radius, "stations": found,
            "from": min(station["from"] for station in found),
            "to": max(station["to"] for station in found),
            "note": "the biggest day in the archive since 2021, not a return period"}


def satellite_day(out: Path, code: str) -> dict | None:
    """The wettest 24 hours the satellite saw over this reservoir's own catchment.

    GSMaP, hour by hour, over the catchment polygon the first pass wrote (`spill rain`, which
    reuses the thresholds module's Earth Engine fetch). This is the figure a day's spill should
    rest on: it is rain over the catchment that actually drains to the wall, not a point gauge
    some kilometres away that may be reporting a running total. Returns None before the fetch has
    run, and `biggest_day` then stands in.
    """
    import pandas as pd

    files = sorted((out / "spill" / "rain").glob("*.parquet"))
    if not files:
        return None
    best, seasons = None, []
    for path in files:
        frame = pd.read_parquet(path)
        if code not in frame.columns:
            return None
        seasons.append(path.stem)
        day = frame[code].rolling(24, min_periods=24).sum()
        if day.notna().any() and (best is None or float(day.max()) > best["rain_mm"]):
            best = {"rain_mm": round(float(day.max()), 1), "ending": str(day.idxmax())[:10]}
    if best is None:
        return None
    return {**best, "source": "GSMaP hourly over the catchment, gauge-adjusted",
            "seasons": f"{seasons[0]}..{seasons[-1]}",
            "note": "the wettest 24 hours in nine flood seasons, not a return period"}


def catchment_geojson(out: Path, code: str, geometries: list[dict], area_km2: float) -> None:
    """Keep each reservoir's catchment above the wall in one file, for the rain fetch and a look."""
    path = out / "spill" / "catchments.geojson"
    features = []
    if path.exists():
        features = [f for f in json.loads(path.read_text(encoding="utf-8")).get("features", [])
                    if f.get("properties", {}).get("code") != code]
    merged = {"type": "MultiPolygon",
              "coordinates": [g["coordinates"] for g in geometries if g["type"] == "Polygon"]
              + [part for g in geometries if g["type"] == "MultiPolygon" for part in g["coordinates"]]}
    features.append({"type": "Feature", "properties": {"code": code, "area_km2": round(area_km2, 2)},
                     "geometry": merged})
    features.sort(key=lambda f: f["properties"]["code"])
    write_json(path, {"type": "FeatureCollection", "features": features})


def fetch_catchment_rain(out: Path, cfg: dict, project: str, only: list[int] | None = None) -> None:
    """GSMaP over the reservoir catchments, season by season, with the thresholds module's fetch.

    The same collection, band and grid the flood thresholds were measured on, so the two figures
    can be compared. One parquet per season in <out>/spill/rain, columns named by reservoir; a
    season already fetched is skipped.
    """
    from thresholds import sources

    spill = cfg["spill"]
    path = out / "spill" / "catchments.geojson"
    if not path.exists():
        raise SystemExit("run `spill` once first: it writes the catchments this fetch needs.")
    regions = {f["properties"]["code"]: {"geometry": f["geometry"]}
               for f in json.loads(path.read_text(encoding="utf-8"))["features"]}
    window = spill["seasons"]
    shim = {"rain": spill["rain_fetch"], "seasons": window}
    seasons = only or list(range(int(window["first"]), int(window["last"]) + 1))
    # fetch_rain writes <out>/rain/<season>.parquet, so it is pointed at <out>/spill.
    sources.fetch_rain(regions, shim, seasons, out / "spill", project)


def basin_day_check(pipeline_dir: Path, basin: str) -> dict | None:
    """The biggest 24 hours of satellite rain over the basin, as a check on the gauge above.

    The thresholds module already fetched GSMaP hour by hour over the flood basins
    (out/thresholds/rain). Where a reservoir sits inside one of them, the satellite's wettest day
    is worth printing beside the rain gauge's: a point gauge can miss a cell and can also stick.
    It is a check on the order of magnitude, never an input.
    """
    import pandas as pd

    files = sorted((pipeline_dir / "out/thresholds/rain").glob("*.parquet"))
    if not files:
        return None
    best = None
    for path in files:
        frame = pd.read_parquet(path)
        if basin not in frame.columns:
            return None
        day = frame[basin].rolling(24, min_periods=24).sum()
        if day.notna().any() and (best is None or float(day.max()) > best["mm"]):
            best = {"mm": round(float(day.max()), 1), "ending": str(day.idxmax())[:10]}
    return None if best is None else {**best, "basin": basin, "source": "GSMaP hourly, 2017-2025"}


def by_tambon(index: np.ndarray, n: int, inner: np.ndarray, outer: np.ndarray, chain_m: np.ndarray,
              buildings: np.ndarray | None, land: np.ndarray, cell_km2: float) -> list[dict | None]:
    """Per tambon position 1..n: what each band covers, and where along the reach it starts."""
    rows: list[dict | None] = []
    for position in range(1, n + 1):
        here = index == position
        in_inner, in_outer = here & inner, here & outer
        if not in_outer.any():
            rows.append(None)
            continue
        row = {"zone_km2": round(float(in_inner.sum()) * cell_km2, 2),
               "outer_km2": round(float(in_outer.sum()) * cell_km2, 2),
               "tambon_km2": round(float((here & land).sum()) * cell_km2, 2),
               "km_from_dam": round(float(chain_m[in_outer].min()) / 1000, 1)}
        if buildings is not None:
            row["buildings_zone"] = int(round(float(buildings[in_inner].sum())))
            row["buildings_outer"] = int(round(float(buildings[in_outer].sum())))
        rows.append(row)
    return rows


def arrival_rows(entries: dict[str, dict], velocity_ms: list[float], margin: float) -> list[dict]:
    """One arrival row per tambon, from the reach length at an assumed channel speed.

    There is no gauge below these reservoirs, so there is nothing to measure a travel time from.
    The fast speed gives the earliest the water could arrive and the slow one the latest, both from
    where the reach first touches the tambon. The highest water is given the same window as the
    first rise: over reaches this short the two cannot be told apart, and inventing a separate peak
    would be inventing. `method` carries `peak_measured: false` so a screen can say so.
    """
    from .travel import warn_from

    fast, slow = max(velocity_ms), min(velocity_ms)
    rows = []
    for code, entry in sorted(entries.items(), key=lambda item: (item[1]["km"], item[0])):
        metres = float(entry["km"]) * 1000
        earliest = round(metres / fast / 3600, 1)
        latest = round(metres / slow / 3600, 1)
        rows.append({"tambon_code": code, "via": entry["via"], "km_from_dam": round(entry["km"], 1),
                     "warn_from_h": warn_from(earliest, margin), "earliest_h": earliest,
                     "latest_h": latest, "peak_earliest_h": earliest, "peak_latest_h": latest})
    return rows


def write_csv(path: Path, tambons: list[dict], rows: list[dict | None], arrivals: dict[str, dict],
              code: str) -> int:
    """One row per tambon with land in the outer band."""
    fields = ["reservoir", "tambon_code", "name_th", "name_en", "via", "km_from_dam", "zone_km2",
              "outer_km2", "tambon_km2", "buildings_zone", "buildings_outer", "earliest_h",
              "latest_h"]
    path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for tambon, row in zip(tambons, rows):
            if not row:
                continue
            arrival = arrivals.get(tambon["code"], {})
            writer.writerow({"reservoir": code, "tambon_code": tambon["code"],
                             "name_th": tambon["name_th"], "name_en": tambon["name_en"],
                             "via": arrival.get("via", ""),
                             "earliest_h": arrival.get("earliest_h", ""),
                             "latest_h": arrival.get("latest_h", ""),
                             **{key: row.get(key, "") for key in fields[5:11]}})
            written += 1
    return written


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=float), encoding="utf-8")


def start_cell(accum: np.ndarray, dem: np.ndarray, pool: np.ndarray | None,
               wall: tuple[int, int], snap_cells: int) -> tuple[int, int]:
    """The cell the walk downstream starts from: where this reservoir's water leaves.

    With the pool mapped, that is the cell inside it that the most land drains to - the water
    collects there and the breached surface carries it out past the wall. Without a polygon
    (OpenStreetMap has none for Khlong Sadao or Ban Baik), it is the cell near the given wall
    position with the largest catchment that does not stand above the wall, so the snap cannot
    climb onto the hillside beside the dam.
    """
    if pool is not None and pool.any():
        flat = np.where(pool, accum, -1.0)
        return tuple(int(v) for v in np.unravel_index(np.argmax(flat), flat.shape))  # type: ignore[return-value]
    row, col = wall
    top = max(0, row - snap_cells), max(0, col - snap_cells)
    patch = (slice(top[0], row + snap_cells + 1), slice(top[1], col + snap_cells + 1))
    here = dem[row, col]
    flat = np.where(dem[patch] <= here + 2.0, accum[patch], -1.0)
    found = np.unravel_index(np.argmax(flat), flat.shape)
    return top[0] + int(found[0]), top[1] + int(found[1])


def run(dam: dict, cfg: dict, pipeline_dir: Path, data_dir: Path, out: Path) -> dict:
    """Build the overflow zone of one reservoir. Reads only what the hazard module left on disk."""
    import rasterio
    import shapely
    from pyproj import Transformer
    from rasterio import features
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import Window, from_bounds
    from scipy import ndimage
    from shapely.ops import transform as shp_transform

    from hazard import tambons as tb

    from .zone import height_above_river

    code = dam["code"]
    spill = cfg["spill"]
    max_dist = float(spill["max_distance_km"]) * 1000.0
    reach_limit_m = float(spill["max_reach_km"]) * 1000.0

    with rasterio.open(pipeline_dir / spill["dem"]) as src:
        crs = src.crs.to_string()
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        to_degrees = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
        wall_x, wall_y = to_grid(*dam["dam_point"])
        pad = reach_limit_m + max_dist + 2000
        window = from_bounds(wall_x - pad, wall_y - pad, wall_x + pad, wall_y + pad, src.transform)
        window = window.round_offsets().round_lengths()
        window = window.intersection(Window(0, 0, src.width, src.height))
        dem = src.read(1, window=window).astype("float32")
        dem[dem == src.nodata] = np.nan
        transform = src.window_transform(window)
        cell = float(src.res[0])
    shape = dem.shape
    cell_km2 = cell * cell / 1e6
    with rasterio.open(pipeline_dir / spill["pointer"]) as src:
        pointer = src.read(1, window=window)
    with rasterio.open(pipeline_dir / spill["accum"]) as src:
        accum_km2 = src.read(1, window=window).astype("float32") * cell_km2

    # The pool, where OpenStreetMap maps one.
    pool_path = out / "geojson" / f"{code}_reservoir.geojson"
    pool = None
    if pool_path.exists():
        shapes = [feature["geometry"] for feature
                  in json.loads(pool_path.read_text(encoding="utf-8")).get("features", [])
                  if feature.get("geometry")]
        if shapes:
            in_grid = [shp_transform(to_grid, shapely.geometry.shape(s)) for s in shapes]
            pool = features.rasterize([(shapely.geometry.mapping(g), 1) for g in in_grid],
                                      out_shape=shape, transform=transform, all_touched=True,
                                      dtype="uint8").astype(bool)

    wall_row, wall_col = rasterio.transform.rowcol(transform, wall_x, wall_y)
    start = start_cell(accum_km2, dem, pool, (int(wall_row), int(wall_col)),
                       int(spill["snap_cells"]))
    own_km2 = float(accum_km2[start])
    path, cut, why = trace(pointer, accum_km2, start, own_km2, float(spill["big_factor"]),
                           int(reach_limit_m / cell))

    points = [rasterio.transform.xy(transform, row, col) for row, col in path[:cut]]
    if len(points) < 3:
        raise ValueError(f"{code}: the traced reach is {len(points)} cells; nothing to draw")
    line = shapely.LineString(points)
    channel = np.zeros(shape, bool)
    for row, col in path[:cut]:
        channel[row, col] = True
    rows, cols = np.nonzero(channel)
    xs, ys = rasterio.transform.xy(transform, rows, cols)
    chain = np.zeros(shape, "float32")
    chain[rows, cols] = [line.project(shapely.Point(x, y)) for x, y in zip(xs, ys)]

    # The channel's own surface, and how far above it every cell stands (S7's reading).
    near = ndimage.binary_dilation(channel, iterations=int(spill["surface"]["within_cells"]))
    near &= ~np.isnan(dem)
    _, (index_r, index_c) = ndimage.distance_transform_edt(~channel, return_indices=True)
    centres, surface = river_surface(chain[index_r, index_c][near], dem[near], line.length,
                                     float(spill["surface"]["bin_m"]),
                                     float(spill["surface"]["low_percentile"]))
    har, dist_m, chain_near = height_above_river(dem, channel, chain, centres, surface, cell)

    # The corridor: what drains into the reach below the wall, and nothing from over the divide.
    start_mask = np.zeros(shape, bool)
    start_mask[start] = True
    above_wall = drains_into(pointer, start_mask)
    corridor = (drains_into(pointer, channel) & ~above_wall) | channel
    corridor &= (dist_m <= max_dist) & (~np.isnan(dem) | channel)

    # The catchment above the wall, kept so the rain fetch can ask the satellite about it.
    catchment_geojson(out, code, polygons(above_wall, transform, crs,
                                          float(spill["seed"]["simplify_m"]), 0.0), own_km2)

    # A day's spill: what the catchment above the wall can deliver in the wettest day on record.
    # The satellite over that catchment is the figure if the fetch has run; the rain gauges near
    # the wall are the fallback and, when both exist, the cross-check.
    day = spill["day_spill"]
    gauges = biggest_day(data_dir, *dam["dam_point"], day)
    satellite = satellite_day(out, code)
    basin = basin_day_check(pipeline_dir, dam["rain_basin"]) if dam.get("rain_basin") else None
    rain = {**(satellite or gauges), "from": gauges["from"], "to": gauges["to"],
            "kind": "satellite" if satellite else "rain gauges",
            "gauges": gauges, "satellite": satellite, "basin_check": basin}
    volumes = {band: own_km2 * rain["rain_mm"] * float(day[key]) / 1000.0
               for band, key in (("zone", "runoff"), ("outer", "runoff_outer"))}

    bands, depths = {}, {}
    for band in ("zone", "outer"):
        floor = float(spill["min_depth_m"])
        if band == "outer":
            # The outer band is a margin as well as a wetter day: never the same line as the
            # zone. Where a valley is flat enough to take both volumes in the thinnest band
            # allowed, the extra is what still makes the outer band wider than the zone.
            floor = max(floor, depths["zone"]["depth_m"] + float(spill["outer_extra_m"]))
        depth, mask, held, bound = fill_to_volume(
            har, corridor, channel, volumes[band], cell, float(spill["floor_below_channel_m"]),
            floor, max(floor, float(spill["max_depth_m"])))
        bands[band] = mask
        depths[band] = {"depth_m": round(depth, 2), "wanted_mcm": round(volumes[band], 3),
                        "held_mcm": round(held, 3), "bound": bound}

    # Land is what lies inside a tambon, as S7 does it.
    tambons = tb.tambon_geometries()
    index = tb.index_raster(tambons, crs, transform, shape)
    land = ~np.isnan(dem) & (index > 0)
    inner = bands["zone"] & (land | channel)
    outer = bands["outer"] & (land | channel)

    buildings = None
    if spill.get("buildings") and (pipeline_dir / spill["buildings"]).exists():
        buildings = np.zeros(shape, "float32")
        with rasterio.open(pipeline_dir / spill["buildings"]) as src:
            reproject(rasterio.band(src, 2), buildings, dst_transform=transform, dst_crs=crs,
                      resampling=Resampling.nearest)

    radar = {}
    for name, relative in (spill.get("radar") or {}).items():
        if not (pipeline_dir / relative).exists():
            continue
        painted = np.full(shape, 255, "uint8")
        with rasterio.open(pipeline_dir / relative) as src:
            reproject(rasterio.band(src, 1), painted, dst_transform=transform, dst_crs=crs,
                      dst_nodata=255, resampling=Resampling.nearest)
        flood, seen = np.isin(painted, RADAR_FLOOD), np.isin(painted, RADAR_SEEN)
        radar[name] = {"zone": check(inner, flood, seen, corridor, cell_km2),
                       "outer": check(outer, flood, seen, corridor, cell_km2)}

    per = by_tambon(index, len(tambons), inner, outer, chain_near, buildings, land, cell_km2)
    found = [(position, tambons[position], row) for position, row in enumerate(per) if row]
    in_zone = [(tambon, row) for _, tambon, row in found]
    # S7's two kinds, read the same way: `main` where the channel itself runs through the tambon,
    # `tributary` where it does not but the tambon has low land the water can reach.
    on_channel = {int(value) for value in np.unique(index[channel]) if value > 0}
    entries = {tambon["code"]: {"km": row["km_from_dam"],
                                "via": "main" if position + 1 in on_channel else "tributary"}
               for position, tambon, row in found}
    arrivals = arrival_rows(entries, [float(v) for v in spill["velocity_ms"]],
                            float(spill["safety_margin"]))
    by_code = {row["tambon_code"]: row for row in arrivals}

    seed = {"bands": {band: polygons(mask, transform, crs, float(spill["seed"]["simplify_m"]),
                                     float(spill["seed"]["min_patch_km2"]))
                      for band, mask in (("zone", inner), ("outer", outer))},
            "line": shapely.geometry.mapping(
                shp_transform(to_degrees, line.simplify(float(spill["simplify_m"]))))}

    result = {
        "code": code, "name": dam["name"], "river": dam["river"], "operator": dam["operator"],
        "storage_max_mcm": dam["storage"]["max_mcm"],
        "catchment_km2": round(own_km2, 2),
        "reach_km": round(line.length / 1000, 1),
        "traced_km": round(shapely.LineString([rasterio.transform.xy(transform, r, c)
                                               for r, c in path]).length / 1000, 1),
        "stopped_because": why,
        "reach_end": [round(v, 5) for v in to_degrees(*points[-1])],
        "channel_surface_m": [round(float(surface[0]), 1), round(float(surface[-1]), 1)],
        "rain": rain,
        "runoff": {"zone": float(day["runoff"]), "outer": float(day["runoff_outer"])},
        "bands": depths,
        "zone_km2": round(float(inner.sum()) * cell_km2, 2),
        "outer_km2": round(float(outer.sum()) * cell_km2, 2),
        "buildings_zone": None if buildings is None else int(round(float(buildings[inner].sum()))),
        "buildings_outer": None if buildings is None else int(round(float(buildings[outer].sum()))),
        "tambons": len(in_zone),
        "tambons_with_zone": sum(1 for _, row in in_zone if row["zone_km2"] > 0),
        "radar": radar,
        "arrival_h": [min((row["earliest_h"] for row in arrivals), default=None),
                      max((row["latest_h"] for row in arrivals), default=None)],
        "velocity_ms": [float(v) for v in spill["velocity_ms"]],
    }

    # What every screen that draws this has to be able to say about it (safety rule 8).
    note = {
        "geometry_note": {
            "source": spill["source"],
            "path_mapped": True,
            "line_from": "fabdem_d8",
            "credit": "FABDEM; flow directions by WhiteboxTools; rain from ThaiWater",
            "reach_km": result["reach_km"],
            "traced_km": result["traced_km"],
            "catchment_km2": result["catchment_km2"],
            "stopped_because": why,
            "zone_depth_m": depths["zone"]["depth_m"],
            "outer_depth_m": depths["outer"]["depth_m"],
            "day_spill_mcm": round(volumes["zone"], 3),
            "rain_mm": rain["rain_mm"],
            "rain_record": f"{rain['from']}..{rain['to']}",
            "arrivals_source": spill["arrival_source"],
            "limits_en": ("The line below the reservoir is the elevation model's own flow path, "
                          "not a mapped channel, and it stops where the water joins a channel ten "
                          "times its size. The band is the level that would hold one day of spill "
                          "from a full reservoir, worked out on a 30 m model with no routing and "
                          "no hydraulic model. It says which land is low enough and joined to the "
                          "channel, not how deep the water will stand. No gauge stands below this "
                          "reservoir, so the arrival times are an assumed channel speed, not a "
                          "measurement."),
        },
        "method": {
            "kind": "reservoir_spill",
            "reach_km": result["reach_km"],
            "catchment_km2": result["catchment_km2"],
            "rain_mm": rain["rain_mm"],
            "rain_note": rain["note"],
            "runoff": {"zone": float(day["runoff"]), "outer": float(day["runoff_outer"])},
            "day_spill_mcm": {band: depths[band]["wanted_mcm"] for band in depths},
            "dem": "FABDEM 30 m, breached and filled (hazard module)",
            "validated": False,
        },
        "arrivals_method": {
            "kind": "assumed_velocity",
            "velocity_ms": [float(v) for v in spill["velocity_ms"]],
            "safety_margin": float(spill["safety_margin"]),
            "peak_measured": False,
            "note": ("no gauge below this reservoir: the reach length at an assumed channel speed, "
                     "not measured"),
        },
        "grades": {
            "near_full_pct": float(spill["near_full_pct"]),
            "full_pct": float(spill["full_pct"]),
        },
    }

    write_json(out / "spill" / f"{code}.json", {**result, "note": note})
    write_csv(out / "spill" / f"{code}_by_tambon.csv", [t for t, _ in in_zone],
              [row for _, row in in_zone], by_code, code)
    write_json(out / "geojson" / f"{code}_spill.geojson", {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"kind": "reach", "km": result["reach_km"]},
                      "geometry": seed["line"]}]
        + [{"type": "Feature", "properties": {"kind": band, "depth_m": depths[band]["depth_m"]},
            "geometry": geometry}
           for band, geometries in seed["bands"].items() for geometry in geometries]})
    return {**result, "seed": seed, "arrivals": arrivals, "note": note,
            "tambon_rows": [{"tambon": tambon, "row": row} for tambon, row in in_zone]}


def seed_sql(results: list[dict], cfg: dict) -> str:
    """supabase/seed/43_dam_spill_zone.sql: generated, never edited by hand.

    Every reservoir here gets the same four things Bang Lang has - a reach, the two bands, the
    tambon list and the arrival ranges - under its own source, so the older OpenStreetMap rows
    stay where they are and can still be compared against these.
    """
    from .travel import seed_sql as arrivals_sql

    spill = cfg["spill"]
    source, arrivals_source = spill["source"], spill["arrival_source"]
    quote = lambda text: text.replace("'", "''")  # noqa: E731
    out = ["-- Generated by pipeline/dam_release (`spill --seed`). Do not edit by hand.",
           "-- The land a full reservoir's own day of spill can reach: the flow path from the",
           "-- elevation model, cut where the water joins a channel ten times its size, and the",
           "-- level that holds that day's volume (pipeline/dam_release/METHODS.md, \"A full",
           "-- reservoir's own zone\"). Not a hydraulic model, and no gauge stands below any of",
           "-- these reservoirs: the arrival ranges are an assumed channel speed.", ""]
    for result in results:
        code = result["code"]
        note = result["note"]
        out += [f"-- {code}: {result['reach_km']} km of reach, {result['zone_km2']} km2 in "
                f"{result['tambons']} tambons.",
                f"delete from public.dam_zones where dam_code = '{code}' and source = '{source}';"]
        for band, geometries in result["seed"]["bands"].items():
            multi = {"type": "MultiPolygon",
                     "coordinates": [g["coordinates"] for g in geometries if g["type"] == "Polygon"]
                     + [part for g in geometries if g["type"] == "MultiPolygon"
                        for part in g["coordinates"]]}
            method = {**note["method"], "band": band,
                      "depth_m": result["bands"][band]["depth_m"]}
            out.append(
                f"insert into public.dam_zones (dam_code, source, band, geom, method) values "
                f"('{code}', '{source}', '{band}', extensions.st_multi("
                f"extensions.st_collectionextract(extensions.st_makevalid(extensions.st_setsrid("
                f"extensions.st_geomfromgeojson('{json.dumps(multi, separators=(',', ':'))}'), "
                f"4326)), 3)), '{quote(json.dumps(method, ensure_ascii=False))}'::jsonb);")
        river = quote(json.dumps(result["river"], ensure_ascii=False))
        out += ["",
                f"delete from public.dam_reaches where dam_code = '{code}' and source = '{source}';",
                "insert into public.dam_reaches (dam_code, source, kind, seq, name, km_from_dam,"
                " length_km, line) values",
                f"  ('{code}', '{source}', 'main', 0, '{river}'::jsonb, 0, {result['reach_km']}, "
                f"extensions.st_setsrid(extensions.st_geomfromgeojson("
                f"'{json.dumps(result['seed']['line'], separators=(',', ':'))}'), 4326));", "",
                f"delete from public.dam_tambons where dam_code = '{code}' and source = '{source}';",
                "insert into public.dam_tambons (dam_code, source, tambon_code, via, km_from_dam)"
                " values"]
        out.append(",\n".join(
            f"  ('{code}', '{source}', '{row['tambon_code']}', '{row['via']}', "
            f"{row['km_from_dam']})" for row in result["arrivals"]) + ";")
        body = arrivals_sql(code, arrivals_source, result["arrivals"], note["arrivals_method"])
        out += ["", "\n".join(line for line in body.split("\n")
                              if not line.startswith("--")).strip(), "",
                f"update public.dams set geometry_source = '{source}', updated_at = now(),",
                f"       geometry_note = geometry_note || "
                f"'{quote(json.dumps(note['geometry_note'], ensure_ascii=False))}'::jsonb,",
                f"       grades = coalesce(grades, '{{}}'::jsonb) || "
                f"'{quote(json.dumps(note['grades'], ensure_ascii=False))}'::jsonb",
                f" where code = '{code}';", ""]
    return "\n".join(out)
