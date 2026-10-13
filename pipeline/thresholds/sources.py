"""Where the signals come from: basin rainfall (GSMaP on Earth Engine), modelled discharge
(GloFAS through Open-Meteo's free flood API) and the gauges already in the ThaiWater archive.

Everything fetched is cached under <output_dir>; a second run asks only for what is missing.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import pandas as pd

log = logging.getLogger("thresholds")


def season_window(year: int, start_month: int, end_month: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    start = pd.Timestamp(year=year, month=start_month, day=1, tz="UTC")
    end = pd.Timestamp(year=year + 1, month=end_month, day=1, tz="UTC") + pd.offsets.MonthBegin(1)
    return start, end


def fetch_rain(basins: dict, cfg: dict, seasons: list[int], out: Path, project: str) -> None:
    """Hourly basin-mean rain per season -> <out>/rain/<season>.parquet (columns: one per basin)."""
    import ee

    from sar_floods import ee_ops

    ee_ops.init(project)
    rcfg, scfg = cfg["rain"], cfg["seasons"]
    regions = ee.FeatureCollection([ee.Feature(ee.Geometry(g["geometry"]), {"basin": name}) for name, g in basins.items()])
    (out / "rain").mkdir(parents=True, exist_ok=True)
    for year in seasons:
        dest = out / "rain" / f"{year}.parquet"
        if dest.exists():
            continue
        start, end = season_window(year, scfg["start_month"], scfg["end_month"])
        end = min(end, pd.Timestamp.now(tz="UTC").floor("D"))
        rows, t0 = [], time.time()
        a = start
        while a < end:
            b = min(a + pd.Timedelta(days=int(rcfg["chunk_days"])), end)
            col = ee.ImageCollection(rcfg["collection"]).filterDate(a.isoformat(), b.isoformat()).select(rcfg["band"])

            def one(img):
                fc = img.reduceRegions(regions, ee.Reducer.mean(), rcfg["scale_m"])
                t = img.date().millis()
                return fc.map(lambda f: ee.Feature(None, {"t": t, "basin": f.get("basin"), "mm": f.get("mean")}))

            for attempt in range(4):
                try:
                    feats = ee.FeatureCollection(col.map(one)).flatten().getInfo()["features"]
                    break
                except Exception as exc:  # noqa: BLE001 - Earth Engine raises its own class for a busy server
                    if attempt == 3:
                        raise
                    log.warning("rain %s %s: %s; trying again", year, a.date(), str(exc)[:120])
                    time.sleep(20 * (attempt + 1))
            rows += [f["properties"] for f in feats]
            a = b
        if not rows:
            log.warning("season %s: no rain images", year)
            continue
        df = pd.DataFrame(rows)
        df["ts"] = pd.to_datetime(df["t"], unit="ms", utc=True)
        wide = df.pivot_table(index="ts", columns="basin", values="mm", aggfunc="mean").sort_index()
        wide.to_parquet(dest)
        log.info("season %s: %s hours, %.0f s", year, len(wide), time.time() - t0)


def read_rain(out: Path) -> pd.DataFrame:
    files = sorted((out / "rain").glob("*.parquet"))
    if not files:
        return pd.DataFrame()
    return pd.concat(pd.read_parquet(f) for f in files).sort_index()


def fetch_glofas(points: dict[str, tuple[float, float]], cfg: dict, first: str, last: str, out: Path, agent: str) -> dict:
    """Daily modelled discharge at each point -> <out>/glofas/<name>.json. Returns the cell each answer came from."""
    import requests

    (out / "glofas").mkdir(parents=True, exist_ok=True)
    where = {}
    for name, (lon, lat) in points.items():
        dest = out / "glofas" / f"{name}.json"
        if not dest.exists():
            step = float(cfg["glofas"].get("search_deg", 0))
            best, best_mean = None, -1.0
            for dx in ((-step, 0.0, step) if step else (0.0,)):
                for dy in ((-step, 0.0, step) if step else (0.0,)):
                    r = requests.get(cfg["glofas"]["url"], timeout=120, headers={"User-Agent": agent},
                                     params={"latitude": lat + dy, "longitude": lon + dx, "daily": "river_discharge",
                                             "start_date": first, "end_date": last})
                    r.raise_for_status()
                    data = r.json()
                    values = [v for v in data["daily"]["river_discharge"] if v is not None]
                    mean = sum(values) / len(values) if values else -1.0
                    if mean > best_mean:
                        best, best_mean = data, mean
                    time.sleep(1)
            dest.write_text(json.dumps(best), encoding="utf-8")
        data = json.loads(dest.read_text(encoding="utf-8"))
        where[name] = {"asked": [lon, lat], "cell": [data.get("longitude"), data.get("latitude")]}
    return where


def read_glofas(out: Path, name: str) -> pd.Series:
    path = out / "glofas" / f"{name}.json"
    if not path.exists():
        return pd.Series(dtype=float)
    d = json.loads(path.read_text(encoding="utf-8"))["daily"]
    return pd.Series(d["river_discharge"], index=pd.to_datetime(d["time"], utc=True), dtype=float).dropna()
