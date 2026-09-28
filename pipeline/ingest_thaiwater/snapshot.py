"""Zip the archive (raw + tidy + stations + reports + state) for off-machine backup."""

from __future__ import annotations

import zipfile
from datetime import datetime
from pathlib import Path

from .settings import BANGKOK, Paths


def make_snapshot(paths: Paths) -> Path:
    stamp = datetime.now(BANGKOK).strftime("%Y%m%d")
    out = paths.snapshots / f"thaiwater-{stamp}.zip"
    out.parent.mkdir(parents=True, exist_ok=True)
    items = [paths.raw, paths.tidy, paths.reports, paths.state_dir, paths.stations_csv]
    with zipfile.ZipFile(out, "w") as zf:
        for item in items:
            files = [item] if item.is_file() else sorted(p for p in item.rglob("*") if p.is_file()) if item.exists() else []
            for f in files:
                # .gz and .parquet are already compressed; store them as-is.
                method = zipfile.ZIP_STORED if f.suffix in (".gz", ".parquet") else zipfile.ZIP_DEFLATED
                zf.write(f, f.relative_to(paths.root).as_posix(), compress_type=method)
    return out
