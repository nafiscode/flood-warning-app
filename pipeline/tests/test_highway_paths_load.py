"""A19's loader: the run's sections and stretches into the shape the database takes. No network, no DB."""

import json
from datetime import date

import pytest

from highway_paths import load as loader
from highway_paths.__main__ import ranked_stretches, stretches


def feature(sid, *, index, chain=1, klass="look_first", score=0.9, twin=None, province="94",
            tambon="940202", crossing=True, **over):
    props = {
        "id": sid, "index": index, "chain": chain, "mid_lon": 101.1, "mid_lat": 6.7,
        "highway": "trunk", "ref": "42", "name": "ถนนเพชรเกษม", "name_en": "Phetkasem Road",
        "osm_way": 1500781121, "length_m": 500, "bridge_m": 0,
        "tambon_code": tambon, "province_code": province,
        "upstream_side": "left", "upstream_by": "d8", "upstream_d8": "left", "upstream_dem": "left",
        "d8_dem_agree": True, "dem_left_m": 22.91, "dem_right_m": 24.23,
        "cells_left": 254, "cells_right": 159,
        "asymmetry": 0.307, "seasons_seen": 9, "seasons_up_wetter": 8, "seasons_down_wetter": 0,
        "pass_flood_share_up": 0.0833, "pass_flood_share_down": 0.0044, "persistence": 0.0789,
        "passes_seen": 122, "passes_flooded_up": 38, "passes_flooded_down": 0,
        "crossings": 1 if crossing else 0,
        "crossing_km2": 54.74 if crossing else None,
        "crossing_from": "left" if crossing else None,
        "crossing_lon": 101.1228 if crossing else None,
        "crossing_lat": 6.7381 if crossing else None,
        "crossing_opening": "waterway" if crossing else None,
        "crossing_opening_m": 249 if crossing else None,
        "bridges": 0, "culverts": 0, "waterway_crossings": 1,
        "twin_section": twin, "score": score, "score_parts": {"asymmetry": 0.9},
        "class": klass, "reasons": "a sentence the page never shows", "stretch": None,
    }
    props.update(over)
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[101.1, 6.7], [101.105, 6.705]]},
        "properties": props,
    }


