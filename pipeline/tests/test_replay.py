"""Unit tests for the replay's pure helpers (no database, no network)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from replay import core

UTC = timezone.utc


def test_parse_target_reads_ref_and_host():
    t = core.parse_target("postgresql://postgres.abcdefghijklmnop:pw@aws-0-ap.pooler.supabase.com:6543/postgres")
    assert t.ref == "abcdefghijklmnop"
    assert t.host == "aws-0-ap.pooler.supabase.com"
    assert "pw" not in t.label()


def test_parse_target_without_ref():
    t = core.parse_target("postgresql://postgres:pw@db.example.com:5432/postgres")
    assert t.ref is None
    assert t.host == "db.example.com"


def test_same_database():
    a = "postgresql://postgres.devref:x@host.a/postgres"
    b = "postgresql://postgres.devref:y@host.a/postgres"  # same project, different password
    c = "postgresql://postgres.liveref:z@host.a/postgres"
    assert core.same_database(a, b) is True
    assert core.same_database(a, c) is False
    assert core.same_database(a, None) is False


def test_months_span():
    lo = datetime(2025, 11, 15, tzinfo=UTC)
    hi = datetime(2026, 1, 3, tzinfo=UTC)
    assert core._months(lo, hi) == ["2025-11", "2025-12", "2026-01"]


def test_wall_due_compresses_by_speed():
    sim_start = datetime(2025, 11, 1, 0, 0, tzinfo=UTC)
    run_start = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
    # A reading 48 archive-minutes in -> 1 real minute in at 48x.
    due = core.wall_due(sim_start + timedelta(minutes=48), sim_start, run_start, 48.0)
    assert due == run_start + timedelta(minutes=1)


def test_wall_duration():
    sim_start = datetime(2025, 11, 1, tzinfo=UTC)
    sim_end = sim_start + timedelta(days=1)
    assert core.wall_duration(sim_start, sim_end, 48.0) == timedelta(minutes=30)


def test_default_window_is_whole_month():
    lo, hi = core.default_window(2025, 11)
    assert lo == datetime(2025, 11, 1, tzinfo=UTC)
    assert hi.month == 11 and hi.day == 30


def _write_series(root, variable, sid, rows):
    d = root / "tidy" / variable / sid
    d.mkdir(parents=True)
    df = pd.DataFrame(rows, columns=["ts", "value"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    # Group by month like the real archive.
    for month, part in df.groupby(df["ts"].dt.strftime("%Y-%m")):
        part.to_parquet(d / f"{month}.parquet", index=False)


def test_build_events_reads_window_and_sorts(tmp_path):
    _write_series(tmp_path, "water_level_msl", "100", [
        ("2025-11-01T00:00:00Z", 2.5),
        ("2025-11-01T00:30:00Z", 2.7),
        ("2025-12-01T00:00:00Z", 9.9),  # out of window
    ])
    _write_series(tmp_path, "dam_level", "50", [
        ("2025-11-01T00:15:00Z", 97.4),
    ])
    lo = datetime(2025, 11, 1, tzinfo=UTC)
    hi = datetime(2025, 11, 30, 23, 59, 59, tzinfo=UTC)
    events = core.build_events(tmp_path, lo, hi, want_gauges=True, want_dam=True)
    assert [e.field for e in events] == ["water_level_msl", "level_m", "water_level_msl"]
    assert [e.kind for e in events] == ["gauge", "dam", "gauge"]  # sorted by sim_ts
    assert all(lo <= e.sim_ts <= hi for e in events)


def test_build_events_only_gauges(tmp_path):
    _write_series(tmp_path, "water_level_msl", "100", [("2025-11-01T00:00:00Z", 2.5)])
    _write_series(tmp_path, "dam_level", "50", [("2025-11-01T00:00:00Z", 97.4)])
    lo, hi = core.default_window(2025, 11)
    events = core.build_events(tmp_path, lo, hi, want_gauges=True, want_dam=False)
    assert len(events) == 1 and events[0].kind == "gauge"


def test_read_series_drops_nulls(tmp_path):
    _write_series(tmp_path, "discharge", "100", [
        ("2025-11-01T00:00:00Z", 1.0),
        ("2025-11-01T00:30:00Z", None),
    ])
    lo, hi = core.default_window(2025, 11)
    df = core.read_series(tmp_path, "discharge", "100", lo, hi)
    assert len(df) == 1 and df.iloc[0]["value"] == 1.0
