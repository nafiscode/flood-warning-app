"""Pure helpers for the replay: reading the archive, mapping the clock, parsing the target.

Nothing here touches a database or the network, so it is all unit-tested (tests/test_replay.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pandas as pd

# River-gauge (and rain) variables stored per station in the tidy archive, written straight into
# public.observations under the same variable name (schema: 20260929120500_alerts_monitoring_admin).
GAUGE_VARS: tuple[str, ...] = ("water_level_msl", "discharge", "rain_1h", "rain_daily")

# Dam variables in the archive -> columns of public.dam_readings (schema: a12_dam_release).
DAM_VARS: dict[str, str] = {
    "dam_level": "level_m",
    "dam_storage": "storage_mcm",
    "dam_inflow_1h": "inflow_mcm_h",
    "dam_released_1h": "released_mcm_h",
    "dam_spilled_1h": "spilled_mcm_h",
}

UTC = timezone.utc


@dataclass(frozen=True)
class Target:
    """A database to act on, named by what is safe to show (never the password)."""

    ref: str | None
    host: str

    def label(self) -> str:
        return f"{self.ref or '?'} ({self.host})"


def parse_target(url: str) -> Target:
    """The Supabase project ref and host from a connection URL, the way scripts/db.mjs names it:
    the ref is public (it is part of NEXT_PUBLIC_SUPABASE_URL); the password never appears."""
    at = urlsplit(url)
    user = unquote(at.username or "")
    ref: str | None = None
    if user.startswith("postgres."):
        tail = user.split(".", 1)[1]
        if tail:
            ref = tail
    return Target(ref=ref, host=at.hostname or "?")


def same_database(a: str | None, b: str | None) -> bool:
    """Whether two connection URLs point at the same project (host + ref), so a copied .env.local
    that aims both at one project is caught before anything is written."""
    if not a or not b:
        return False
    ta, tb = parse_target(a), parse_target(b)
    return ta.host == tb.host and ta.ref == tb.ref


def _months(t_from: datetime, t_to: datetime) -> list[str]:
    """The YYYY-MM month keys the window [t_from, t_to] touches."""
    out: list[str] = []
    y, m = t_from.year, t_from.month
    while (y, m) <= (t_to.year, t_to.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def tidy_dir(data_root: Path, variable: str) -> Path:
    return data_root / "tidy" / variable


def stations_with(data_root: Path, variable: str) -> list[str]:
    """ThaiWater ids (folder names) that have a `variable` series in the archive."""
    d = tidy_dir(data_root, variable)
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_dir())


def read_series(
    data_root: Path,
    variable: str,
    thaiwater_id: str,
    t_from: datetime,
    t_to: datetime,
) -> pd.DataFrame:
    """One station's readings of one variable inside the window, as columns [ts, value] in UTC."""
    frames: list[pd.DataFrame] = []
    base = tidy_dir(data_root, variable) / thaiwater_id
    for month in _months(t_from, t_to):
        f = base / f"{month}.parquet"
        if f.is_file():
            frames.append(pd.read_parquet(f, columns=["ts", "value"]))
    if not frames:
        return pd.DataFrame({"ts": pd.Series([], dtype="datetime64[ns, UTC]"), "value": []})
    df = pd.concat(frames, ignore_index=True)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df[(df["ts"] >= t_from) & (df["ts"] <= t_to) & df["value"].notna()]
    return df.sort_values("ts").reset_index(drop=True)


@dataclass(frozen=True)
class Event:
    """One archive reading waiting to be written. `sim_ts` is its real Nov-2025 time; the writer
    turns that into a wall-clock `ts` with wall_due()."""

    sim_ts: datetime
    kind: str  # "gauge" or "dam"
    thaiwater_id: str
    field: str  # observations.variable, or a dam_readings column
    value: float


def build_events(
    data_root: Path,
    t_from: datetime,
    t_to: datetime,
    *,
    want_gauges: bool,
    want_dam: bool,
) -> list[Event]:
    """Every reading in the window, from both the gauge/rain series and the dam, sorted by time."""
    events: list[Event] = []
    if want_gauges:
        for variable in GAUGE_VARS:
            for sid in stations_with(data_root, variable):
                df = read_series(data_root, variable, sid, t_from, t_to)
                for ts, value in zip(df["ts"], df["value"]):
                    events.append(Event(ts.to_pydatetime(), "gauge", sid, variable, float(value)))
    if want_dam:
        # The dam id folders live under any dam variable; dam_level is always present.
        for variable, column in DAM_VARS.items():
            for dam_id in stations_with(data_root, variable):
                df = read_series(data_root, variable, dam_id, t_from, t_to)
                for ts, value in zip(df["ts"], df["value"]):
                    events.append(Event(ts.to_pydatetime(), "dam", dam_id, column, float(value)))
    events.sort(key=lambda e: e.sim_ts)
    return events


def wall_due(sim_ts: datetime, sim_start: datetime, run_start: datetime, speed: float) -> datetime:
    """When a reading at `sim_ts` should be written: the run's start plus the archive time elapsed
    since `sim_start`, compressed by `speed`. So the whole season plays in (span / speed)."""
    elapsed = (sim_ts - sim_start).total_seconds() / speed
    return run_start + timedelta(seconds=elapsed)


def wall_duration(sim_start: datetime, sim_end: datetime, speed: float) -> timedelta:
    return timedelta(seconds=(sim_end - sim_start).total_seconds() / speed)


def default_window(year: int = 2025, month: int = 11) -> tuple[datetime, datetime]:
    """The whole of a month in UTC. The operator usually narrows this with --from/--to."""
    start = datetime(year, month, 1, tzinfo=UTC)
    end = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=UTC) - timedelta(seconds=1)
    return start, end
