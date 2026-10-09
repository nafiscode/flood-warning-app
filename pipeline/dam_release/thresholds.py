"""What the archive says about the grade criteria.

The app grades the dam's live figures by named rules, not by a probability: there are three
releases in the whole record (2014, 2015 and January 2021), no hydraulic model and hourly
gauges, so any percentage would be invented precision (safety rule 8). This module measures each
rule against the archive so the numbers in config.yaml - and the ones admins later change - are
answerable: how often the rule would have fired, and what the record's own ceilings are.

Units: ThaiWater's hourly release and spill are volumes per hour in million cubic metres, which
is what `MM3_PER_H_TO_CMS` converts. The daily series is cross-checked in METHODS.md.
"""

from __future__ import annotations

import logging

import pandas as pd

log = logging.getLogger("dam_release")

# 1 million m3 in an hour = 1e6 / 3600 m3/s.
MM3_PER_H_TO_CMS = 1e6 / 3600.0

HOURLY = ("dam_storage", "dam_level", "dam_inflow_1h", "dam_released_1h", "dam_spilled_1h")


def read_series(tidy_dir, variable: str, dam_id: int) -> pd.Series:
    """One variable's whole hourly history, indexed by time in UTC."""
    folder = tidy_dir / variable / str(dam_id)
    files = sorted(folder.glob("*.parquet"))
    if not files:
        raise FileNotFoundError(
            f"no archive for {variable} at {folder}. Run "
            "`uv run python -m ingest_thaiwater dams` first."
        )
    frame = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    frame = frame.dropna(subset=["value"]).sort_values("ts")
    return pd.Series(frame["value"].to_numpy(), index=pd.DatetimeIndex(frame["ts"]), name=variable)


def frame(tidy_dir, dam_id: int) -> pd.DataFrame:
    """Storage, level, inflow, release and spill on one hourly index, with the flows in m3/s and
    the total outflow (what actually leaves the dam) added."""
    columns = {name: read_series(tidy_dir, name, dam_id) for name in HOURLY}
    out = pd.DataFrame(columns).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    for name in ("dam_inflow_1h", "dam_released_1h", "dam_spilled_1h"):
        out[name.replace("_1h", "_cms")] = out[name] * MM3_PER_H_TO_CMS
    out["outflow_cms"] = out["dam_released_cms"].fillna(0) + out["dam_spilled_cms"].fillna(0)
    return out


def confirmed(mask: pd.Series, consecutive: int) -> pd.Series:
    """A rule counts only once it has held for `consecutive` readings in a row.

    This is the spike guard: the archive holds single impossible hours, and one of them must not
    put a notice on a screen or wake an admin. The reading itself is never discarded - the app
    shows it and says it is waiting for the next one.
    """
    if consecutive <= 1:
        return mask
    held = mask.astype(bool)
    for back in range(1, consecutive):
        held &= mask.shift(back).fillna(False).astype(bool)
    return held


def spells(mask: pd.Series) -> int:
    """How many separate episodes a rule had, not how many hours. An admin is told once when a
    release starts, so episodes are what the notice load actually is."""
    flag = mask.astype(bool)
    return int((flag & ~flag.shift(1).fillna(False).astype(bool)).sum())


def evidence(data: pd.DataFrame, grades: dict, storage: dict) -> dict:
    """Every rule in config.yaml measured against the archive."""
    hours = len(data)
    consecutive = int(grades.get("min_consecutive_h", 1))
    spill = data["dam_spilled_cms"].fillna(0)
    outflow = data["outflow_cms"]
    dry = outflow[spill <= 0]
    rise = data["dam_storage"].diff(grades["rise_window_h"]) / grades["rise_window_h"]
    turbine = float(grades["turbine_max_cms"])

    def share(mask) -> float:
        return round(float(mask.sum()) / hours, 5) if hours else 0.0

    spill_years = (
        spill[spill > 0].groupby(spill[spill > 0].index.year).agg(["size", "max"])
        .rename(columns={"size": "hours", "max": "peak_cms"})
    )
    return {
        "hours_in_archive": hours,
        "first": str(data.index.min()),
        "last": str(data.index.max()),
        "spill": {
            "hours": int((spill > 0).sum()),
            "share_of_hours": share(spill > 0),
            "by_year": {int(y): {"hours": int(r["hours"]), "peak_cms": round(float(r["peak_cms"]), 1)}
                        for y, r in spill_years.iterrows()},
        },
        "outflow_cms": {
            "max": round(float(outflow.max()), 1),
            "max_without_spill": round(float(dry.max()), 1) if len(dry) else None,
            "p99_without_spill": round(float(dry.quantile(0.99)), 1) if len(dry) else None,
            "median": round(float(outflow.median()), 1),
            # The rule that says a gate is open. If this fires far more often than the spill
            # hours, the turbine ceiling in config.yaml is set too low.
            "hours_above_turbine_max": int((outflow > turbine).sum()),
            "share_above_turbine_max": share(outflow > turbine),
        },
        "storage_mcm": {
            "max": round(float(data["dam_storage"].max()), 1),
            "normal_high": storage["normal_mcm"],
            "hours_above_normal_high": int((data["dam_storage"] > storage["normal_mcm"]).sum()),
            "share_above_normal_high": share(data["dam_storage"] > storage["normal_mcm"]),
            "percent_full_now": round(float(data["dam_storage"].iloc[-1]) / storage["max_mcm"] * 100, 1),
        },
        "rise_mcm_per_h": {
            "window_h": grades["rise_window_h"],
            "max": round(float(rise.max()), 2),
            "p99": round(float(rise.quantile(0.99)), 2),
            "hours_above_rule": int((rise > grades["rise_mcm_per_h"]).sum()),
            "share_above_rule": share(rise.fillna(0) > grades["rise_mcm_per_h"]),
        },
        "inflow_cms": {
            "max": round(float(data["dam_inflow_cms"].max()), 1),
            "p99": round(float(data["dam_inflow_cms"].quantile(0.99)), 1),
            "hours_above_rule": int((data["dam_inflow_cms"] > grades["inflow_high_cms"]).sum()),
            "share_above_rule": share(data["dam_inflow_cms"].fillna(0) > grades["inflow_high_cms"]),
        },
        # What the two tiers would have cost over the whole record: the hours the app would have
        # shown its quiet attention notice, the hours that would have reached an admin, and - the
        # number that matters - how many separate times the admins would have been told.
        "tiers": {
            "confirmed_over_h": consecutive,
            **_tier_counts(data, spill, outflow, rise, grades, storage, turbine, consecutive),
        },
    }


def _tier_counts(data, spill, outflow, rise, grades, storage, turbine, consecutive) -> dict:
    watchful = ((data["dam_storage"] > storage["normal_mcm"])
                | (rise.fillna(0) > grades["rise_mcm_per_h"])
                | (data["dam_inflow_cms"].fillna(0) > grades["inflow_high_cms"]))
    releasing = (spill > 0) | (outflow > turbine)
    watchful_ok = confirmed(watchful, consecutive)
    releasing_ok = confirmed(releasing, consecutive)
    return {
        "watchful_hours_raw": int(watchful.sum()),
        "watchful_hours": int(watchful_ok.sum()),
        "watchful_spells": spells(watchful_ok),
        "releasing_hours_raw": int(releasing.sum()),
        "releasing_hours": int(releasing_ok.sum()),
        "releasing_spells": spells(releasing_ok),
        # Single readings the confirmation rule holds back. Each one is still shown, as a figure
        # waiting for the next reading.
        "single_readings_held_back": int((releasing & ~releasing_ok).sum()),
    }
