"""The run log: one JSON file per run under <output_dir>/runs/. Pure Python.

It records every parameter, the scenes used (event and reference), the threshold chosen for every
scene, polarisation and tile (Otsu or the fixed drop, with the reason), and the Earth Engine task ids.
"""

from __future__ import annotations

import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
# Task states after which an export may be started again without --force.
FAILED_STATES = ("FAILED", "CANCELLED", "CANCEL_REQUESTED")


def run_id(event_id: str, now: datetime) -> str:
    return f"{now.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}_{event_id}"


class RunLog:
    def __init__(self, path: Path, data: dict):
        self.path = path
        self.data = data

    @classmethod
    def start(cls, runs_dir: Path, *, event, cfg: dict, params_hash: str, aoi_sha256: str, project: str,
              dry_run: bool, command: str, now: datetime, ee_version: str | None = None) -> "RunLog":
        rid = run_id(event.id, now)
        data = {
            "schema": SCHEMA,
            "run_id": rid,
            "command": command,
            "dry_run": dry_run,
            "started_utc": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "finished_utc": None,
            "event": {"id": event.id, "kind": event.kind, "start": event.start.isoformat(),
                      "end": event.end.isoformat(), "dates": "Asia/Bangkok, inclusive",
                      "per_scene_exports": event.per_scene},
            "params_hash": params_hash,
            "config": cfg,
            "aoi_sha256": aoi_sha256,
            "ee_project": project,
            "software": {"earthengine_api": ee_version, "python": platform.python_version()},
            "grid": None,
            "tiles": None,
            "reference": {"windows": [], "orbits": {}},
            "passes": [],
            "exports": [],
            "warnings": [],
        }
        return cls(runs_dir / f"{rid}.json", data)

    @classmethod
    def load(cls, path: Path) -> "RunLog":
        return cls(path, json.loads(path.read_text(encoding="utf-8")))

    def warn(self, message: str) -> None:
        self.data["warnings"].append(message)

    def finish(self, now: datetime) -> None:
        self.data["finished_utc"] = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.save()

    def save(self) -> None:
        """Write through a temporary file, so an interrupted run never leaves half a log."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        os.replace(tmp, self.path)

    def task_ids(self) -> list[str]:
        return [e["task_id"] for e in self.data["exports"] if e.get("task_id")]


def all_runs(runs_dir: Path) -> list[RunLog]:
    """Every run log, oldest first (run ids start with the UTC time)."""
    return [RunLog.load(p) for p in sorted(runs_dir.glob("*.json"))] if runs_dir.is_dir() else []


def latest_run(runs_dir: Path, with_tasks: bool = False) -> RunLog | None:
    runs = [r for r in all_runs(runs_dir) if r.task_ids() or not with_tasks]
    return runs[-1] if runs else None


def already_exported(runs_dir: Path) -> dict[str, dict]:
    """Export name -> its latest submitted task (run id, task id, state), failed ones left out."""
    out: dict[str, dict] = {}
    for run in all_runs(runs_dir):
        for e in run.data["exports"]:
            if not e.get("task_id"):
                continue
            if e.get("state") in FAILED_STATES:
                out.pop(e["name"], None)
            else:
                out[e["name"]] = {"run_id": run.data["run_id"], "task_id": e["task_id"], "state": e.get("state")}
    return out
