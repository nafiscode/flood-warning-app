"""Build the station list for the four provinces from three ThaiWater list endpoints.

- /public/waterlevel_load  : water-level stations currently reporting (richest metadata, bank levels)
- /public/rain_24h         : rain stations currently reporting
- /frontend/shared/station_all : every registered station, including ones no longer reporting
  (station_type W = water level, R = rain, A = both, empty = unknown, probed as water level)

Stations are kept only if their province code is in scope AND they fall inside the bounding box
(stations without coordinates are kept and flagged). Stations seen in earlier runs are never
dropped, so the archive stays complete if a station disappears from the lists.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import pandas as pd

from .client import ThaiWaterClient

log = logging.getLogger(__name__)

COLUMNS = [
    "station_id", "old_code", "name_th", "name_en", "lat", "lon", "in_bbox",
    "province_code", "province_en", "amphoe_en", "tumbon_en", "geocode",
    "agency", "basin_code", "basin_name_en", "sub_basin_id", "river_name",
    "wl_candidate", "rain_candidate", "wl_reporting", "rain_reporting",
    "min_bank_m", "left_bank_m", "right_bank_m", "ground_level_m",
    "warning_level_m", "critical_level_m", "critical_level_msl", "is_key_station",
    "listed_in", "first_seen", "last_seen",
]
BOOL_COLS = ["in_bbox", "wl_candidate", "rain_candidate", "wl_reporting", "rain_reporting"]


def _en(d, lang="en"):
    if isinstance(d, dict):
        return d.get(lang) or None
    return d or None


def _merge(rows: dict, sid, fields: dict, source: str) -> None:
    sid = int(sid)
    row = rows.setdefault(sid, {"station_id": sid, "listed_in": set()})
    for k, v in fields.items():
        if v is None or v == "":
            continue
        if k in BOOL_COLS:
            row[k] = bool(row.get(k)) or bool(v)
        elif row.get(k) in (None, ""):
            row[k] = v
    row["listed_in"].add(source)


def _from_waterlevel_load(rows: dict, payload: dict) -> None:
    for rec in ((payload.get("waterlevel_data") or {}).get("data") or []):
        st, geo = rec.get("station") or {}, rec.get("geocode") or {}
        if not st.get("id"):
            continue
        _merge(rows, st["id"], {
            "old_code": st.get("tele_station_oldcode"),
            "name_th": _en(st.get("tele_station_name"), "th"),
            "name_en": _en(st.get("tele_station_name")),
            "lat": st.get("tele_station_lat"), "lon": st.get("tele_station_long"),
            "province_code": geo.get("province_code"),
            "province_en": _en(geo.get("province_name")),
            "amphoe_en": _en(geo.get("amphoe_name")), "tumbon_en": _en(geo.get("tumbon_name")),
            "agency": _en((rec.get("agency") or {}).get("agency_shortname")),
            "basin_code": (rec.get("basin") or {}).get("basin_code"),
            "basin_name_en": _en((rec.get("basin") or {}).get("basin_name")),
            "sub_basin_id": st.get("sub_basin_id"), "river_name": rec.get("river_name"),
            "min_bank_m": st.get("min_bank"), "left_bank_m": st.get("left_bank"),
            "right_bank_m": st.get("right_bank"), "ground_level_m": st.get("ground_level"),
            "warning_level_m": st.get("warning_level_m"), "critical_level_m": st.get("critical_level_m"),
            "critical_level_msl": st.get("critical_level_msl"), "is_key_station": st.get("is_key_station"),
            "wl_candidate": True, "wl_reporting": True,
        }, "waterlevel_load")


def _from_rain_24h(rows: dict, payload: dict) -> None:
    for rec in payload.get("data") or []:
        st, geo = rec.get("station") or {}, rec.get("geocode") or {}
        if not st.get("id"):
            continue
        _merge(rows, st["id"], {
            "old_code": st.get("tele_station_oldcode"),
            "name_th": _en(st.get("tele_station_name"), "th"),
            "name_en": _en(st.get("tele_station_name")),
            "lat": st.get("tele_station_lat"), "lon": st.get("tele_station_long"),
            "province_code": geo.get("province_code"),
            "province_en": _en(geo.get("province_name")),
            "amphoe_en": _en(geo.get("amphoe_name")), "tumbon_en": _en(geo.get("tumbon_name")),
            "agency": _en((rec.get("agency") or {}).get("agency_shortname")),
            "basin_code": (rec.get("basin") or {}).get("basin_code"),
            "basin_name_en": _en((rec.get("basin") or {}).get("basin_name")),
            "sub_basin_id": st.get("sub_basin_id"),
            "rain_candidate": True, "rain_reporting": True,
        }, "rain_24h")


def _from_station_all(rows: dict, payload: dict) -> None:
    for rec in payload.get("data") or []:
        if not rec.get("station_id"):
            continue
        stype = rec.get("station_type")
        _merge(rows, rec["station_id"], {
            "old_code": rec.get("station_old_code"),
            "name_th": _en(rec.get("station_name"), "th"),
            "name_en": _en(rec.get("station_name")),
            "lat": rec.get("station_lat"), "lon": rec.get("station_long"),
            "province_code": rec.get("province_code"),
            "province_en": _en(rec.get("province_name")),
            "amphoe_en": _en(rec.get("amphoe_name")), "tumbon_en": _en(rec.get("tumbon_name")),
            "geocode": rec.get("geocode"),
            "wl_candidate": stype in ("W", "A", None, ""),
            "rain_candidate": stype in ("R", "A"),
        }, "station_all")


def build(payloads: dict[str, list[dict]], cfg: dict) -> pd.DataFrame:
    """payloads: {'waterlevel_load': [...], 'rain_24h': [...], 'station_all': [...]} per province.
    Pure function (no network) so it can be tested with fixtures."""
    rows: dict = {}
    for p in payloads.get("waterlevel_load", []):
        _from_waterlevel_load(rows, p)
    for p in payloads.get("rain_24h", []):
        _from_rain_24h(rows, p)
    for p in payloads.get("station_all", []):
        _from_station_all(rows, p)

    df = pd.DataFrame(list(rows.values()))
    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    df["listed_in"] = df["listed_in"].map(lambda s: ";".join(sorted(s)))
    for c in COLUMNS:
        if c not in df:
            df[c] = None
    for c in BOOL_COLS:
        df[c] = df[c].fillna(False).astype(bool)
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
    min_lon, min_lat, max_lon, max_lat = cfg["bbox"]
    has_xy = df["lat"].notna() & df["lon"].notna()
    df["in_bbox"] = ~has_xy | (df["lon"].between(min_lon, max_lon) & df["lat"].between(min_lat, max_lat))
    df["province_code"] = df["province_code"].astype("string").str.zfill(2)
    keep = df["province_code"].isin(list(cfg["provinces"])) & df["in_bbox"]
    dropped = df.loc[~keep, "station_id"].tolist()
    if dropped:
        log.info("dropped %d stations outside the provinces/box: %s", len(dropped), dropped[:20])
    return df.loc[keep, COLUMNS].sort_values("station_id").reset_index(drop=True)


def fetch(client: ThaiWaterClient, cfg: dict) -> dict[str, list[dict]]:
    payloads: dict[str, list[dict]] = {"waterlevel_load": [], "rain_24h": [], "station_all": []}
    for pc in cfg["provinces"]:
        payloads["waterlevel_load"].append(client.get("/public/waterlevel_load", {"province_code": pc}))
        payloads["rain_24h"].append(client.get("/public/rain_24h", {"province_code": pc}))
        payloads["station_all"].append(client.get("/frontend/shared/station_all", {"province_code": pc}))
    return payloads


def merge_with_previous(new: pd.DataFrame, previous: pd.DataFrame | None) -> pd.DataFrame:
    """Keep stations from earlier runs; refresh metadata for stations seen now."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    new = new.copy()
    new["last_seen"] = now
    if previous is None or previous.empty:
        new["first_seen"] = now
        return new
    prev = previous.set_index("station_id")
    new["first_seen"] = new["station_id"].map(prev["first_seen"]).fillna(now)
    # "Reporting" flags describe the current lists only; stations missing now keep their old row.
    gone = previous[~previous["station_id"].isin(new["station_id"])].copy()
    for c in ("wl_reporting", "rain_reporting"):
        gone[c] = False
    out = pd.concat([new, gone], ignore_index=True)
    for c in BOOL_COLS:
        out[c] = out[c].astype(bool)
    return out[COLUMNS].sort_values("station_id").reset_index(drop=True)


def read_csv(path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    df = pd.read_csv(path, dtype={"province_code": "string", "geocode": "string", "old_code": "string"})
    for c in BOOL_COLS:
        df[c] = df[c].astype(bool)
    return df


def write_csv(df: pd.DataFrame, path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8")
