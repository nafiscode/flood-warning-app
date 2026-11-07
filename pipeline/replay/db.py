"""The database side of the replay: the connection, the cron switch, and the writes.

Everything here is deliberately small and explicit. The caller (replay/__main__.py) has already
confirmed the target; this module just does what it is told and can always put the crons back.
"""

from __future__ import annotations

import logging
from datetime import datetime

import psycopg

log = logging.getLogger("replay")

# The ingestion jobs the replay pauses, so the live ThaiWater feed does not overwrite the replayed
# readings. The alarm and the push tick are left running on purpose: they are what is rehearsed.
INGESTION_CRONS: tuple[str, ...] = (
    "jaga-gauge-readings",
    "jaga-dam-readings",
    "jaga-signal-forecasts",
)


def connect(url: str) -> psycopg.Connection:
    """A single autocommit connection. Supabase requires TLS; the URL carries sslmode."""
    return psycopg.connect(url, autocommit=True, connect_timeout=15)


def station_ids(conn: psycopg.Connection, thaiwater_ids: list[str]) -> dict[str, str]:
    """ThaiWater id (text) -> our stations.id (uuid, as text), for the gauges we have."""
    if not thaiwater_ids:
        return {}
    ids = [int(x) for x in thaiwater_ids if x.isdigit()]
    rows = conn.execute(
        "select thaiwater_id, id from public.stations where thaiwater_id = any(%s)", (ids,)
    ).fetchall()
    return {str(tw): str(uid) for tw, uid in rows}


def dam_codes(conn: psycopg.Connection, thaiwater_ids: list[str]) -> dict[str, str]:
    """ThaiWater hourly id (text) -> dams.code, for the dams we have."""
    if not thaiwater_ids:
        return {}
    ids = [int(x) for x in thaiwater_ids if x.isdigit()]
    rows = conn.execute(
        "select thaiwater_hourly_id, code from public.dams where thaiwater_hourly_id = any(%s)",
        (ids,),
    ).fetchall()
    return {str(tw): code for tw, code in rows}


def insert_observation(
    conn: psycopg.Connection, station_uuid: str, ts: datetime, variable: str, value: float
) -> None:
    conn.execute(
        "insert into public.observations (station_id, ts, variable, value) values (%s,%s,%s,%s) "
        "on conflict (station_id, variable, ts) do update set value = excluded.value",
        (station_uuid, ts, variable, value),
    )


def upsert_dam_reading(
    conn: psycopg.Connection, dam_code: str, observed_at: datetime, columns: dict[str, float]
) -> None:
    """One dam_readings row for a moment, built from whichever dam columns are known then."""
    cols = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    updates = ", ".join(
        f"{c} = coalesce(excluded.{c}, public.dam_readings.{c})" for c in columns
    )
    conn.execute(
        f"insert into public.dam_readings (dam_code, observed_at, {cols}) "
        f"values (%s, %s, {placeholders}) "
        f"on conflict (dam_code, observed_at) do update set {updates}",
        (dam_code, observed_at, *columns.values()),
    )


def cron_state(conn: psycopg.Connection, names: tuple[str, ...]) -> dict[str, bool]:
    """Which of the named cron jobs exist, and whether each is currently active."""
    rows = conn.execute(
        "select jobname, active from cron.job where jobname = any(%s)", (list(names),)
    ).fetchall()
    return {name: bool(active) for name, active in rows}


def set_cron_active(conn: psycopg.Connection, name: str, active: bool) -> bool:
    """Turn one cron job on or off by name. Returns False if there is no such job."""
    row = conn.execute("select jobid from cron.job where jobname = %s", (name,)).fetchone()
    if row is None:
        return False
    conn.execute("select cron.alter_job(job_id := %s, active := %s)", (row[0], active))
    return True
