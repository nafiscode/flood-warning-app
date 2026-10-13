"""GISTDA's repeated-flood polygons (flood-freq), one province at a time, a page per file.

Pages are kept as <output_dir>/flood_freq/<province>/<offset, 7 digits>.json.gz, each a list of
slimmed GeoJSON features, with done.json once a province is complete. A page on disk is not
asked for again, so an interrupted run carries on where it stopped.
"""

from __future__ import annotations

import gzip
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("gistda")
KEPT = ("tb_idn", "freq", "area_rai")


def slim(feature: dict) -> dict:
    """The geometry and the few properties the comparison uses. Everything else is dropped, and
    with it anything of the answer that could repeat the caller's key."""
    props = feature.get("properties") or {}
    return {"type": "Feature", "id": feature.get("id"), "geometry": feature.get("geometry"),
            "properties": {k: v for k, v in props.items() if k in KEPT or k.startswith("y_")}}


def page_path(folder: Path, offset: int) -> Path:
    return folder / f"{offset:07d}.json.gz"


def read_page(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def pages(root: Path, province: str) -> list[Path]:
    """The pages of a finished province, in order. Refuses an unfinished download."""
    folder = root / "flood_freq" / province
    if not (folder / "done.json").exists():
        raise SystemExit(f"GISTDA flood-freq for province {province} is not complete: run `gistda fetch`.")
    return sorted(folder.glob("*.json.gz"))


def get_page(client, url: str, province: str, limit: int, offset: int, tries: int = 6) -> tuple[int, list[dict]]:
    """(number matched, features) of one page. Errors are logged by status only: the address and
    the body are never printed."""
    for attempt in range(1, tries + 1):
        try:
            r = client.get(url, params={"pv_idn": province, "limit": limit, "offset": offset})
            if r.status_code != 200:
                raise RuntimeError(f"http {r.status_code}")
            body = r.json()
            return int(body["numberMatched"]), body["features"]
        except Exception as e:  # noqa: BLE001 - any failure is retried the same way
            if attempt == tries:
                raise SystemExit(f"GISTDA flood-freq, province {province}, offset {offset}: {type(e).__name__}") from None
            log.warning("province %s offset %s: %s, retry %s", province, offset, type(e).__name__, attempt)
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def fetch_province(client, url: str, root: Path, province: str, limit: int, pause_s: float) -> int:
    folder = root / "flood_freq" / province
    done = folder / "done.json"
    if done.exists():
        return json.loads(done.read_text(encoding="utf-8"))["matched"]
    folder.mkdir(parents=True, exist_ok=True)
    matched, offset = None, 0
    while matched is None or offset < matched:
        path = page_path(folder, offset)
        if path.exists() and matched is not None:
            offset += limit
            continue
        matched, features = get_page(client, url, province, limit if not path.exists() else 1, offset)
        if not path.exists():
            if not features:
                break
            with gzip.open(path, "wt", encoding="utf-8") as f:
                json.dump([slim(x) for x in features], f, ensure_ascii=False)
            log.info("province %s: %s of %s", province, min(offset + limit, matched), matched)
            time.sleep(pause_s)
        offset += limit
    done.write_text(json.dumps({"province": province, "matched": matched,
                                "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}), encoding="utf-8")
    return matched or 0
