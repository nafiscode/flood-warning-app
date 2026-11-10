"""Load a finished `highway_paths run` into the database, for A19's page in the authority console.

`sections.geojson` and the per-province CSVs are the run's output; `highway_sections` and
`highway_stretches` (migration ..a19_highway_paths) are what the page reads. This module is the
one step between them, and it has exactly two jobs:

  * replace the rows of the previous run with this run's, in ONE transaction, so that nobody ever
    opens the page onto half a load;
  * leave the offices' own notes alone. `highway_stretch_notes` is keyed on the stretch id as text
    with no foreign key, precisely so that it survives this (A19 item 5). Nothing here touches it.

The geometry goes in as WKT; 4,366 sections of seven or eight points each is small enough that
plain `executemany` in one transaction is both fast and easy to read.

Advice for the highway and irrigation offices, checked on the ground before it means anything.
Nothing loaded here feeds an alert level, a suggestion, a notification or the public map.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("highway_paths.load")

# One row per section. The order is the order of the insert below.
SECTION_COLUMNS = (
    "id", "run_id", "run_date", "geom", "mid", "province_code", "district_code", "tambon_code",
    "road_kind", "road_ref", "road_name_th", "road_name_en", "osm_way", "length_m", "bridge_m",
    "twin_section", "chain", "section_index", "class", "score", "score_parts", "stretch",
    "upstream_side", "upstream_by", "upstream_d8", "upstream_dem", "d8_dem_agree",
    "dem_left_m", "dem_right_m", "asymmetry", "seasons_seen", "seasons_up_wetter",
    "seasons_down_wetter", "persistence", "pass_flood_share_up", "pass_flood_share_down",
    "passes_seen", "passes_flooded_up", "passes_flooded_down", "cells_left", "cells_right",
    "crossings", "crossing_km2", "crossing_from", "crossing_point", "crossing_opening",
    "crossing_opening_m", "bridges", "culverts", "waterway_crossings",
)

STRETCH_COLUMNS = (
    "id", "run_id", "run_date", "province_code", "class", "score", "km", "best_section",
    "sections", "twin_sections", "listed", "rank",
)


def read_sections(out: Path) -> list[dict[str, Any]]:
    """The run's sections, properties only, with the geometry kept beside them as WKT."""
    path = out / "sections.geojson"
    if not path.exists():
        raise SystemExit(f"No {path.name} in {out}: run `highway_paths run` first.")
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    rows: list[dict[str, Any]] = []
    for feature in fc["features"]:
        row = dict(feature["properties"])
        geom = feature["geometry"]
        if geom["type"] != "LineString":
            raise SystemExit(f"{row.get('id')}: expected a LineString, got {geom['type']}.")
        row["_wkt"] = "LINESTRING(" + ", ".join(f"{x} {y}" for x, y in geom["coordinates"]) + ")"
        rows.append(row)
    return rows


def run_stamp(out: Path, run_date: str | None) -> tuple[str, date]:
    """Which run these rows are: the radar parameter hash from summary.json, and the day the run
    was made. A reader of the page has to know how old the radar record behind a list is, so the
    date is not optional - it falls back to the day sections.geojson was written."""
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    run_id = str(summary.get("radar_run") or "unknown")
    if run_date:
        return run_id, date.fromisoformat(run_date)
    written = (out / "sections.geojson").stat().st_mtime
    return run_id, datetime.fromtimestamp(written, tz=timezone.utc).date()


def _point(lon: Any, lat: Any) -> str | None:
    return None if lon is None or lat is None else f"POINT({lon} {lat})"


