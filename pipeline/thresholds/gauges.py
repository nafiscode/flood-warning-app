"""Watch, Warning and Evacuate levels for every river gauge (the owner, 14 Oct 2026: "suggest the
thresholds for all zones in the river gauges, for all 3").

The zone hindcast (report.py) proposed levels for each zone's key gauge only. This does the same
for every gauge with a bank level and a record, one gauge at a time, so an admin who ticks any
gauge for the automated alarm has its own three lines to start from:

* **Evacuate = the bank.** At the bank the river leaves its channel: the irrigation department's
  own definition of a flood at that gauge, and what the key gauges' hindcast chose too. It is also
  what every other level is scored against, so it cannot itself be scored.
* **Warning** = the highest level below the bank whose crossings came, in the median, at least
  `warning_lead_h` hours before the river reached the bank, chosen by the critical success index
  (floods caught / (floods + false alarms)) over the whole record, as for the key gauges.
* **Watch** = the same with at least `watch_lead_h` hours, and at least `min_gap_m` below Warning.

A gauge that went over its bank fewer than `min_floods` times cannot be scored that way. Its
levels then come from how fast that river rises: Warning is the bank less the rise it makes in
`warning_lead_h` hours on its fast days (the `rise_quantile` of all rises over the record), Watch
the bank less the rise in `watch_lead_h` hours, each at least `fallback_min_m` / `2 x` below the
bank. Every gauge says which way its levels were set, and how many floods stood behind them.

All of it is provisional, for an admin to change (safety rule 2: a level here only ever starts a
suggestion, or the automated alarm an admin ticked).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from dam_release.travel import read_hourly

from . import hindcast as hc

DEFAULTS = {
    "warning_lead_h": 6,
    "watch_lead_h": 24,
    "offsets_m": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0],
    "min_floods": 3,
    "min_gap_m": 0.2,
    "rise_quantile": 0.95,
    "fallback_min_m": 0.3,
    "min_years": 3,
    # The most of the record a level may be exceeded in. A Warning the river sits above for weeks
    # is no warning: at the gauges by the sea the tide alone lifts the river most days.
    "warning_max_share": 0.03,
    "watch_max_share": 0.06,
}


def share_above(level: pd.Series, value: float) -> float:
    lv = level.dropna()
    return 0.0 if lv.empty else float((lv >= value).mean())


def round_to(value: float, step: float = 0.05) -> float:
    return round(round(value / step) * step, 2)


def fast_rise(level: pd.Series, hours: int, quantile: float) -> float | None:
    """The rise over `hours` that the river makes on its fast days: a quantile of all rises."""
    lv = level.dropna()
    if len(lv) < 24 * 30:
        return None
    lagged = lv.reindex(lv.index - pd.Timedelta(hours=hours))
    d = lv.to_numpy() - lagged.to_numpy()
    d = d[np.isfinite(d) & (d > 0)]
    return None if d.size < 50 else float(np.quantile(d, quantile))


def pick(level: pd.Series, bank: float, offsets: list[float], onsets: list[pd.Timestamp], lead_h: float,
         ceiling: float, floor: float, cfg: dict) -> dict | None:
    """The best scoring level at least `lead_h` hours ahead, between `floor` and `ceiling`."""
    rows = []
    for off in offsets:
        lv = round(bank - off, 2)
        if lv > ceiling + 1e-9 or lv < floor - 1e-9:
            continue
        alarms = hc.spells(level >= lv, cfg["alarm"]["merge_gap_h"])
        s = hc.score(alarms, onsets, cfg["alarm"]["hit_window_h"])
        rows.append({"level": lv, "below_bank_m": off, **s})
    best = hc.choose(rows, lead_h)
    return None if best is None else {**best, "candidates": len(rows)}


def suggest(level: pd.Series, bank: float, cfg: dict, opts: dict | None = None) -> dict:
    """Watch, Warning and Evacuate for one gauge, with how each was set."""
    o = {**DEFAULTS, **(opts or {})}
    lv = level.dropna()
    years = 0 if lv.empty else (lv.index[-1] - lv.index[0]).days / 365.25
    out: dict = {"evacuate": round(bank, 2), "years": round(years, 1), "max_m": None if lv.empty else round(float(lv.max()), 2)}
    floods = hc.floods(lv, bank, cfg["flood"]["min_hours"], cfg["flood"]["gap_days"]) if not lv.empty else []
    onsets = [f["onset"] for f in floods]
    out["floods"] = len(floods)
    out["bank_reached"] = bool(floods)
    # The lowest a level may sit: exceeded in no more than its share of the record's hours.
    warn_floor = float(lv.quantile(1 - o["warning_max_share"])) if not lv.empty else -math.inf
    watch_floor = float(lv.quantile(1 - o["watch_max_share"])) if not lv.empty else -math.inf
    out["floors"] = {"warning": round(warn_floor, 2), "watch": round(watch_floor, 2)}
    scored = len(floods) >= o["min_floods"] and years >= o["min_years"]
    warning = pick(lv, bank, o["offsets_m"], onsets, o["warning_lead_h"], bank - 0.05, warn_floor, cfg) if scored else None
    # Too few floods, or no level gave the lead: from how fast this river rises on its fast days.
    r_warn = fast_rise(lv, int(o["warning_lead_h"]), o["rise_quantile"]) if not lv.empty else None
    r_watch = fast_rise(lv, int(o["watch_lead_h"]), o["rise_quantile"]) if not lv.empty else None
    out["rise_m"] = {f"{o['warning_lead_h']}h": None if r_warn is None else round(r_warn, 2),
                     f"{o['watch_lead_h']}h": None if r_watch is None else round(r_watch, 2)}
    if warning:
        out["warning"], out["warning_method"] = warning["level"], "hindcast"
        out["warning_score"] = {k: warning[k] for k in ("detected", "false_alarms", "csi", "median_lead_h")}
    elif r_warn is not None:
        out["warning"], out["warning_method"] = round_to(bank - max(o["fallback_min_m"], r_warn)), "rise"
    else:
        out.update({"method": "none", "warning": None, "watch": None})
        return out
    watch = (pick(lv, bank, o["offsets_m"], onsets, o["watch_lead_h"], out["warning"] - o["min_gap_m"], watch_floor, cfg)
             if scored else None)
    if watch:
        out["watch"], out["watch_method"] = watch["level"], "hindcast"
        out["watch_score"] = {k: watch[k] for k in ("detected", "false_alarms", "csi", "median_lead_h")}
    else:
        warn_off = bank - out["warning"]
        # A day's warning lies further down than six hours': at least half as far again.
        watch_off = max(2 * o["fallback_min_m"], r_watch or 0.0, warn_off + max(o["min_gap_m"], 0.5 * warn_off))
        out["watch"], out["watch_method"] = round_to(bank - watch_off), "rise"
    out["method"] = "hindcast" if out["warning_method"] == out["watch_method"] == "hindcast" else (
        "rise" if out["warning_method"] == out["watch_method"] == "rise" else "mixed")
    return finish(out, lv, bank, o)


def finish(out: dict, lv: pd.Series, bank: float, o: dict) -> dict:
    """Lift a level the river sits above too often to its floor; keep the order and the gaps."""
    lifted = False
    floors = out.get("floors", {})
    if out.get("warning") is not None and floors and out["warning"] < floors["warning"]:
        out["warning"] = round_to(min(floors["warning"], bank - 0.05)); lifted = True
    if out.get("watch") is not None and floors and out["watch"] < floors["watch"]:
        out["watch"] = round_to(floors["watch"]); lifted = True
    if out.get("watch") is not None and out.get("warning") is not None:
        out["watch"] = round_to(min(out["watch"], out["warning"] - o["min_gap_m"]))
    out["lifted"] = lifted
    out["never_reached_bank"] = out.get("max_m") is not None and out["max_m"] < bank
    # A bank the river stands within 0.3 m of for a tenth of the record is no flood marker there
    # (by the sea the tide does it): such a gauge needs a flood level from someone who knows it.
    out["bank_suspect"] = share_above(lv, bank - 0.3) > 0.10
    for k in ("watch", "warning", "evacuate"):
        if out.get(k) is not None:
            out.setdefault("share", {})[k] = round(share_above(lv, out[k]) * 100, 1)
    return out


def run(cfg: dict, stations: pd.DataFrame, tidy: Path, gauge_rows: list[dict], opts: dict | None = None,
        accepted: dict | None = None) -> list[dict]:
    """One suggestion per gauge in `gauge_rows` (seed.gauges' rows) that has a bank level.

    `accepted` is the zone hindcast's proposal per zone (hindcast.json), which the owner accepted on
    14 Oct 2026: a key gauge keeps its zone's Warning and Evacuate levels where they are levels at
    that gauge, and gains only a level-based Watch below them.
    """
    zone_of = {}
    role_of = {}
    for zone, z in cfg["zones"].items():
        for role, items in (("key", [z["key"]]), ("upstream", [z["upstream"]]),
                            ("other", z.get("downstream", []) + z.get("extra", []))):
            for g in items:
                zone_of[int(g["id"])] = zone
                role_of[int(g["id"])] = role
    out = []
    for g in gauge_rows:
        bank = g.get("bank")
        if bank is None or (isinstance(bank, float) and math.isnan(bank)):
            out.append({"code": g["code"], "thaiwater_id": g["thaiwater_id"], "zone": g.get("zone"),
                        "method": "no_bank", "watch": None, "warning": None, "evacuate": None})
            continue
        raw = read_hourly(tidy, "water_level_msl", int(g["thaiwater_id"])).dropna()
        # A reading far above anything a bank could hold is a broken sensor, not a flood.
        level = hc.hourly(raw[raw < float(bank) + 15]) if not raw.empty else raw
        s = suggest(level, float(bank), cfg, opts)
        zone = zone_of.get(int(g["thaiwater_id"]))
        if role_of.get(int(g["thaiwater_id"])) == "key" and accepted and zone in accepted:
            kept = []
            for lvl in ("warning", "evacuate"):
                pr = (accepted[zone].get(lvl) or {})
                if pr.get("signal") == "key_level_m":
                    s[lvl] = round(float(pr["threshold"]), 2)
                    s[f"{lvl}_method"] = "accepted"
                    kept.append(lvl)
            if s.get("watch") is not None and s.get("warning") is not None:
                s["watch"] = min(s["watch"], round_to(s["warning"] - DEFAULTS["min_gap_m"]))
            if kept:
                s["kept"] = kept
                s["share"] = {k: round(share_above(level, s[k]) * 100, 1) for k in ("watch", "warning", "evacuate")
                              if s.get(k) is not None}
        out.append({"code": g["code"], "thaiwater_id": g["thaiwater_id"], "zone": zone_of.get(int(g["thaiwater_id"])),
                    "role": role_of.get(int(g["thaiwater_id"])), "name": g["name"].get("th"), "bank": round(float(bank), 2), **s})
    return out


def markdown(rows: list[dict]) -> str:
    def f(v):
        return "–" if v is None else f"{v:.2f}"
    lines = [
        "# Suggested levels for every river gauge",
        "",
        "Generated by `uv run python -m thresholds gauges`. Evacuate is the bank; Warning and Watch were",
        "scored against every time the gauge went over its bank (hindcast), or, with fewer than three such",
        "floods, set from how fast the river rises (rise). All provisional, for an admin to change.",
        "",
        "| Zone | Gauge | Watch | Warning | Evacuate (bank) | Highest recorded | Floods | Years | How |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    order = {"pattani_river": 0, "kolok": 1, "u_taphao": 2, None: 3}
    for r in sorted(rows, key=lambda r: (order.get(r.get("zone"), 3), r.get("role") != "key", r["code"])):
        how = r["method"]
        parts = []
        if r.get("kept"):
            parts.append("Warning/Evacuate as accepted for the zone on 14 Oct" if len(r["kept"]) == 2 else "Evacuate as accepted for the zone on 14 Oct")
        if r.get("warning_method") == "hindcast":
            w = r["warning_score"]
            parts.append(f"Warning scored: caught {w['detected']}/{r['floods']}, {w['false_alarms']} false, lead {w['median_lead_h']} h")
        if r.get("watch_method") == "hindcast":
            w = r["watch_score"]
            parts.append(f"Watch scored: caught {w['detected']}/{r['floods']}, lead {w['median_lead_h']} h")
        if "rise" in (r.get("warning_method"), r.get("watch_method")):
            parts.append("from rises " + ", ".join(f"{k} {v} m" for k, v in r["rise_m"].items()))
        how = "; ".join(parts) or how
        if r.get("lifted"):
            how += "; lifted to its 3 % / 6 % floor"
        if r.get("bank_suspect"):
            how += "; **listed bank looks too low: the river is within 0.3 m of it >10 % of the time**"
        if r.get("never_reached_bank"):
            how += "; **never reached its bank in the record**"
        if r.get("share"):
            how += f"; above Watch {r['share'].get('watch')} % of hours"
        lines.append(f"| {r.get('zone') or '–'} | {r['code']}{' (key)' if r.get('role') == 'key' else ''} | {f(r.get('watch'))} | "
                     f"{f(r.get('warning'))} | {f(r.get('evacuate'))} | {f(r.get('max_m'))} | {r.get('floods', '–')} | "
                     f"{r.get('years', '–')} | {how} |")
    return "\n".join(lines) + "\n"


def seed_sql(rows: list[dict]) -> str:
    """supabase/seed/47_gauge_levels.sql: the suggestions, provisional, never over an admin's own."""
    def num(v):
        return "null" if v is None else repr(round(float(v), 2))

    out = [
        "-- Generated by `uv run python -m thresholds gauges` (pipeline/thresholds/gauges.py). Do not edit.",
        "-- Watch, Warning and Evacuate per river gauge, suggested from the record and provisional: an",
        "-- admin changes them on the signal dashboard, and a level an admin set is never overwritten.",
        "insert into public.gauge_levels (station_id, watch_m, warning_m, evacuate_m, provisional, method)",
        "select s.id, v.watch, v.warning, v.evacuate, true, v.method::jsonb",
        "from (values",
    ]
    values = []
    for r in rows:
        if r.get("evacuate") is None and r.get("warning") is None:
            continue
        method = {
            "how": r.get("method"), "warning": r.get("warning_method"), "watch": r.get("watch_method"),
            "floods": r.get("floods"), "years": r.get("years"), "highest_m": r.get("max_m"),
            "share_above_pct": r.get("share"), "bank_suspect": bool(r.get("bank_suspect")),
            "never_reached_bank": bool(r.get("never_reached_bank")), "lifted": bool(r.get("lifted")),
            "source": "thresholds gauges, 14 Oct 2026",
        }
        text = json.dumps(method, ensure_ascii=False).replace("'", "''")
        values.append(f"  ({int(r['thaiwater_id'])}, {num(r.get('watch'))}::double precision, "
                      f"{num(r.get('warning'))}::double precision, {num(r.get('evacuate'))}::double precision, '{text}')")
    out.append(",\n".join(values))
    out += [
        ") as v (thaiwater_id, watch, warning, evacuate, method)",
        "join public.stations s on s.thaiwater_id = v.thaiwater_id",
        "on conflict (station_id) do update",
        "  set watch_m = excluded.watch_m, warning_m = excluded.warning_m, evacuate_m = excluded.evacuate_m,",
        "      method = excluded.method, updated_at = now()",
        "  where public.gauge_levels.provisional;",
        "",
    ]
    return "\n".join(out)
