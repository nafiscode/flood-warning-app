"""Offline tests for the ThaiWater archive (fixtures only, no network)."""

import json
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from ingest_thaiwater import coverage, download, stations, tidy
from ingest_thaiwater.settings import load_config
from ingest_thaiwater.state import State

FIX = Path(__file__).parent / "fixtures"


def fixture(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


@pytest.fixture
def cfg():
    return load_config()


def test_contact_email_comes_from_env_files_not_code(tmp_path, monkeypatch):
    from ingest_thaiwater.settings import env_value

    monkeypatch.delenv("CONTACT_EMAIL", raising=False)
    (tmp_path / ".env.example").write_text("CONTACT_EMAIL=example@test\n", encoding="utf-8")
    assert env_value("CONTACT_EMAIL", tmp_path) == "example@test"
    (tmp_path / ".env.local").write_text("CONTACT_EMAIL=\"local@test\"\n", encoding="utf-8")
    assert env_value("CONTACT_EMAIL", tmp_path) == "local@test"
    monkeypatch.setenv("CONTACT_EMAIL", "env@test")
    assert env_value("CONTACT_EMAIL", tmp_path) == "env@test"


def test_user_agent_includes_repo_contact(cfg):
    assert cfg["user_agent"].startswith("Jaga/0.1 (non-profit flood warning")
    assert "{contact}" not in cfg["user_agent"]


def test_waterlevel_frame_converts_bangkok_to_utc_and_drops_nulls():
    df = tidy.waterlevel_frame(901, fixture("waterlevel_graph.json"))
    wl = df[df["variable"] == "water_level_msl"]
    assert len(wl) == 3  # the null reading is dropped
    assert wl["ts"].iloc[0] == pd.Timestamp("2025-11-19 17:00", tz="UTC")  # 00:00 Bangkok
    assert wl["value"].iloc[-1] == pytest.approx(12.31)  # numeric strings are parsed
    q = df[df["variable"] == "discharge"]
    assert len(q) == 1 and q["unit"].iloc[0] == "m3/s"


def test_rain_frame_keeps_zero_and_drops_null():
    df = tidy.rain_frame(886, fixture("rain_daily.json"), "rain_daily")
    assert df["value"].tolist() == [0.0, 84.5]
    assert set(df["unit"]) == {"mm"}


def test_merge_is_idempotent_and_partitioned_by_month(tmp_path):
    df = tidy.waterlevel_frame(901, fixture("waterlevel_graph.json"))
    assert tidy.merge_into_partitions(df, tmp_path) == 2  # water level + discharge partitions
    assert tidy.merge_into_partitions(df, tmp_path) == 0  # unchanged: nothing rewritten
    part = tmp_path / "water_level_msl" / "901" / "2025-11.parquet"
    stored = pd.read_parquet(part)
    assert len(stored) == 3 and stored["ts"].is_monotonic_increasing


def test_merge_updates_changed_values(tmp_path):
    df = tidy.rain_frame(886, fixture("rain_daily.json"), "rain_daily")
    tidy.merge_into_partitions(df, tmp_path)
    changed = df.copy()
    changed.loc[changed["value"] == 84.5, "value"] = 90.0
    assert tidy.merge_into_partitions(changed, tmp_path) == 1
    stored = pd.read_parquet(tmp_path / "rain_daily" / "886" / "2025-11.parquet")
    assert stored["value"].tolist() == [0.0, 90.0]


def test_station_build_filters_province_and_box(cfg):
    df = stations.build(fixture("station_lists.json"), cfg)
    ids = set(df["station_id"])
    assert ids == {740742, 726684, 6855855, 886, 1123993}  # 999 outside box, 1000 outside provinces
    row = df.set_index("station_id").loc[740742]
    assert row["wl_reporting"] and row["wl_candidate"] and row["old_code"] == "FOP041"
    assert row["min_bank_m"] == 6.76 and "waterlevel_load" in row["listed_in"]
    both = df.set_index("station_id").loc[6855855]
    assert both["wl_candidate"] and both["rain_candidate"] and not both["wl_reporting"]


def test_station_merge_keeps_stations_that_disappear(cfg):
    first = stations.merge_with_previous(stations.build(fixture("station_lists.json"), cfg), None)
    lists = fixture("station_lists.json")
    lists["waterlevel_load"] = []
    second = stations.merge_with_previous(stations.build(lists, cfg), first)
    assert set(second["station_id"]) == set(first["station_id"])
    assert not second.set_index("station_id").loc[740742, "wl_reporting"]


def test_months_with_data_and_windows():
    assert download.months_with_data(fixture("rain_yearly.json")) == [1, 11]
    w = download.month_windows(2025, [1, 11], since=date(2023, 10, 1), today=date(2026, 9, 28))
    assert w == [(date(2025, 1, 1), date(2025, 1, 31)), (date(2025, 11, 1), date(2025, 11, 30))]
    # clamp to since and today
    w = download.month_windows(2026, [9], since=date(2026, 9, 10), today=date(2026, 9, 28))
    assert w == [(date(2026, 9, 10), date(2026, 9, 28))]


def test_year_windows_incremental_for_current_year():
    today = date(2026, 9, 28)
    assert download.year_windows(2024, today, None) == (date(2024, 1, 1), date(2024, 12, 31))
    assert download.year_windows(2026, today, "2026-09-20T10:00:00+00:00") == (date(2026, 9, 19), today)


def test_gap_and_season_stats():
    ts = pd.Series(pd.date_range("2025-10-31 17:00", "2025-12-31 16:00", freq="1h", tz="UTC"))
    ts = ts[(ts < "2025-11-10") | (ts >= "2025-11-12")]  # a 2-day hole
    s = coverage.series_stats(ts)
    assert s["step_min"] == 60 and s["gaps"] == 1 and s["longest_gap_days"] == pytest.approx(2.0, abs=0.05)
    assert 95 <= s["Nov–Dec 2025"] < 100 and s["Nov–Dec 2024"] == 0


def test_client_retries_result_no_server_errors_and_skips_other_refusals(cfg, monkeypatch):
    import httpx

    from ingest_thaiwater import client as client_mod

    monkeypatch.setattr(client_mod.time, "sleep", lambda s: None)
    replies = iter([
        {"result": "NO", "data": "500:  Internal Database Error ...pq: out of shared memory"},
        {"result": "OK", "data": []},
        {"result": "NO", "data": {"RespCode": 422, "RespMessage": "limit date range"}},
    ])
    c = client_mod.ThaiWaterClient(cfg)
    c._http = httpx.Client(base_url="https://example.test",
                           transport=httpx.MockTransport(lambda req: httpx.Response(200, json=next(replies))))
    assert c.get("/x") == {"result": "OK", "data": []}  # retried after the database error
    with pytest.raises(client_mod.ApiError):
        c.get("/y")  # 422 refusal: not retried
    assert c.requests == 3


class FakeClient:
    """Water level exists only in 2025 and 2026. The yearly endpoint is the cheap probe."""

    def __init__(self):
        self.calls = []
        self.last_raw = b"{}"

    def get(self, path, params):
        if path.endswith("waterlevel_graph_year"):
            year = int(params["year"])
            self.calls.append(("probe", year))
            data = [{"datetime": f"{year}-06-01 06:00", "waterlevel_msl": 1.0}] if year in (2025, 2026) else []
            return {"data": {"graph_data": [{"year": str(year), "data": data}]}}
        year = int(params["start_date"][:4])
        self.calls.append(("full", year))
        if year in (2025, 2026):
            return {"data": {"graph_data": [
                {"datetime": f"{year}-{params['start_date'][5:7]}-{params['start_date'][8:10]} 00:00", "value": 1.0}]}}
        return {"data": {"graph_data": [{"datetime": f"{year}-01-01 00:00", "value": None}]}}


def test_waterlevel_probes_years_downloads_only_years_with_data_and_resumes(tmp_path, cfg):
    from ingest_thaiwater.settings import Paths

    paths = Paths(tmp_path)
    client = FakeClient()
    ctx = download.Ctx(client, paths, cfg, date(2026, 9, 28),
                       State(paths.state("waterlevel")), State(paths.state("rain_daily")))
    assert download.run_waterlevel(ctx, [901], download.Deadline(None))
    assert client.calls == [
        ("full", 2026),                      # current year: always fetched
        ("probe", 2025), ("full", 2025),     # probe says data -> full year
        ("probe", 2024), ("probe", 2023), ("probe", 2022),  # 3 empty probes -> stop
    ]
    # Second run: past years are complete; only the current year is re-requested (incrementally).
    client.calls.clear()
    download.run_waterlevel(ctx, [901], download.Deadline(None))
    assert client.calls == [("full", 2026)]
    saved = State(paths.state("waterlevel")).station(901)["years"]
    assert saved["2025"] == {"n": 1, "complete": True} and saved["2024"] == {"n": 0, "complete": True}
    assert (paths.raw / "waterlevel" / "901").is_dir()


def test_long_silent_station_gets_only_a_cheap_probe(tmp_path, cfg):
    from ingest_thaiwater.settings import Paths

    paths = Paths(tmp_path)
    client = FakeClient()
    ctx = download.Ctx(client, paths, cfg, date(2030, 9, 28),  # FakeClient has data only in 2025-2026
                       State(paths.state("waterlevel")), State(paths.state("rain_daily")))
    download.run_waterlevel(ctx, [7], download.Deadline(None))  # first run: full current year + probes
    client.calls.clear()
    download.run_waterlevel(ctx, [7], download.Deadline(None))
    assert client.calls == [("probe", 2030)]  # 2027-2029 known empty: no multi-MB request
