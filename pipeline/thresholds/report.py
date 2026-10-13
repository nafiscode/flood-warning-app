"""The hindcast itself: read the signals, find the floods, score the candidates, write it down."""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import yaml

from dam_release.travel import read_hourly

from . import hindcast as hc
from . import sources

BKK = "Asia/Bangkok"


def local(t) -> str:
    return pd.Timestamp(t).tz_convert(BKK).strftime("%d %b %Y %H:%M")


def gauge(tidy: Path, g: dict) -> pd.Series:
    s = read_hourly(tidy, "water_level_msl", int(g["id"])).dropna()
    # A reading far above anything a bank could hold is a broken sensor, not a flood.
    return hc.hourly(s[s < float(g["bank_m"]) + 15])


def timeline(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_zone(zone: str, z: dict, cfg: dict, out: Path, tidy: Path, rain: pd.DataFrame, events: list[dict]) -> dict:
    s = cfg["seasons"]
    key, up = z["key"], z["upstream"]
    level, up_level = gauge(tidy, key), gauge(tidy, up)
    column = f"{zone}.{z['rain_basin']}"
    basin_rain = rain[column] if column in rain else pd.Series(dtype=float)
    r24, r72 = hc.rolling_sum(basin_rain, 24), hc.rolling_sum(basin_rain, 72)
    glofas = sources.read_glofas(out, zone)

    def seasonal(series: pd.Series) -> pd.Series:
        if series.empty:
            return series
        return series[hc.in_seasons(series.index, s["first"], s["last"], s["start_month"], s["end_month"])]

    all_floods = hc.floods(level, float(key["bank_m"]), int(cfg["flood"]["min_hours"]), float(cfg["flood"]["gap_days"]))
    floods = [f for f in all_floods if (hc.season_of(f["onset"], s["start_month"], s["end_month"]) or 0) >= s["first"]]
    onsets = [f["onset"] for f in floods]
    # Hours in which the key gauge would have shown a flood: it reported within the day.
    judged = level.notna().rolling(25, center=True, min_periods=1).max().astype(bool) if not level.empty else pd.Series(dtype=bool)
    judged = judged.reindex(r72.index, fill_value=False) if not r72.empty else judged

    signals = {
        "rain_24h_mm": r24, "rain_72h_mm": r72,
        "key_level_m": level, "upstream_level_m": up_level,
        "key_rise_m": hc.rise(level, int(cfg["rise_window_h"])),
        "glofas_cms": glofas.resample("1h").ffill() if not glofas.empty else glofas,
    }
    leads = list(cfg["leads_h"])
    for f in floods:
        f["season"] = hc.season_of(f["onset"], s["start_month"], s["end_month"])
        f["before"] = {name: hc.before(sig, f["onset"], leads) for name, sig in signals.items() if not sig.empty}
        peak = up_level[f["onset"] - pd.Timedelta("72h"):f["end"]]
        f["upstream_peak"] = None if peak.dropna().empty else {"m": round(float(peak.max()), 2), "at": peak.idxmax()}

    def run(flag: pd.Series) -> dict:
        flag = seasonal(flag)
        return hc.score(hc.spells(flag, float(cfg["alarm"]["merge_gap_h"])), onsets, float(cfg["alarm"]["hit_window_h"]),
                        judged.reindex(flag.index, fill_value=False))

    scored: dict[str, list[dict]] = {}
    c = cfg["candidates"]
    scored["rain_72h_mm"] = [{"threshold": v, **run(r72 >= v)} for v in c["rain_72h_mm"]] if not r72.empty else []
    scored["rain_24h_mm"] = [{"threshold": v, **run(r24 >= v)} for v in c["rain_24h_mm"]] if not r24.empty else []
    scored["key_level_m"] = [{"threshold": round(float(key["bank_m"]) - v, 2), "below_bank_m": v,
                              **run(level >= float(key["bank_m"]) - v)} for v in c["key_below_bank_m"]]
    scored["upstream_level_m"] = [{"threshold": round(float(up["bank_m"]) - v, 2), "below_bank_m": v,
                                   **run(up_level >= float(up["bank_m"]) - v)} for v in c["upstream_below_bank_m"]] if not up_level.empty else []

    watch = hc.choose(scored["rain_72h_mm"], 12)
    warn_options = {name: hc.choose(scored[name], 3) for name in ("upstream_level_m", "key_level_m", "rain_24h_mm")}
    warn_name, warning = None, None
    for name, row in warn_options.items():
        if row and (warning is None or (row["csi"], row["detected"], row["median_lead_h"] or 0) >
                    (warning["csi"], warning["detected"], warning["median_lead_h"] or 0)):
            warn_name, warning = name, row

    seasons_with_gauge = sorted({hc.season_of(t, s["start_month"], s["end_month"]) for t in seasonal(level).dropna().index[::24]} - {None})
    return {
        "zone": zone, "name": z["name"], "key": key, "upstream": up, "rain_basin": column,
        "gauge_from": None if level.empty else level.index[0], "seasons_with_gauge": seasons_with_gauge,
        "rain_seasons": sorted({hc.season_of(t, s["start_month"], s["end_month"]) for t in basin_rain.index[::240]} - {None}) if not basin_rain.empty else [],
        "floods": floods, "leads_h": leads, "scored": scored,
        "proposal": {
            "watch": None if watch is None else {"signal": "rain_72h_mm", **watch},
            "warning": None if warning is None else {"signal": warn_name, **warning},
            "evacuate": {"signal": "key_level_m", "threshold": float(key["bank_m"]),
                         "note": "the key gauge at its bank: flooding is under way, lead time nil by definition"},
        },
        "timeline": [e for e in events if e.get("zone") == zone],
    }


def build(cfg: dict, out: Path, data: Path) -> dict:
    rain = sources.read_rain(out)
    events = timeline(data / "event_timeline.csv")
    zones = {zone: build_zone(zone, z, cfg, out, data / "tidy", rain, events) for zone, z in cfg["zones"].items()}
    return {"provisional": True, "built": pd.Timestamp.now(tz="UTC").isoformat(timespec="minutes"),
            "seasons": cfg["seasons"], "alarm": cfg["alarm"], "flood": cfg["flood"], "zones": zones}


def _row(r: dict) -> str:
    def cell(v):
        return "–" if v is None else str(v)
    return (f"| {cell(r['threshold'])} | {r['detected']}/{r['floods']} | {r['alarms']} | {r['hits']} | {r['false_alarms']} | "
            f"{r['unjudged_alarms']} | {cell(r['pod'])} | {cell(r['far'])} | {cell(r['csi'])} | {cell(r['median_lead_h'])} | {cell(r['shortest_lead_h'])} |")


TITLES = {
    "rain_72h_mm": "Rain over the basin in 72 hours (mm)",
    "rain_24h_mm": "Rain over the basin in 24 hours (mm)",
    "key_level_m": "Level at the key gauge (m MSL)",
    "upstream_level_m": "Level at the upstream gauge (m MSL)",
    "key_rise_m": "Rise at the key gauge over six hours (m)",
    "glofas_cms": "Modelled discharge, GloFAS (m³/s)",
}


def markdown(result: dict, cfg: dict) -> str:
    s = cfg["seasons"]
    lines = [
        "# Threshold hindcast: provisional", "",
        f"Built {result['built']} (UTC). **Every figure here is provisional.** The thresholds suggest a level to an admin; "
        "they never publish one. Times are Thailand time.", "",
        f"Seasons: October to January, {s['first']} to {s['last']} (named by the year they start in). A flood is the key gauge "
        f"at or above its bank for {cfg['flood']['min_hours']} hours or more. An alarm is a spell above a threshold "
        f"(spells within {cfg['alarm']['merge_gap_h']} h are one); it is a hit when a flood begins while it stands or within "
        f"{cfg['alarm']['hit_window_h']} h of its start. Alarms in seasons before the gauge reported are counted apart as "
        "unjudged: nobody can say whether they were false.", "",
    ]
    for zone, z in result["zones"].items():
        key, up = z["key"], z["upstream"]
        lines += [f"## {z['name']['en']}", "",
                  f"Key gauge {key['code']}, {key['place']}, bank {key['bank_m']} m. Upstream gauge {up['code']}, {up['place']}, "
                  f"bank {up['bank_m']} m. Rain basin `{z['rain_basin']}`. Gauge record from "
                  f"{local(z['gauge_from'])[:11] if z['gauge_from'] is not None else 'none'}; seasons judged: "
                  f"{', '.join(map(str, z['seasons_with_gauge'])) or 'none'}.", ""]
        p = z["proposal"]
        lines += ["### Proposed", "", "| Level | Signal | Threshold | Floods caught | False alarms | Median lead | Shortest lead |", "|---|---|---|---|---|---|---|"]
        for level in ("watch", "warning"):
            row = p[level]
            if row is None:
                lines.append(f"| {level.title()} | – | no candidate catches a flood in time | – | – | – | – |")
            else:
                lines.append(f"| {level.title()} | {TITLES[row['signal']]} | {row['threshold']} | {row['detected']}/{row['floods']} | "
                             f"{row['false_alarms']} of {row['hits'] + row['false_alarms']} judged alarms | {row['median_lead_h']} h | {row['shortest_lead_h']} h |")
        lines += [f"| Evacuate | {TITLES['key_level_m']} | {p['evacuate']['threshold']} | by definition | – | 0 h | 0 h |", ""]
        lines += ["### Floods the gauge recorded", "", "| Season | Over the bank from | Highest | At | Hours over | Upstream gauge's highest, and when |", "|---|---|---|---|---|---|"]
        for f in z["floods"]:
            upk = f["upstream_peak"]
            lines.append(f"| {f['season']} | {local(f['onset'])} | {f['peak_m']} m | {local(f['peak_at'])} | {f['hours_over']} | "
                         + ("–" if upk is None else f"{upk['m']} m, {local(upk['at'])}") + " |")
        lines.append("")
        if z["floods"]:
            lines += ["### The signals before each flood", ""]
            for name in ("rain_72h_mm", "rain_24h_mm", "upstream_level_m", "key_level_m", "key_rise_m", "glofas_cms"):
                rows = [(f, f["before"].get(name)) for f in z["floods"] if f["before"].get(name)]
                if not rows:
                    continue
                lines += [f"**{TITLES[name]}**", "", "| Flood began | " + " | ".join(f"{h} h before" for h in z["leads_h"]) + " |",
                          "|---|" + "---|" * len(z["leads_h"])]
                for f, b in rows:
                    lines.append(f"| {local(f['onset'])} | " + " | ".join("–" if b[h] is None else str(b[h]) for h in z["leads_h"]) + " |")
                lines.append("")
        lines += ["### Every candidate, scored", ""]
        for name, rows in z["scored"].items():
            if not rows:
                continue
            lines += [f"**{TITLES[name]}**", "",
                      "| Threshold | Floods caught | Alarms | Hits | False | Unjudged | POD | FAR | CSI | Median lead h | Shortest lead h |",
                      "|---|---|---|---|---|---|---|---|---|---|---|"]
            lines += [_row(r) for r in rows]
            lines.append("")
        if z["timeline"]:
            lines += ["### What the news and the irrigation department's summaries say", "",
                      "| Event | District | Onset | Peak | Receded | Confidence |", "|---|---|---|---|---|---|"]
            for e in z["timeline"]:
                lines.append(f"| {e['event']} | {e['district']} | {e['flood_onset'] or '–'} | {e['peak'] or '–'} | {e['receded'] or '–'} | {e['confidence']} |")
            lines.append("")
    return "\n".join(lines) + "\n"


def thresholds_yaml(result: dict, cfg: dict) -> str:
    """One entry per zone and signal, shaped like the `thresholds` table: {zone, signal, levels}."""
    rows = []
    for zone, z in result["zones"].items():
        p = z["proposal"]
        by_signal: dict[str, dict] = {}
        for level in ("watch", "warning", "evacuate"):
            row = p[level]
            if row is not None:
                by_signal.setdefault(row["signal"], {})[level] = row["threshold"]
        for signal, levels in by_signal.items():
            gauge_ = z["upstream"] if signal == "upstream_level_m" else z["key"] if signal == "key_level_m" else None
            rows.append({"zone": zone, "signal": signal, "levels": levels, "provisional": True,
                         **({"station": gauge_["code"], "station_id": gauge_["id"]} if gauge_ else {"basin": z["rain_basin"]})})
    head = ("# Provisional thresholds from the hindcast (pipeline/thresholds). Generated; do not edit by hand.\n"
            "# They suggest a level to an admin and never publish one. See out/thresholds/report.md for\n"
            "# how each was scored and how few floods stand behind it.\n")
    return head + yaml.safe_dump({"provisional": True, "built": result["built"], "thresholds": rows}, sort_keys=False, allow_unicode=True)


def summary(result: dict) -> str:
    out = []
    for zone, z in result["zones"].items():
        out.append(f"{zone}: {len(z['floods'])} floods in seasons {z['seasons_with_gauge']}")
        for level in ("watch", "warning"):
            row = z["proposal"][level]
            out.append(f"  {level:8} " + ("none" if row is None else
                       f"{row['signal']} >= {row['threshold']}: caught {row['detected']}/{row['floods']}, CSI {row['csi']}, false {row['false_alarms']}, "
                       f"unjudged {row['unjudged_alarms']}, median lead {row['median_lead_h']} h, shortest {row['shortest_lead_h']} h"))
    return "\n".join(out)