def section_values(row: dict[str, Any], run_id: str, run_date: date) -> tuple:
    tambon = str(row["tambon_code"])
    return (
        row["id"], run_id, run_date, row["_wkt"], _point(row["mid_lon"], row["mid_lat"]),
        str(row["province_code"]), tambon[:4], tambon,
        row["highway"], row.get("ref"), row.get("name"), row.get("name_en"),
        row.get("osm_way"), int(row["length_m"]), int(row.get("bridge_m") or 0),
        row.get("twin_section"), int(row["chain"]), int(row["index"]),
        row["class"], row["score"], json.dumps(row.get("score_parts") or {}), row.get("stretch"),
        row.get("upstream_side"), row.get("upstream_by"), row.get("upstream_d8"),
        row.get("upstream_dem"), row.get("d8_dem_agree"),
        row.get("dem_left_m"), row.get("dem_right_m"), row.get("asymmetry"),
        int(row.get("seasons_seen") or 0), int(row.get("seasons_up_wetter") or 0),
        int(row.get("seasons_down_wetter") or 0), row.get("persistence"),
        row.get("pass_flood_share_up"), row.get("pass_flood_share_down"),
        int(row.get("passes_seen") or 0), int(row.get("passes_flooded_up") or 0),
        int(row.get("passes_flooded_down") or 0), row.get("cells_left"), row.get("cells_right"),
        int(row.get("crossings") or 0), row.get("crossing_km2"), row.get("crossing_from"),
        _point(row.get("crossing_lon"), row.get("crossing_lat")), row.get("crossing_opening"),
        None if row.get("crossing_opening_m") is None else int(row["crossing_opening_m"]),
        int(row.get("bridges") or 0), int(row.get("culverts") or 0),
        int(row.get("waterway_crossings") or 0),
    )


def stretch_values(found: list[dict], ranked: list[dict], run_id: str, run_date: date) -> list[tuple]:
    """Every flagged stretch, with the pipeline's own order on the ones that are listed.

    `ranked_stretches()` leaves the other carriageway of a stretch already in the list out of it
    (METHODS rule 10). Both carriageways keep a row - an office that looks up a section by number
    must find its stretch - and `listed` with `rank` is how the page shows one of the two, in the
    pipeline's order, per province."""
    rank_of: dict[str, int] = {}
    per_province: dict[str, int] = {}
    for stretch in ranked:
        province = str(stretch["province_code"])
        per_province[province] = per_province.get(province, 0) + 1
        rank_of[stretch["id"]] = per_province[province]
    out = []
    for stretch in found:
        out.append((
            stretch["id"], run_id, run_date, str(stretch["province_code"]), stretch["class"],
            stretch["score"], stretch["km"], stretch["best"]["id"], list(stretch["sections"]),
            sorted(stretch["twins"]), stretch["id"] in rank_of, rank_of.get(stretch["id"]),
        ))
    return out


def _insert(table: str, columns: tuple[str, ...], geometry: frozenset[str] = frozenset()) -> str:
    """One INSERT with a placeholder per column, the geometry columns wrapped in the PostGIS
    reader so that the value sent is plain WKT. Column names come from the constants above and
    never from the data."""
    placeholders = ", ".join(
        "extensions.st_geomfromtext(%s, 4326)" if c in geometry else "%s" for c in columns
    )
    names = ", ".join(f'"{c}"' for c in columns)
    return f"insert into public.{table} ({names}) values ({placeholders})"


SECTION_GEOMETRY = frozenset({"geom", "mid", "crossing_point"})


def write(conn, sections: list[tuple], stretches: list[tuple]) -> dict[str, int]:
    """Replace the previous run in one transaction. `conn` is a psycopg connection with
    autocommit off; the caller commits, so a failure anywhere leaves the old rows in place."""
    with conn.cursor() as cur:
        # Children first: a section carries its stretch id, and a stretch names its sections.
        cur.execute("delete from public.highway_stretches")
        removed_stretches = cur.rowcount
        cur.execute("delete from public.highway_sections")
        removed_sections = cur.rowcount
        cur.executemany(_insert("highway_sections", SECTION_COLUMNS, SECTION_GEOMETRY), sections)
        cur.executemany(_insert("highway_stretches", STRETCH_COLUMNS), stretches)
        cur.execute("select count(*) from public.highway_stretch_notes")
        notes = cur.fetchone()[0]
    return {
        "sections": len(sections),
        "stretches": len(stretches),
        "removed_sections": removed_sections,
        "removed_stretches": removed_stretches,
        "notes_kept": notes,
    }
