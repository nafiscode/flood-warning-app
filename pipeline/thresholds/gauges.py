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

#: Written out rather than escaped, so the generated Markdown is newline-exact on Windows too.
NL = chr(10)
#: An en dash, for an empty cell in the generated tables.
DASH = "\u2013"

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
    # The lead-time floor (the owner, 24 Nov 2026). The two shares above lift a level the river
    # sits above too often, and on nineteen gauges that lift had pushed Watch to within a metre of
    # the bank - on nine of them to within 0.30 m, and Warning to within 0.05 m. A level the river
    # only reaches once it is already at the bank is not a warning, so after the lift a level must
    # still sit at least the rise this river makes in the time it is meant to buy below the bank:
    # cross Warning and about `warning_lead_h` hours remain, cross Watch and about `watch_lead_h`.
    # The room comes from the gauge's own record (`fast_rise`), never from a share of the channel,
    # whose bed figure is wrong at several stations.
    "lead_floor": True,
    # Whatever the rises say, never closer to the bank than this.
    "min_room_warning_m": 0.3,
    "min_room_watch_m": 0.6,
    # Where buying that lead time would put the level under water for more than this share of the
    # record, no fixed level at this gauge is both early and rare. That is a statement about the
    # gauge - a wrong bank, or the sea - and it is reported, never fudged: the level stays where it
    # was and the gauge is marked as needing a level from someone who knows the river.
    "max_share_hard": 0.25,
    # The tide cannot set the water at a gauge whose bank stands this far above the sea.
    "tide_max_bank_m": 5.0,
    "max_tide_m": 0.05,
    "max_pulse_m": 0.20,
    "tide_min_hours": 9600,
    # Lowering a level costs false alarms, so it must buy a worthwhile number of hours. At
    # JNA002 the move bought 0.5 h and cost an extra false alarm, which is paying for nothing.
    "min_gain_h": 2.0,
    # And it must rest on a record long enough to hold floods. TBV029 has 36 days and none;
    # its 24 h "rise" of 49 m put Watch 48 m under Warning. `min_years` already gates the
    # hindcast scoring; it now gates the lead-time floor too.
    "lead_min_years": 3,
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


def tide_driven(level: pd.Series, o: dict, bank: float | None = None) -> dict | None:
    """Is this the sea's gauge rather than the catchment's?

    Reuses Module 11's harmonic fit and its calibrated figures rather than a second opinion of our
    own: the sea's three constituents (M2, K1, O1) above `max_tide_m`, or an exactly-24-hour swing
    above `max_pulse_m`, which is a dam opening its turbines and not the moon. Returns None when
    the record is too short to tell the 24.00-hour line from the moon's 23.93-hour one, because a
    gauge that cannot be judged must be said to be unjudged, not assumed clean.
    """
    try:
        from season_state.state import harmonics
    except ImportError:
        return None
    fit = harmonics(level, min_hours=int(o.get("tide_min_hours", 9600)))
    if fit is None:
        return None
    # Module 11's bar alone is not enough here. It was set for a different question - which gauge
    # has a clean daily baseflow floor - and at 0.05 m the three tidal periods also fit the noise
    # of a mountain river: it marked BLGTD01 (bank 48.68 m), BLGTD02, PAT001 and X.77 as the sea's.
    # The sea cannot set the water at a gauge whose bank stands tens of metres above it, so the
    # amplitude must come with a bank near sea level before it is believed.
    near_sea = bank is not None and float(bank) <= float(o.get("tide_max_bank_m", 5.0))
    fit["near_sea"] = bool(near_sea)
    fit["tide_driven"] = bool(fit["tide_m"] > o.get("max_tide_m", 0.05) and near_sea)
    # A once-a-day swing is a dam opening its turbines (X.77 under Bang Lang, 0.52 m). It moves the
    # daily floor Module 11 reads, which is why that module drops such a gauge - but it does not
    # stop a fixed level working here: the river still leaves its channel at its bank. Recorded,
    # never an exemption.
    fit["pulse_driven"] = bool(fit["pulse_m"] > o.get("max_pulse_m", 0.20))
    return fit


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
    fit = tide_driven(lv, o, bank)
    if fit is not None:
        out["tide"] = {k: fit[k] for k in ("tide_m", "pulse_m", "years")}
        out["tide_driven"] = fit["tide_driven"]
        out["tide_reason"] = "the sea reaches this gauge" if fit["tide_driven"] else None
        if fit["pulse_driven"]:
            # Said out loud, because it is why Module 11 leaves this gauge out of its floors.
            out["daily_pulse_m"] = fit["pulse_m"]
    else:
        out["tide_driven"] = None
        out["tide_reason"] = "too short a record to tell the tide from a daily cycle"
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
    return score_final(finish(out, lv, bank, o, onsets, cfg), lv, onsets, cfg)


