"""Paths and configuration. All paths are relative to the pipeline folder, never absolute."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

PIPELINE_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).with_name("config.yaml")

# Asia/Bangkok has no DST, so a fixed offset avoids needing tzdata on Windows.
BANGKOK = timezone(timedelta(hours=7), name="Asia/Bangkok")


def data_dir() -> Path:
    """pipeline/data by default (a clone of nafiscode/jaga-data). JAGA_DATA_DIR overrides it,
    resolved relative to the pipeline folder when it is not absolute."""
    override = os.environ.get("JAGA_DATA_DIR")
    if override:
        p = Path(override)
        return p if p.is_absolute() else (PIPELINE_DIR / p).resolve()
    return PIPELINE_DIR / "data"


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def tidy(self) -> Path:
        return self.root / "tidy"

    @property
    def stations_csv(self) -> Path:
        return self.root / "stations.csv"

    @property
    def state_dir(self) -> Path:
        return self.root / "state"

    def state(self, job: str) -> Path:
        return self.state_dir / f"{job}.json"

    @property
    def reports(self) -> Path:
        return self.root / "reports"

    @property
    def snapshots(self) -> Path:
        return self.root / "snapshots"

    @property
    def logs(self) -> Path:
        return self.root / "logs"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def today_bangkok() -> date:
    return datetime.now(BANGKOK).date()
