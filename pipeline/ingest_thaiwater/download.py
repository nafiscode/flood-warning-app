"""Download jobs: water-level history, daily rain history, hourly rain (recent window only).

Endpoint facts (verified 2026-09-28):
- /public/waterlevel_graph returns at most 365 days per request, but older windows are
  reachable, so we walk back one calendar year at a time. Missing data comes back as nulls.
- /public/rain_yearly_graph gives per-month day counts, used to skip months without data.
- /provinces/rain7d_graph returns daily rain for windows of 31 days or less.
- /public/rain_24h_graph returns only the last ~42 h of hourly rain (no history exists).
"""

from __future__ import annotations

import calendar
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import httpx
import pandas as pd

from . import tidy
from .client import BlockedError, ThaiWaterClient
from .settings import Paths, today_bangkok
from .state import State

log = logging.getLogger(__name__)


class Deadline:
    def __init__(self, max_minutes: float | None):
        self.at = time.monotonic() + max_minutes * 60 if max_minutes else None

    def passed(self) -> bool:
        return self.at is not None and time.monotonic() >= self.at


@dataclass
class Ctx:
    client: ThaiWaterClient
    paths: Paths
    cfg: dict
    today: date
    wl_state: State
    rain_state: State


def make_ctx(client: ThaiWaterClient, paths: Paths, cfg: dict) -> Ctx:
    return Ctx(client, paths, cfg, today_bangkok(),
               State(paths.state("waterlevel")), State(paths.state("rain_daily")))


def _get(ctx: Ctx, path: str, params: dict, raw_name: str) -> dict | None:
    """Fetch and keep the raw response. Per-request failures are logged and skipped (the
    state is not advanced, so the next run retries); BlockedError propagates."""
    try:
        payload = ctx.client.get(path, params)
    except BlockedError:
        raise
    except (httpx.HTTPError, ValueError):
        return None
    tidy.save_raw(ctx.paths.raw / f"{raw_name}.json.gz", ctx.client.last_raw)
    return payload


# ---------------------------------------------------------------- water level

def year_windows(year: int, today: date, last_ts: str | None) -> tuple[date, date]:
    """Request window for one calendar year. For the current year, fetch only from the day
    before the last stored timestamp."""
    start, end = date(year, 1, 1), min(date(year, 12, 31), today)
    if year == today.year and last_ts:
        start = max(start, datetime.fromisoformat(last_ts).date() - timedelta(days=1))
    return start, end


def _year_has_waterlevel(ctx: Ctx, sid: int, year: int) -> bool:
    """Cheap probe (~1 s, tiny response): the yearly endpoint returns a sparse daily sample,
    empty exactly when the full year has no readings (checked on live stations 2026-09-28).
    On a failed probe, assume data so the full request decides."""
    payload = _get(ctx, "/public/waterlevel_graph_year",
                   {"station_type": "tele_waterlevel", "station_id": sid, "year": year},
                   f"waterlevel_year/{sid}/{year}")
    if payload is None:
        return True
    graph = ((payload.get("data") or {}).get("graph_data")) or []
    return any(g.get("data") for g in graph if isinstance(g, dict))


def run_waterlevel(ctx: Ctx, station_ids: list[int], deadline: Deadline) -> bool:
    """Returns True if every station was processed before the deadline."""
    wcfg = ctx.cfg["waterlevel"]
    floor, stop_after = int(wcfg["floor_year"]), int(wcfg["stop_after_empty_years"])
    for i, sid in enumerate(station_ids, 1):
        if deadline.passed():
            return False
        st = ctx.wl_state.station(sid)
        years: dict = st["years"]  # "YYYY" -> {"n": values, "complete": bool}
        empty_streak, fetched = 0, 0
        for year in range(ctx.today.year, floor - 1, -1):
            known = years.get(str(year))
            if known and known.get("complete"):
                n = known["n"]
            elif year < ctx.today.year and not _year_has_waterlevel(ctx, sid, year):
                n = 0
                years[str(year)] = {"n": 0, "complete": True}
            else:
                start, end = year_windows(year, ctx.today, st.get("last_ts"))
                payload = _get(
                    ctx,
                    "/public/waterlevel_graph",
                    {"station_type": "tele_waterlevel", "station_id": sid,
                     "start_date": start.isoformat(), "end_date": end.isoformat()},
                    f"waterlevel/{sid}/{start.isoformat()}_{end.isoformat()}",
                )
                if payload is None:
                    break  # retry this station next run
                df = tidy.waterlevel_frame(sid, payload)
                tidy.merge_into_partitions(df, ctx.paths.tidy)
                got = tidy.count_values(df, "water_level_msl")
                meta = (payload.get("data") or {})
                if year == ctx.today.year:
                    st["meta"] = {k: meta.get(k) for k in ("min_bank", "warning_level", "critical_level", "ground_level", "qmax")}
                prev_n = (known or {}).get("n", 0) if year == ctx.today.year else 0
                n = prev_n + got
                years[str(year)] = {"n": n, "complete": year < ctx.today.year}
                if got:
                    last = df.loc[df["variable"] == "water_level_msl", "ts"].max().isoformat()  # UTC
                    if not st.get("last_ts") or last > st["last_ts"]:
                        st["last_ts"] = last
                fetched += 1
            empty_streak = empty_streak + 1 if n == 0 else 0
            if empty_streak >= stop_after:
                break
        ctx.wl_state.save()
        log.info("waterlevel %d/%d station %s: %d windows fetched, years with data: %s",
                 i, len(station_ids), sid, fetched,
                 sorted(int(y) for y, v in years.items() if v["n"]))
    return True