def score_final(out: dict, lv: pd.Series, onsets: list, cfg: dict) -> dict:
    """Score the levels that were actually chosen against every flood in the record.

    `warning_score` / `watch_score` only exist where a level came from the hindcast. After the
    lead-time floor has moved a level, and for every level that came from the rises, the cost of
    the level in use was unknown. This measures it: floods caught, false alarms, and the median
    hours between the crossing and the river reaching its bank. It is the number the owner weighs
    the extra lead time against.
    """
    if lv.empty or not onsets:
        return out
    for key in ("warning", "watch"):
        if out.get(key) is None:
            continue
        alarms = hc.spells(lv >= out[key], cfg["alarm"]["merge_gap_h"])
        sc = hc.score(alarms, onsets, cfg["alarm"]["hit_window_h"])
        out[f"{key}_as_set"] = {k: sc[k] for k in ("detected", "false_alarms", "csi", "median_lead_h")
                                if k in sc}
    return out


def apply_lead(out: dict, lv: pd.Series, bank: float, o: dict,
               onsets: list | None = None, cfg: dict | None = None) -> dict:
    """Pull a level back down to where crossing it still buys the lead time it promises.

    Runs after `finish`'s share floors, because it is those floors that take the lead away: a
    gauge whose water sits high for much of the record has its 97th percentile a few centimetres
    under its bank, and the lift then puts Warning there. Lowering it again costs false alarms,
    which the report prints, and buys hours, which is the trade the owner asked for.

    A gauge the sea reaches is left alone: no fixed level in metres above sea level can work there,
    and the tide-aware levels are their own piece of work (decision 2026-11-22). Nothing here
    publishes or raises anything (safety rule 2).
    """
    if not o.get("lead_floor", True) or out.get("tide_driven"):
        return out
    years = out.get("years") or 0
    if years < o.get("lead_min_years", 3):
        # Too short a record to see this river's floods in, so too short to re-derive from. Said,
        # not guessed at: TBV029's 36 days produced a 49 m "rise" and a level 48 m out of place.
        out["lead_floor_skipped"] = (f"only {years} years of record, under the "
                                     f"{o.get('lead_min_years', 3)} this needs")
        return out
    rises = out.get("rise_m") or {}
    moved: dict = {}
    for key, lead_h, min_room in (("warning", o["warning_lead_h"], o["min_room_warning_m"]),
                                  ("watch", o["watch_lead_h"], o["min_room_watch_m"])):
        if out.get(key) is None:
            continue
        rise = rises.get(f"{lead_h}h")
        room = max(float(min_room), float(rise or 0.0))
        # A rise taller than the whole working depth of the river is a broken record, not a flood:
        # at TBV029 it was 49 m, which put Watch 48 m under Warning. Such a gauge keeps its level
        # and is reported, because inventing one from a figure this wrong is worse than saying so.
        depth = bank - float(lv.median()) if not lv.empty else None
        if depth is not None and depth > 0 and room > depth:
            out.setdefault("lead_floor_applied", {})[key] = {
                "was": out[key], "room_needed_m": round(room, 2),
                "working_depth_m": round(depth, 2),
                "left_alone": f"the {lead_h} h rise in the record is {round(room, 2)} m, taller than the "
                              f"river's whole working depth of {round(depth, 2)} m",
            }
            out["needs_human_level"] = True
            continue
        ceiling = round_to(bank - room)
        if out[key] <= ceiling + 1e-9:
            continue
        share = share_above(lv, ceiling)
        note = {"was": out[key], "room_needed_m": round(room, 2),
                "would_sit_above_pct": round(share * 100, 1)}
        if share > o["max_share_hard"]:
            # Being honest is the whole point: say the gauge cannot have both, and leave the level.
            note["left_alone"] = "no level here is both early and rare"
            out["needs_human_level"] = True
        else:
            # What the move costs and buys, both measured the same way against the same floods.
            if onsets and cfg is not None:
                for label, level in (("before", note["was"]), ("after", ceiling)):
                    alarms = hc.spells(lv >= level, cfg["alarm"]["merge_gap_h"])
                    sc = hc.score(alarms, onsets, cfg["alarm"]["hit_window_h"])
                    note[label] = {k: sc[k] for k in ("detected", "false_alarms", "csi", "median_lead_h")
                                   if k in sc}
            was_lead = (note.get("before") or {}).get("median_lead_h")
            now_lead = (note.get("after") or {}).get("median_lead_h")
            gain = None if was_lead is None or now_lead is None else float(now_lead) - float(was_lead)
            if gain is not None and gain < o.get("min_gain_h", 2.0):
                # It would cost false alarms and buy no time. The level stays where it is.
                note["left_alone"] = (f"it would buy only {round(gain, 1)} h, under the "
                                      f"{o.get('min_gain_h', 2.0)} h this asks of a move")
                note.pop("now", None)
                moved[key] = note
                continue
            out[key] = ceiling
            note["now"] = ceiling
        moved[key] = note
    if out.get("watch") is not None and out.get("warning") is not None:
        out["watch"] = round_to(min(out["watch"], out["warning"] - o["min_gap_m"]))
    if moved:
        out["lead_floor_applied"] = moved
    for k in ("watch", "warning", "evacuate"):
        if out.get(k) is not None:
            out.setdefault("share", {})[k] = round(share_above(lv, out[k]) * 100, 1)
    out["room_m"] = {k: round(bank - out[k], 2) for k in ("watch", "warning") if out.get(k) is not None}
    return out