def write_run(tmp_path, features, radar="c97e0bf"):
    (tmp_path / "sections.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    (tmp_path / "summary.json").write_text(json.dumps({"radar_run": radar}), encoding="utf-8")
    return tmp_path


class FakeCursor:
    def __init__(self, store):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.store["executed"].append(sql.strip().split("\n")[0])
        self.rowcount = 3 if sql.strip().startswith("delete") else 1
        self._one = (7,)

    def executemany(self, sql, rows):
        self.store["executed"].append(sql.strip().split("\n")[0])
        self.store.setdefault("inserted", []).append((sql, list(rows)))
        self.rowcount = len(rows)

    def fetchone(self):
        return self._one


class FakeConn:
    def __init__(self):
        self.store = {"executed": []}

    def cursor(self):
        return FakeCursor(self.store)


def test_reads_a_run_and_keeps_the_line_as_wkt(tmp_path):
    out = write_run(tmp_path, [feature("S04339", index=1)])
    rows = loader.read_sections(out)
    assert len(rows) == 1
    assert rows[0]["_wkt"] == "LINESTRING(101.1 6.7, 101.105 6.705)"


def test_refuses_a_run_that_is_not_there(tmp_path):
    with pytest.raises(SystemExit):
        loader.read_sections(tmp_path)


def test_refuses_anything_but_a_line(tmp_path):
    bad = feature("S04339", index=1)
    bad["geometry"] = {"type": "Point", "coordinates": [101.1, 6.7]}
    out = write_run(tmp_path, [bad])
    with pytest.raises(SystemExit):
        loader.read_sections(out)


def test_run_stamp_takes_the_radar_hash_and_falls_back_to_the_file_date(tmp_path):
    out = write_run(tmp_path, [feature("S04339", index=1)])
    run_id, run_date = loader.run_stamp(out, None)
    assert run_id == "c97e0bf"
    assert isinstance(run_date, date)
    # An explicit date wins, for a reload of an older run.
    assert loader.run_stamp(out, "2026-10-15")[1] == date(2026, 10, 15)


def test_section_values_are_in_the_column_order():
    props = feature("S04339", index=3, chain=5)["properties"]
    props["_wkt"] = "LINESTRING(101.1 6.7, 101.105 6.705)"
    values = loader.section_values(props, "c97e0bf", date(2026, 10, 15))
    assert len(values) == len(loader.SECTION_COLUMNS)
    by_name = dict(zip(loader.SECTION_COLUMNS, values))
    assert by_name["id"] == "S04339"
    assert by_name["province_code"] == "94"
    # District and province are derived from the tambon code, never trusted separately.
    assert by_name["district_code"] == "9402"
    assert by_name["tambon_code"] == "940202"
    assert by_name["road_kind"] == "trunk"
    assert by_name["road_name_th"] == "ถนนเพชรเกษม"
    assert by_name["section_index"] == 3
    assert by_name["chain"] == 5
    assert by_name["mid"] == "POINT(101.1 6.7)"
    assert by_name["crossing_point"] == "POINT(101.1228 6.7381)"
    assert json.loads(by_name["score_parts"]) == {"asymmetry": 0.9}
    # The pipeline's English sentence is not one of the columns (A19 item 4).
    assert "reasons" not in loader.SECTION_COLUMNS


def test_a_section_with_no_crossing_carries_no_crossing_point():
    props = feature("S00063", index=1, crossing=False)["properties"]
    props["_wkt"] = "LINESTRING(101.1 6.7, 101.105 6.705)"
    by_name = dict(zip(loader.SECTION_COLUMNS, loader.section_values(props, "x", date(2026, 10, 15))))
    assert by_name["crossing_point"] is None
    assert by_name["crossing_km2"] is None
    assert by_name["crossings"] == 0


def test_a_section_the_radar_never_saw_keeps_a_null_score():
    props = feature("S00091", index=1, klass="not_seen", score=None, crossing=False)["properties"]
    props["_wkt"] = "LINESTRING(101.1 6.7, 101.105 6.705)"
    by_name = dict(zip(loader.SECTION_COLUMNS, loader.section_values(props, "x", date(2026, 10, 15))))
    assert by_name["class"] == "not_seen"
    assert by_name["score"] is None


def test_stretches_get_the_pipelines_own_rank_per_province():
    rows = [f["properties"] for f in [
        feature("S00001", index=1, chain=1, score=0.9),
        feature("S00002", index=2, chain=1, score=0.7),          # joins the one before
        feature("S00010", index=1, chain=2, score=0.5, klass="worth_a_look"),
        feature("S05000", index=1, chain=3, score=0.8, province="95", tambon="950101"),
    ]]
    found = stretches(rows)
    values = loader.stretch_values(found, ranked_stretches(found), "c97e0bf", date(2026, 10, 15))
    by_id = {v[0]: dict(zip(loader.STRETCH_COLUMNS, v)) for v in values}

    # Neighbours of one line are one stretch, told by its best section.
    assert by_id["R00001"]["sections"] == ["S00001", "S00002"]
    assert by_id["R00001"]["best_section"] == "S00001"
    # Ranked within the province: look-first before worth-a-look.
    assert by_id["R00001"]["rank"] == 1
    assert by_id["R00001"]["province_code"] == "94"
    assert by_id["R00010"]["rank"] == 2
    # Another province starts its own numbering.
    assert by_id["R05000"]["province_code"] == "95"
    assert by_id["R05000"]["rank"] == 1
    assert all(v["listed"] for v in by_id.values())


def test_the_other_carriageway_keeps_its_row_but_is_not_listed():
    rows = [f["properties"] for f in [
        feature("S00001", index=1, chain=1, score=0.9, twin="S00100"),
        feature("S00100", index=1, chain=2, score=0.6, twin="S00001"),
    ]]
    found = stretches(rows)
    values = loader.stretch_values(found, ranked_stretches(found), "c97e0bf", date(2026, 10, 15))
    by_id = {v[0]: dict(zip(loader.STRETCH_COLUMNS, v)) for v in values}
    # Both carriageways are in the table: an office looking a section up must find its stretch.
    assert set(by_id) == {"R00001", "R00100"}
    # Only one of the two is shown, and it is the better of them.
    assert by_id["R00001"]["listed"] is True
    assert by_id["R00100"]["listed"] is False
    assert by_id["R00100"]["rank"] is None
    assert by_id["R00001"]["twin_sections"] == ["S00100"]


def test_unflagged_sections_are_in_no_stretch():
    rows = [f["properties"] for f in [
        feature("S00001", index=1, klass="no_sign", score=0.1),
        feature("S00002", index=2, klass="not_seen", score=None),
    ]]
    found = stretches(rows)
    assert found == []
    assert all(r["stretch"] is None for r in rows)


def test_write_replaces_the_run_in_one_go_and_never_touches_the_notes():
    conn = FakeConn()
    done = loader.write(conn, [("a",)], [("b",)])
    executed = conn.store["executed"]
    # Stretches are cleared before sections, and the notes table is only ever counted.
    assert executed[0].startswith("delete from public.highway_stretches")
    assert executed[1].startswith("delete from public.highway_sections")
    assert not any("delete from public.highway_stretch_notes" in sql for sql in executed)
    assert not any("update public.highway_stretch_notes" in sql for sql in executed)
    assert done["sections"] == 1 and done["stretches"] == 1
    assert done["notes_kept"] == 7


def test_the_insert_wraps_only_the_geometry_columns():
    sql = loader._insert("highway_sections", loader.SECTION_COLUMNS, loader.SECTION_GEOMETRY)
    assert sql.count("extensions.st_geomfromtext(%s, 4326)") == 3
    assert sql.count("%s") == len(loader.SECTION_COLUMNS)
    assert '"crossing_point"' in sql
    # Column names come from the constant, so nothing from the data can reach the statement.
    assert loader._insert("highway_stretches", loader.STRETCH_COLUMNS).count("%s") == len(
        loader.STRETCH_COLUMNS)