# ---------------------------------------------------------------- daily rain

def month_windows(year: int, months: list[int], since: date, today: date) -> list[tuple[date, date]]:
    out = []
    for m in months:
        start = date(year, m, 1)
        end = date(year, m, calendar.monthrange(year, m)[1])
        if end < since or start > today:
            continue
        out.append((max(start, since), min(end, today)))
    return out


def months_with_data(payload: dict) -> list[int]:
    months = []
    for rec in (payload or {}).get("data") or []:
        if rec.get("day_count"):
            months.append(int(str(rec["date_time"])[5:7]))
    return sorted(set(months))


def run_rain_daily(ctx: Ctx, station_ids: list[int], since: date, deadline: Deadline) -> bool:
    """Returns True if every station was processed back to `since` before the deadline."""
    for i, sid in enumerate(station_ids, 1):
        if deadline.passed():
            return False
        st = ctx.rain_state.station(sid)
        # "YYYY" -> {"months": [months with data], "fetched": [months done], "complete": bool,
        #            "from": earliest date the year is complete from}
        years: dict = st["years"]
        n_windows = 0
        for year in range(ctx.today.year, since.year - 1, -1):
            if deadline.passed():
                ctx.rain_state.save()
                return False
            ys = years.get(str(year)) or {}
            year_since = max(since, date(year, 1, 1))
            if ys.get("complete") and ys.get("from", "9999-12-31") <= year_since.isoformat():
                continue
            probe = _get(ctx, "/public/rain_yearly_graph", {"station_id": sid, "year": year},
                         f"rain_yearly/{sid}/{year}")
            if probe is None:
                break
            months = months_with_data(probe)
            fetched = set(ys.get("fetched", []))
            ok = True
            for start, end in month_windows(year, months, year_since, ctx.today):
                m = start.month
                recent = (ctx.today - end).days <= 35  # refresh the last month or so every run
                if m in fetched and not recent:
                    continue
                payload = _get(ctx, "/provinces/rain7d_graph",
                               {"station_id": sid, "start_date": start.isoformat(), "end_date": end.isoformat()},
                               f"rain_daily/{sid}/{start.isoformat()}_{end.isoformat()}")
                if payload is None:
                    ok = False
                    continue
                tidy.merge_into_partitions(tidy.rain_frame(sid, payload, "rain_daily"), ctx.paths.tidy)
                fetched.add(m)
                n_windows += 1
            years[str(year)] = {
                "months": months,
                "fetched": sorted(fetched),
                "complete": ok and year < ctx.today.year,
                "from": year_since.isoformat() if ok else ys.get("from", "9999-12-31"),
            }
        ctx.rain_state.save()
        log.info("rain_daily %d/%d station %s: %d month windows fetched", i, len(station_ids), sid, n_windows)
    return True


# ---------------------------------------------------------------- hourly rain

def run_rain_hourly(ctx: Ctx, station_ids: list[int], deadline: Deadline) -> bool:
    stamp = datetime.now().strftime("%Y%m%dT%H%M")
    for sid in station_ids:
        if deadline.passed():
            return False
        payload = _get(ctx, "/public/rain_24h_graph", {"station_id": sid}, f"rain_1h/{sid}/{stamp}")
        if payload is not None:
            tidy.merge_into_partitions(tidy.rain_frame(sid, payload, "rain_1h"), ctx.paths.tidy)
    log.info("rain_1h: %d stations polled", len(station_ids))
    return True


def station_ids(stations: pd.DataFrame, column: str) -> list[int]:
    return [int(s) for s in stations.loc[stations[column].astype(bool), "station_id"].tolist()]