def finish(out: dict, lv: pd.Series, bank: float, o: dict,
           onsets: list | None = None, cfg: dict | None = None) -> dict:
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
    return apply_lead(out, lv, bank, o, onsets, cfg)


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
            # An accepted level is the owner's decision of 14 Oct 2026, so the lead-time floor
            # never moves it. It does say so when one of them buys less time than it promises,
            # which is a thing for the owner to look at, not for this to quietly fix.
            o = {**DEFAULTS, **(opts or {})}
            for lvl, lead_h, min_room in (("warning", o["warning_lead_h"], o["min_room_warning_m"]),
                                          ("watch", o["watch_lead_h"], o["min_room_watch_m"])):
                if lvl not in kept or s.get(lvl) is None:
                    continue
                rise = (s.get("rise_m") or {}).get(f"{lead_h}h")
                room = max(float(min_room), float(rise or 0.0))
                if float(bank) - s[lvl] < room - 1e-9:
                    s.setdefault("lead_short", {})[lvl] = {
                        "room_m": round(float(bank) - s[lvl], 2), "room_needed_m": round(room, 2)}
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
        "**These are a proposal, not what the database holds.** The seed is written only when the",
        "command is given `--write-seed`, so until the owner has approved `lead_time.md` beside this",
        "file, `gauge_levels` on jaga-dev still carries the previous levels.",
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


