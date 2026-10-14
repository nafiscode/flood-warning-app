"""Command line: `uv run python -m safe_return <command>` from the pipeline folder.

Commands
  run          every gauge with levels in seed 47: flood events from the hourly archive, the hours
               from each peak to below the bank and to below Warning, and their spread per gauge.
               Writes <output_dir>/events.csv, summary.json and report.md, report.md beside this
               code, and supabase/seed/48_gauge_recession.sql.
  gauge CODE   one gauge's events, printed (for a look; writes nothing).

Everything is local: the ThaiWater archive in pipeline/data, no network. Settings:
safe_return/config.yaml; method: safe_return/METHODS.md; docs/science-plan.md Module 5.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, REPO_DIR, data_dir

from . import output, recession

CONFIG_PATH = Path(__file__).with_name("config.yaml")
log = logging.getLogger("safe_return")


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def output_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    if not root.is_relative_to(PIPELINE_DIR):
        raise ValueError("output_dir must be inside pipeline/.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def gauges(cfg: dict) -> list[dict]:
    """The gauges with a Warning and an Evacuate level as loaded, with code, zone and caveats."""
    levels = output.read_levels((PIPELINE_DIR / cfg["levels_sql"]).read_text(encoding="utf-8"))
    with open(PIPELINE_DIR / cfg["zones_config"], encoding="utf-8") as f:
        roles = output.zone_roles(yaml.safe_load(f)["zones"])
    stations = pd.read_csv(data_dir() / "stations.csv")
    code_of = dict(zip(stations["station_id"].astype(int), stations["old_code"].astype(str)))
    cav = cfg.get("caveats", {})
    out = []
    for tid, lv in levels.items():
        if lv["warning"] is None or lv["evacuate"] is None:
            continue
        code = code_of.get(tid, str(tid))
        zone, role = roles.get(tid, (None, None))
        m = lv["method"]
        flags = {k: code in cav.get(k, []) for k in ("tidal", "lake", "coastal_unchecked")}
        flags["bank_suspect"] = bool(m.get("bank_suspect"))
        flags["never_reached_bank"] = bool(m.get("never_reached_bank"))
        out.append({"code": code, "thaiwater_id": tid, "zone": zone, "role": role,
                    "warning": lv["warning"], "bank": lv["evacuate"], "flags": flags})
    return out


def measure(g: dict, cfg: dict, tidy: Path) -> list[dict]:
    from dam_release.travel import read_hourly

    ev = cfg["events"]
    raw = read_hourly(tidy, "water_level_msl", int(g["thaiwater_id"]))
    level = recession.clean(raw, g["bank"], float(ev["max_above_bank_m"]), int(ev["bridge_h"]))
    observed = level.dropna()
    g["record"] = {
        "from": None if observed.empty else observed.index[0].strftime("%Y-%m-%d"),
        "to": None if observed.empty else observed.index[-1].strftime("%Y-%m-%d"),
        "hours": int(observed.size),
        "years": 0.0 if observed.empty else round((observed.index[-1] - observed.index[0]).days / 365.25, 1),
        "observed_share": None if level.empty else round(float(level.notna().mean()), 3),
        "broken_readings_dropped": int((raw.dropna() > g["bank"] + float(ev["max_above_bank_m"])).sum()),
    }
    exclude = [(x["from"], x["to"]) for x in cfg.get("exclude") or [] if x["code"] == g["code"]]
    return recession.events(level, g["warning"], g["bank"], {**ev, "exclude": exclude})


def cmd_run(cfg: dict) -> int:
    out = output_dir(cfg)
    tidy = data_dir() / "tidy"
    made = date.today().isoformat()
    sm = cfg["summary"]
    rows, all_gauges = [], []
    for g in gauges(cfg):
        evs = measure(g, cfg, tidy)
        g["summary"] = recession.summarise(evs, int(sm["min_events"]), float(sm["half_days_from_h"]))
        done = [e for e in evs if not e["dropped"]]
        g["durations"] = {
            "to_bank_h": [e["to_bank_h"] for e in done if e["over_bank"] and not e["to_bank_censored"]],
            "to_warning_h": [e["to_warning_h"] for e in done if not e["to_warning_censored"]],
        }
        g["usable"] = not g["summary"]["few_events"] and not g["flags"]["bank_suspect"]
        rows += [output.event_row(g, e) for e in evs]
        all_gauges.append(g)
        s = g["summary"]
        print(f"{g['code']:8} {g.get('zone') or '-':14} events {s['events']:3} over bank {s['over_bank']:3} "
              f"censored {s['censored']:2} dropped {sum(s['dropped'].values()):2}  to bank p50 {s['to_bank_h']['p50']}  "
              f"to warning p50 {s['to_warning_h']['p50']}")
    with open(out / "events.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=output.EVENT_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    summary = {"made": made, "rules": cfg["events"], "summary_rules": sm, "gauges": all_gauges}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    text = output.markdown(all_gauges, cfg, made)
    for folder in (out, CONFIG_PATH.parent):
        (folder / "report.md").write_text(text, encoding="utf-8", newline="\n")
    seed = REPO_DIR / "supabase" / "seed" / "48_gauge_recession.sql"
    seed.write_text(output.seed_sql(all_gauges, cfg, made), encoding="utf-8", newline="\n")
    print(f"{len(all_gauges)} gauges, {len(rows)} events -> {out}; seed {seed.name}")
    return 0


def cmd_gauge(cfg: dict, code: str) -> int:
    found = [g for g in gauges(cfg) if g["code"] == code]
    if not found:
        raise SystemExit(f"No gauge {code} with levels in {cfg['levels_sql']}.")
    g = found[0]
    evs = measure(g, cfg, data_dir() / "tidy")
    print(f"{code}: warning {g['warning']} m, bank {g['bank']} m, record {g['record']}")
    for e in evs:
        r = output.event_row(g, e)
        print(f"  {r['peak_bangkok']}  peak {r['peak_m']:6.2f}  to bank {r['to_bank_h'] or '-':>6}"
              f"{'+' if e['to_bank_censored'] else ' '}  to warning {r['to_warning_h'] or '-':>6}"
              f"{'+' if e['to_warning_censored'] else ' '}  over bank {r['above_bank_h']!s:>4} h  {r['dropped']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="safe_return", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    sub.add_parser("gauge").add_argument("code")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if args.command == "gauge":
        return cmd_gauge(cfg, args.code)
    return cmd_run(cfg)


if __name__ == "__main__":
    sys.exit(main())
