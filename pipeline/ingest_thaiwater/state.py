"""Resume state, committed to jaga-data so scheduled runs on fresh CI machines continue where
the last run stopped. One file per job, so jobs can run in parallel without overwriting each
other: state/waterlevel.json and state/rain_daily.json."""

from __future__ import annotations

import json
from pathlib import Path


class State:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict = {"stations": {}}
        if path.exists():
            with open(path, encoding="utf-8") as f:
                self.data.update(json.load(f))

    def station(self, station_id: int) -> dict:
        return self.data["stations"].setdefault(str(station_id), {"years": {}})

    @property
    def backfill(self) -> dict:
        return self.data.setdefault("backfill", {})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=1, sort_keys=True)
            f.write("\n")
        tmp.replace(self.path)