def comparison(rows: list[dict], old: list[dict] | None) -> str:
    """What the lead-time floor changed, per gauge, with what it costs in false alarms.

    For the owner to approve before any seed is written (their choice, 24 Nov 2026). Every level
    that moved is priced twice over the same floods and the same record - where it was and where it
    now is - so the hours gained can be weighed against the false alarms they cost. A gauge nothing
    moved on is listed too, because a table that omits the unchanged rows cannot be checked against
    the one in the database.
    """
    def f(v, nd=2):
        return DASH if v is None else f"{v:.{nd}f}"

    def room(r, key):
        bank = r.get("evacuate")
        return None if bank is None or r.get(key) is None else bank - r[key]

    def cost(note, side):
        sc = note.get(side) or {}
        if not sc:
            return " | ".join([DASH] * 3)
        return " | ".join([str(sc.get("detected", DASH)), str(sc.get("false_alarms", DASH)),
                           f(sc.get("median_lead_h"), 1) + " h"])

    moved = [r for r in rows if any("now" in n for n in (r.get("lead_floor_applied") or {}).values())]
    held = [r for r in rows if any("left_alone" in n for n in (r.get("lead_floor_applied") or {}).values())]
    short = [r for r in rows if r.get("lead_short")]
    tidal = [r for r in rows if r.get("tide_driven")]
    unjudged = [r for r in rows if r.get("tide_driven") is None]
    pulse = [r for r in rows if r.get("daily_pulse_m")]

    lines = [
        "# The lead-time floor: what it changes, and what it costs",
        "",
        "Generated by `uv run python -m thresholds gauges`. **Nothing here is in the database.** The",
        "seed is written only when that command is given `--write-seed`, so this table is read first",
        "(the owner's choice, 24 Nov 2026).",
        "",
        "## Why",
        "",
        "Watch and Warning are lifted to the 94th and 97th percentile of the gauge's own record, so a",
        "level the river sits above for weeks is never used. On a gauge whose water stands high for",
        "much of the year that percentile is a few centimetres under the bank, and the lift was taking",
        "all the warning away: measured against jaga-dev on 24 Nov 2026, nineteen gauges had Watch",
        "less than 1 m below the bank, nine of them less than 0.30 m, and on four Warning sat within",
        "0.05 m of it. Crossing such a line tells nobody anything they cannot see from the bridge.",
        "",
        "A level must now also sit at least the rise this river makes, in its own record, over the",
        "hours it is meant to buy. The room is never a share of the channel: several stations' bed",
        "figures are wrong, and a bed cannot be trusted to set a warning.",
        "",
        "Two guards keep that from doing harm. A level is lowered only where the move buys at least",
        f"{DEFAULTS['min_gain_h']} h of extra warning - otherwise it would cost false alarms and buy",
        f"nothing - and only on a gauge with at least {DEFAULTS['lead_min_years']} years of record,",
        "because a record too short to hold floods is too short to re-derive from.",
        "",
        "Both sides below are scored the same way over the same floods, so the hours gained and the",
        "false alarms paid for them are comparable. Nothing here publishes or raises anything: a level",
        "only ever starts a suggestion, or the alarm on a gauge an admin has ticked (safety rule 2).",
        "",
        f"## Moved: {len(moved)} gauges",
        "",
        "| Gauge | Level | Was | Now | Room to bank | Caught before | False before | Lead before | Caught after | False after | Lead after |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    overridden = []
    for r in sorted(moved, key=lambda r: r["code"]):
        for key, note in (r.get("lead_floor_applied") or {}).items():
            if "now" not in note:
                continue
            final = r.get(key)
            # A key gauge's Warning and Evacuate are replaced afterwards by the levels the owner
            # accepted for the zone on 14 Oct 2026. Where that happened, no move reaches the seed.
            if final is not None and abs(float(final) - float(note["now"])) > 1e-9:
                overridden.append((r["code"], key, note["now"], final))
                continue
            lines.append(
                f"| {r['code']} | {key} | {f(note['was'])} | {f(final)} | {f(room(r, key))} m | "
                f"{cost(note, 'before')} | {cost(note, 'after')} |")
    lines += [
        "",
        "A gauge whose Watch is not in that table may still have moved, because Watch is kept at",
        f"least {DEFAULTS['min_gap_m']} m under Warning: lowering Warning pulls it down with it.",
        "",
    ]
    if overridden:
        lines += [
            "The lead-time floor wanted to move these too, but a key gauge's Warning and Evacuate are",
            "the levels the owner accepted for the zone on 14 Oct 2026, and those win. **Nothing below",
            "reaches the seed** - it is here so the disagreement is visible rather than silent.",
            "",
            "| Gauge | Level | The floor wanted | The accepted level, which stands |",
            "|---|---|---|---|",
        ]
        for code, key, wanted, final in overridden:
            lines.append(f"| {code} | {key} | {f(wanted)} | {f(final)} |")
        lines.append("")
    lines += [
        f"## Left where it was, and why: {len(held)} gauges",
        "",
        "No fixed level at these gauges is both early and rare. That is a fact about the gauge - a",
        "wrong bank, or the sea - and it is said, not fudged: the level does not move, and the gauge",
        "is marked as needing one from someone who knows the river.",
        "",
        "| Gauge | Level | Room to bank | Room needed | Why |",
        "|---|---|---|---|---|",
    ]
    for r in sorted(held, key=lambda r: r["code"]):
        for key, note in (r.get("lead_floor_applied") or {}).items():
            if "left_alone" not in note:
                continue
            extra = note.get("would_sit_above_pct")
            why = note["left_alone"]
            if extra:
                why += f" (it would stand above it {extra} % of the record)"
            lines.append(f"| {r['code']} | {key} | {f(room(r, key))} m | {f(note.get('room_needed_m'))} m | {why} |")
    if short:
        lines += [
            "",
            f"## The owner's own levels, reported and not moved: {len(short)}",
            "",
            "Accepted for their zone on 14 Oct 2026, so nothing here touches them. They buy less time",
            "than the rise in their own record suggests they should, which is for the owner to weigh.",
            "",
            "| Gauge | Level | Room to bank | Room the record suggests |",
            "|---|---|---|---|",
        ]
        for r in sorted(short, key=lambda r: r["code"]):
            for key, note in r["lead_short"].items():
                lines.append(f"| {r['code']} | {key} | {f(note.get('room_m'))} m | {f(note.get('room_needed_m'))} m |")
    skipped = [r for r in rows if r.get("lead_floor_skipped")]
    if skipped:
        lines += [
            "",
            f"## Too short a record to re-derive from: {len(skipped)}",
            "",
            "Their levels are untouched by this, and they must not be armed on them.",
            "",
            "| Gauge | Why |",
            "|---|---|",
        ]
        for r in sorted(skipped, key=lambda r: r["code"]):
            lines.append(f"| {r['code']} | {r['lead_floor_skipped']} |")
    lines += [
        "",
        f"## The sea's gauges, left for the tide-aware levels: {len(tidal)}",
        "",
        "A fixed level in metres above sea level cannot work where the tide sets the water (decision",
        "2026-11-22). The lead-time floor skips these, and they must not be armed until their levels",
        "are measured on the daily minimum instead of the raw reading. A gauge counts as the sea's",
        f"only when the tidal fit exceeds {DEFAULTS['max_tide_m']} m **and** its bank stands no more",
        f"than {DEFAULTS['tide_max_bank_m']} m above sea level: the amplitude on its own also fits the",
        "noise of a mountain river, and had marked BLGTD01, whose bank is 48.68 m up, as tidal.",
        "",
        "| Gauge | Bank | Tide (M2+K1+O1) | Years of record |",
        "|---|---|---|---|",
    ]
    for r in sorted(tidal, key=lambda r: r["code"]):
        t = r.get("tide") or {}
        lines.append(f"| {r['code']} | {f(r.get('evacuate'))} m | {f(t.get('tide_m'), 3)} m | {f(t.get('years'), 1)} |")
    if pulse:
        lines += [
            "",
            f"## Moved once a day by something that is not the moon: {len(pulse)}",
            "",
            "An exactly-24-hour swing is a dam opening its turbines, not the tide. It does **not**",
            "exempt a gauge here - the river still leaves its channel at its bank - but it is why",
            "Module 11 leaves these gauges out of its baseflow floors.",
            "",
            "| Gauge | Once-a-day swing |",
            "|---|---|",
        ]
        for r in sorted(pulse, key=lambda r: r["code"]):
            lines.append(f"| {r['code']} | {f(r['daily_pulse_m'], 3)} m |")
    lines += [
        "",
        f"## Not judged for the tide: {len(unjudged)}",
        "",
        "Telling an exactly-24-hour swing from the moon's 23.93-hour one needs more than a year of",
        "record. Below that no judgement is made and none is assumed: these keep the lead-time floor",
        "but are **not** cleared of being tidal.",
        "",
        "| Gauge | Why |",
        "|---|---|",
    ]
    for r in sorted(unjudged, key=lambda r: r["code"]):
        lines.append(f"| {r['code']} | {r.get('tide_reason') or 'no record'} |")
    return NL.join(lines) + NL


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
        "-- A zone's key and upstream gauges: their levels are the zone's own threshold boxes",
        "-- (key_level_m, upstream_level_m). Provisional thresholds only; an admin's are kept.",
        "select public.gauge_levels_to_zone(station_id, null) from public.gauge_levels;",
        "",
    ]
    return "\n".join(out)
