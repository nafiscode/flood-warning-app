"""Turn raw ThaiWater JSON into a long, tidy table and merge it into monthly Parquet partitions.

Tidy schema (one row per station, variable and timestamp):
    station_id  int64     ThaiWater station id (see stations.csv for codes and names)
    variable    string    water_level_msl | discharge | rain_daily | rain_1h
    ts          UTC       timestamp as labelled by ThaiWater, converted from Bangkok time
    value       float64
    unit        string    m | m3/s | mm
    source      string    thaiwater
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .settings import BANGKOK

COLUMNS = ["station_id", "variable", "ts", "value", "unit", "source"]
KEY = ["station_id", "variable", "ts"]
UNITS = {"water_level_msl": "m", "discharge": "m3/s", "rain_daily": "mm", "rain_1h": "mm"}


def empty_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "station_id": pd.Series(dtype="int64"),
            "variable": pd.Series(dtype="string"),
            "ts": pd.Series(dtype="datetime64[ns, UTC]"),
            "value": pd.Series(dtype="float64"),
            "unit": pd.Series(dtype="string"),
            "source": pd.Series(dtype="string"),
        }
    )


def _frame(station_id: int, variable: str, times: list, values: list) -> pd.DataFrame:
    df = pd.DataFrame({"t": times, "value": pd.to_numeric(pd.Series(values, dtype="object"), errors="coerce")})
    df = df.dropna(subset=["t", "value"]).reset_index(drop=True)
    if df.empty:
        return empty_frame()
    n = len(df)
    return pd.DataFrame(
        {
            "station_id": pd.Series([station_id] * n, dtype="int64"),
            "variable": pd.Series([variable] * n, dtype="string"),
            "ts": pd.to_datetime(df["t"], format="mixed")
            .dt.tz_localize(BANGKOK)
            .dt.tz_convert("UTC")
            .dt.as_unit("ns"),
            "value": df["value"].astype("float64"),
            "unit": pd.Series([UNITS[variable]] * n, dtype="string"),
            "source": pd.Series(["thaiwater"] * n, dtype="string"),
        }
    )[COLUMNS]


def waterlevel_frame(station_id: int, payload: dict) -> pd.DataFrame:
    graph = ((payload or {}).get("data") or {}).get("graph_data") or []
    times = [g.get("datetime") for g in graph]
    parts = [
        _frame(station_id, "water_level_msl", times, [g.get("value") for g in graph]),
        _frame(station_id, "discharge", times, [g.get("discharge") for g in graph]),
    ]
    parts = [p for p in parts if not p.empty]
    return pd.concat(parts, ignore_index=True) if parts else empty_frame()


def rain_frame(station_id: int, payload: dict, variable: str) -> pd.DataFrame:
    rows = (payload or {}).get("data") or []
    if not isinstance(rows, list):
        return empty_frame()
    return _frame(
        station_id,
        variable,
        [r.get("rainfall_datetime") for r in rows],
        [r.get("rainfall_value") for r in rows],
    )


def merge_into_partitions(df: pd.DataFrame, tidy_root: Path) -> int:
    """Merge rows into tidy/{variable}/{station_id}/{YYYY-MM}.parquet (UTC months).
    Idempotent: de-duplicates on (station_id, variable, ts), keeping the newest value, and
    skips writing a partition whose content did not change (keeps git history small).
    Returns the number of partitions written."""
    if df.empty:
        return 0
    written = 0
    months = df["ts"].dt.strftime("%Y-%m")
    for (variable, station_id, month), part in df.groupby([df["variable"], df["station_id"], months]):
        path = tidy_root / str(variable) / str(station_id) / f"{month}.parquet"
        old = pd.read_parquet(path) if path.exists() else None
        merged = part if old is None else pd.concat([old, part], ignore_index=True)
        merged = (
            merged.drop_duplicates(subset=KEY, keep="last").sort_values("ts").reset_index(drop=True)[COLUMNS]
        )
        if old is not None and len(old) == len(merged) and old.reset_index(drop=True).equals(merged):
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".parquet.tmp")
        merged.to_parquet(tmp, index=False, compression="zstd")
        tmp.replace(path)
        written += 1
    return written


def count_values(df: pd.DataFrame, variable: str) -> int:
    return int((df["variable"] == variable).sum()) if not df.empty else 0


def save_raw(path: Path, body: bytes) -> None:
    """Keep the untouched response body, gzip-compressed."""
    import gzip

    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=6) as f:
        f.write(body)
