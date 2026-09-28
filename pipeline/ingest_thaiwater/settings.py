"""Paths and configuration. All paths are relative to the repo, never absolute."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PIPELINE_DIR.parent
CONFIG_PATH = Path(__file__).with_name("config.yaml")

# Asia/Bangkok has no DST, so a fixed offset avoids needing tzdata on Windows.
BANGKOK = timezone(timedelta(hours=7), name="Asia/Bangkok")


def data_dir() -> Path:
    """pipeline/data by default (a clone of nafiscode/jaga-data). JAGA_DATA_DIR (environment
    or .env.local) overrides it, resolved relative to the pipeline folder when not absolute."""
    override = env_value("JAGA_DATA_DIR")
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


def env_value(key: str, repo_dir: Path = REPO_DIR) -> str | None:
    """A setting from the environment, else .env.local, else .env.example (repo root)."""
    if os.environ.get(key):
        return os.environ[key]
    for name in (".env.local", ".env.example"):
        path = repo_dir / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.strip().partition("=")
            if sep and k.strip() == key and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    contact = env_value("CONTACT_EMAIL")
    ua = cfg["user_agent"]
    cfg["user_agent"] = ua.format(contact=contact) if contact else ua.replace("; {contact}", "")
    return cfg


def today_bangkok() -> date:
    return datetime.now(BANGKOK).date()
