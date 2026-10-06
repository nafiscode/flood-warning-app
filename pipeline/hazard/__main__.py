"""Command line: `uv run python -m hazard <command>` from the pipeline folder.

Commands
  sources-export [--dry-run]   start the two Earth Engine exports to Drive: FABDEM and JRC water
                               occurrence for the working box (a few EECU-minutes; needs EE_PROJECT)
  sources-download [--dry-run] fetch them into <output_dir>/sources/

Settings: hazard/config.yaml. Outputs are local (ignored by git); products go to R2 with r2sync.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR
from sar_floods import ee_ops, settings as sar_settings

from . import sources

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    w, s, e, n = cfg["bbox_deg"]
    if not (all(isinstance(v, int) for v in (w, s, e, n)) and w < e and s < n):
        raise sar_settings.ConfigError("bbox_deg must be whole degrees [west, south, east, north].")
    return cfg


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise sar_settings.ConfigError("output_dir must be relative to pipeline/ and inside it.")
    return root


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="hazard", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    for name in ("sources-export", "sources-download"):
        sub.add_parser(name).add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        cfg = load_config()
        project = sar_settings.ee_project()
        if args.command == "sources-export":
            ee_ops.init(project)
            for task in sources.export_tasks(cfg):
                if args.dry_run:
                    print(f"would start {task.config['description']}")
                else:
                    task.start()
                    print(f"started {task.config['description']} (task {task.id})")
        elif args.command == "sources-download":
            for line in sources.download(cfg, project, output_dir(cfg) / "sources", args.dry_run):
                print(line)
    except sar_settings.ConfigError as e:
        print(f"hazard: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
