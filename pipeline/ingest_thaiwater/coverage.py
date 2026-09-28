"""Coverage report: per station and variable, first/last timestamp, time step, gaps, and how much
of the Nov–Dec 2024 and Nov–Dec 2025 flood seasons is covered."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .settings import BANGKOK

SEASONS = {"Nov–Dec 2024": ("2024-11-01", "2025-01-01"), "Nov–Dec 2025": ("2025-11-01", "2026-01-01")}
VARIABLES = ["water_level_msl", "discharge", "rain_daily", "rain_1h"]
GAP_FACTOR = 3  # a gap is a jump longer than 3x the station's usual time step


def series_stats(ts: pd.Series) -> dict:
    """ts: sorted, unique UTC timestamps for one station and variable."""
    ts = ts.sort_values().drop_duplicates().reset_index(drop=True)
    diffs = ts.diff().dropna()
    step = diffs.median() if len(diffs) else pd.Timedelta(0)
    gaps = diffs[diffs > GAP_FACTOR * step] if step > pd.Timedelta(0) else diffs.iloc[0:0]
    out = {
        "first": ts.iloc[0],
        "last": ts.iloc[-1],
        "n": len(ts),
        "step_min": step.total_seconds() / 60,
        "gaps": len(gaps),
        "longest_gap_days": round(gaps.max().total_seconds() / 86400, 1) if len(gaps) else 0.0,
    }
    for label, (a, b) in SEASONS.items():
        start = pd.Timestamp(a, tz=BANGKOK).tz_convert("UTC")
        end = pd.Timestamp(b, tz=BANGKOK).tz_convert("UTC")
        inside = int(((ts >= start) & (ts < end)).sum())
        expected = (end - start) / step if step > pd.Timedelta(0) else 0
        out[label] = round(100 * min(1.0, inside / expected), 0) if expected else 0.0
    return out


def collect(tidy_root: Path) -> pd.DataFrame:
    rows = []
    for variable in VARIABLES:
        vdir = tidy_root / variable
        if not vdir.exists():
            continue
        for sdir in sorted(p for p in vdir.iterdir() if p.is_dir()):
            files = sorted(sdir.glob("*.parquet"))
            if not files:
                continue
            ts = pd.concat([pd.read_parquet(f, columns=["ts"])["ts"] for f in files], ignore_index=True)
            if ts.empty:
                continue
            rows.append({"variable": variable, "station_id": int(sdir.name), **series_stats(ts)})
    return pd.DataFrame(rows)


def _fmt(ts) -> str:
    return ts.tz_convert(BANGKOK).strftime("%Y-%m-%d %H:%M") if pd.notna(ts) else ""


def render(stats: pd.DataFrame, stations: pd.DataFrame | None, backfill: dict) -> str:
    now = datetime.now(timezone.utc).astimezone(BANGKOK).strftime("%Y-%m-%d %H:%M")
    lines = [
        "# ThaiWater archive coverage",
        "",
        f"Generated {now} (Asia/Bangkok). Times below are Bangkok time.",
        "Source: ThaiWater (HII) public API. Season columns show the % of expected readings present.",
        f"A gap is a jump longer than {GAP_FACTOR}× the station's usual time step.",
        "",
    ]
    names = {}
    if stations is not None and not stations.empty:
        names = stations.set_index("station_id")[["old_code", "name_en", "name_th", "province_en", "agency"]].to_dict("index")
        lines += [
            f"Stations in scope: {len(stations)} "
            f"(water-level candidates {int(stations['wl_candidate'].sum())}, "
            f"rain candidates {int(stations['rain_candidate'].sum())}).",
            "",
        ]
    if backfill:
        lines += [f"Daily-rain backfill: target {backfill.get('target', '?')}, "
                  f"{'complete' if backfill.get('complete') else 'in progress'}"
                  f" (last run {backfill.get('last_run', '?')}).", ""]
    if stats.empty:
        return "\n".join(lines + ["No data archived yet.", ""])

    for variable in VARIABLES:
        v = stats[stats["variable"] == variable]
        if v.empty:
            continue
        covered = int((v["Nov–Dec 2025"] >= 80).sum())
        lines += [
            f"## {variable}",
            "",
            f"{len(v)} stations with data; {covered} have at least 80% of Nov–Dec 2025.",
            "",
            "| station | code | name | province | agency | first | last | step (min) | readings | gaps | longest gap (d) | Nov–Dec 2024 % | Nov–Dec 2025 % |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for _, r in v.sort_values("station_id").iterrows():
            meta = names.get(r["station_id"], {})
            name = meta.get("name_en") or meta.get("name_th") or ""
            s24, s25 = r["Nov–Dec 2024"], r["Nov–Dec 2025"]
            lines.append(
                f"| {r['station_id']} | {meta.get('old_code') or ''} | {name} | {meta.get('province_en') or ''} "
                f"| {meta.get('agency') or ''} | {_fmt(r['first'])} | {_fmt(r['last'])} | {r['step_min']:g} "
                f"| {r['n']} | {r['gaps']} | {r['longest_gap_days']:g} | {s24:g} | {s25:g} |"
            )
        lines.append("")
    return "\n".join(lines)


def write_report(tidy_root: Path, stations: pd.DataFrame | None, backfill: dict, out: Path) -> pd.DataFrame:
    stats = collect(tidy_root)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(stats, stations, backfill), encoding="utf-8")
    return stats
