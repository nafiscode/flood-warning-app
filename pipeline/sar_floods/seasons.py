"""Event and reference date windows. Pure Python.

Windows are written as Bangkok calendar dates (what residents and the event timeline use) and turned
into UTC instants for Earth Engine. That matters here: the descending pass is at about 06:20 Bangkok
time, which is 23:20 UTC on the day before.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from ingest_thaiwater.settings import BANGKOK


@dataclass(frozen=True)
class Event:
    id: str            # "season-2024" or "event-2024-nov-dec"
    kind: str          # "season" or "priority"
    start: date        # first day, Bangkok
    end: date          # last day, Bangkok (inclusive)
    season_year: int   # the season this event belongs to (the year the season starts in)

    @property
    def per_scene(self) -> bool:
        """Per-scene extents are exported for priority events only (decision 2026-10-05)."""
        return self.kind == "priority"


def _mmdd(text: str) -> tuple[int, int]:
    month, day = text.split("-")
    return int(month), int(day)


def season_year(day: date, cfg: dict) -> int:
    """The season a Bangkok date falls in or follows: 15 Jan 2025 -> 2024, 1 Oct 2025 -> 2025."""
    return day.year if (day.month, day.day) >= _mmdd(cfg["seasons"]["start"]) else day.year - 1


def season_event(year: int, cfg: dict) -> Event:
    (sm, sd), (em, ed) = _mmdd(cfg["seasons"]["start"]), _mmdd(cfg["seasons"]["end"])
    return Event(f"season-{year}", "season", date(year, sm, sd), date(year + 1, em, ed), year)


def events(cfg: dict) -> list[Event]:
    """Every configured event: all seasons first, then the priority events."""
    out = [season_event(y, cfg) for y in range(cfg["seasons"]["first"], cfg["seasons"]["last"] + 1)]
    for ev in cfg["priority_events"]:
        start = date.fromisoformat(str(ev["start"]))
        out.append(Event(f"event-{ev['id']}", "priority", start, date.fromisoformat(str(ev["end"])),
                         season_year(start, cfg)))
    return out


def find_event(event_id: str, cfg: dict) -> Event:
    """Look up an event by its id; the short forms "2024" and "2024-nov-dec" also work."""
    for ev in events(cfg):
        if event_id in (ev.id, ev.id.removeprefix("season-"), ev.id.removeprefix("event-")):
            return ev
    raise KeyError(event_id)


def reference_windows(ev: Event, cfg: dict) -> list[tuple[date, date]]:
    """Dry-season windows (Bangkok dates, inclusive) that feed this event's reference composite."""
    (sm, sd), (em, ed) = _mmdd(cfg["reference"]["start"]), _mmdd(cfg["reference"]["end"])
    years = sorted({ev.season_year + int(o) for o in cfg["reference"]["year_offsets"]})
    return [(date(y, sm, sd), date(y, em, ed)) for y in years]


def exception_windows(ev: Event, cfg: dict) -> dict[str, tuple[date, date]]:
    """Orbit -> the dry window of another year, for the orbits listed in reference_exceptions for this
    event's season."""
    (sm, sd), (em, ed) = _mmdd(cfg["reference"]["start"]), _mmdd(cfg["reference"]["end"])
    return {x["orbit"]: (date(x["reference_year"], sm, sd), date(x["reference_year"], em, ed))
            for x in cfg.get("reference_exceptions") or [] if x["season"] == ev.season_year}


def utc_millis(start: date, end: date) -> tuple[int, int]:
    """[start 00:00 Bangkok, the day after end 00:00 Bangkok) as UTC epoch milliseconds."""
    a = datetime.combine(start, time.min, BANGKOK)
    b = datetime.combine(end + timedelta(days=1), time.min, BANGKOK)
    return int(a.timestamp() * 1000), int(b.timestamp() * 1000)


def iso_utc(millis: int) -> str:
    return datetime.fromtimestamp(millis / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
