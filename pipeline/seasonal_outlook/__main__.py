"""Command line: `uv run python -m seasonal_outlook <command>` from the pipeline folder.

Commands
  fetch      five-day rain totals (CHIRPS pentads, October to January, 1981 on) averaged over each
             province and the four together, from Earth Engine (small interactive requests, no
             export task), and NOAA's ENSO index -> <output_dir>/pentads.json, oni.txt
  fetch --source era5
             the same from ERA5-Land daily rain (ECMWF reanalysis), summed to the same five days
             -> <output_dir>/pentads_era5.json
  gauges     the same from the ThaiWater rain gauges in pipeline/data (seasons 2017 on)
             -> <output_dir>/pentads_gauges.json
  history [--source chirps|era5|gauges]
             what the past seasons say -> <output_dir>/history[_<source>].json: every season's
             total and wettest five and fifteen days, where the last seasons rank, how the season
             went with the Pacific's state three months before, and the trend
  models     the seasonal forecast models (NMME, NOAA CPC; free, no account): download each model's
             forecast made in October for November to January, 1991 on and this year, score it
             against what the seasons brought, beside "always normal" and "the Pacific alone",
             and say what each one says about this season -> <output_dir>/models.json
  outlook [--issued YYYY-MM-DD]
             the outlook for this season from `history` and `models`: one row per method and a
             summary, for the admins' signal dashboard -> <output_dir>/outlook.json and
             supabase/seed/60_seasonal_outlook.sql
  sources    the records side by side: do they agree on which seasons were wet, on the bursts, on
             the trend? -> <output_dir>/sources.json

Settings: seasonal_outlook/config.yaml. Outputs are local (ignored by git).
This is the evidence for an outlook, not an outlook: see METHODS.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from ingest_thaiwater.settings import PIPELINE_DIR, env_value

from . import history

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def out_dir(cfg: dict) -> Path:
    root = (PIPELINE_DIR / str(cfg["output_dir"])).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def pentads_file(cfg: dict, source: str) -> Path:
    return out_dir(cfg) / ("pentads.json" if source == "chirps" else f"pentads_{source}.json")


def regions_ee(cfg: dict):
    import shapely

    from sar_floods import ee_ops
    from sar_floods.aoi import province_geometries

    ee = ee_ops.ee()
    shapes = province_geometries(list(cfg["provinces"]))
    shapes["all"] = shapely.union_all(list(shapes.values()))
    return ee.FeatureCollection([
        ee.Feature(ee.Geometry(shapely.geometry.mapping(g.simplify(cfg["simplify_deg"]))), {"area": code})
        for code, g in shapes.items()])


def fetch_era5(cfg: dict) -> None:
    from sar_floods import ee_ops, settings as sar_settings

    from . import sources

    ee_ops.init(sar_settings.ee_project())
    ee = ee_ops.ee()
    regions = regions_ee(cfg)
    e = cfg["era5"]
    daily = []
    for year in range(cfg["first_season"], cfg["last_year"] + 1):
        col = (ee.ImageCollection(e["collection"]).select(e["band"])
               .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
               .filter(ee.Filter.calendarRange(10, 1, "month")))

        def per_image(img):
            date = img.date()
            stats = img.multiply(1000).reduceRegions(regions, ee.Reducer.mean(), e["scale_m"])
            return stats.map(lambda f: ee.Feature(None, {
                "area": f.get("area"), "mm": f.get("mean"), "year": date.get("year"), "month": date.get("month"),
                "day": date.get("day")}))

        got = ee.FeatureCollection(col.map(per_image)).flatten().getInfo()["features"]
        daily += [f["properties"] for f in got]
        print(f"{year}: {len(got)} values")
    rows = sources.to_pentads(daily)
    pentads_file(cfg, "era5").write_text(json.dumps(rows), encoding="utf-8")
    print(f"{len(rows)} five-day totals -> pentads_era5.json")


def cmd_gauges(cfg: dict) -> None:
    import pandas as pd

    from ingest_thaiwater.settings import data_dir

    from . import sources

    root = data_dir()
    stations = pd.read_csv(root / "stations.csv")
    stations = stations[stations["province_code"].astype(str).isin(cfg["provinces"])]
    by_id = dict(zip(stations["station_id"].astype(int), stations["province_code"].astype(str)))
    files = [p for p in (root / "tidy" / "rain_daily").glob("*/*.parquet")
             if int(p.parent.name) in by_id and int(p.stem[5:7]) in (10, 11, 12, 1)]
    frames = (pd.read_parquet(p, columns=["station_id", "ts", "value"]) for p in files)
    rows = sources.to_pentads(sources.gauge_daily(frames, by_id, cfg["gauges_min_stations"]))
    pentads_file(cfg, "gauges").write_text(json.dumps(rows), encoding="utf-8")
    print(f"{len(files)} station-months, {len(by_id)} stations -> {len(rows)} five-day totals")


def cmd_fetch(cfg: dict, source: str = "chirps") -> None:
    if source == "era5":
        fetch_era5(cfg)
        return
    import httpx

    from sar_floods import ee_ops, settings as sar_settings

    root = out_dir(cfg)
    agent = cfg["user_agent"].format(contact=env_value("CONTACT_EMAIL") or "")
    r = httpx.get(cfg["oni_url"], headers={"user-agent": agent}, timeout=60, follow_redirects=True)
    r.raise_for_status()
    (root / "oni.txt").write_text(r.text, encoding="utf-8")

    ee_ops.init(sar_settings.ee_project())
    ee = ee_ops.ee()
    regions = regions_ee(cfg)
    first, last = cfg["first_season"], cfg["last_year"]
    rows = []
    for start in range(first, last + 1, cfg["years_per_request"]):
        end = min(start + cfg["years_per_request"], last + 1)
        col = (ee.ImageCollection(cfg["chirps_pentad"])
               .filterDate(f"{start}-01-01", f"{end}-01-01")
               .filter(ee.Filter.calendarRange(10, 1, "month")))

        def per_image(img):
            date = img.date()
            stats = img.reduceRegions(regions, ee.Reducer.mean(), cfg["scale_m"])
            return stats.map(lambda f: ee.Feature(None, {
                "area": f.get("area"), "mm": f.get("mean"), "year": date.get("year"), "month": date.get("month"),
                "day": date.get("day")}))

        got = ee.FeatureCollection(col.map(per_image)).flatten().getInfo()["features"]
        for f in got:
            p = f["properties"]
            rows.append({"area": p["area"], "year": p["year"], "month": p["month"],
                         "pentad": (p["day"] - 1) // 5, "mm": p.get("mm")})
        print(f"{start}-{end - 1}: {len(got)} values")
    (root / "pentads.json").write_text(json.dumps(rows), encoding="utf-8")
    print(f"{len(rows)} five-day totals -> {root.name}/pentads.json")


def analyse(cfg: dict, source: str) -> dict:
    root = out_dir(cfg)
    rows = json.loads(pentads_file(cfg, source).read_text(encoding="utf-8"))
    oni = history.parse_oni((root / "oni.txt").read_text(encoding="utf-8"))
    label, base = cfg["enso_months"], cfg["baseline"]
    result = {"rain": {"chirps": "CHIRPS five-day totals, area mean", "era5": "ERA5-Land daily rain summed to five days, area mean",
                       "gauges": "ThaiWater rain gauges, mean of the reporting stations, summed to five days"}[source], "season": "November to January, named by its first year",
              "enso": f"NOAA ONI, {label} before the season; La Nina at or under -0.5, El Nino at or over 0.5",
              "baseline": base, "areas": {}}
    newest = max(oni, key=lambda k: (k[1], "DJF JFM FMA MAM AMJ MJJ JJA JAS ASO SON OND NDJ".split().index(k[0])))
    result["latest_oni"] = {"months": newest[0], "year": newest[1], "value": oni[newest],
                            "phase": history.phase(oni[newest])}
    for area in ["all", *cfg["provinces"]]:
        seas = history.seasons([r for r in rows if r["area"] == area])
        full = [{"season": s, **v, "oni": oni.get((label, s)), "phase": history.phase(oni.get((label, s)))}
                for s, v in seas.items() if v["complete"]]
        ref = [r for r in full if base[0] <= r["season"] <= base[1]] or full
        entry = {"seasons": full, "incomplete": {s: v for s, v in seas.items() if not v["complete"]}}
        for key in ("total_mm", "peak_5d_mm", "peak_15d_mm"):
            lo, hi = history.terciles([r[key] for r in ref])
            known = [r for r in full if r["phase"]]
            if len(known) < 8:
                known = []
            entry[key] = {
                "mean": round(sum(r[key] for r in ref) / len(ref), 1), "dry_third_under": round(lo, 1),
                "wet_third_over": round(hi, 1),
                "top5": [(r["season"], r[key]) for r in sorted(full, key=lambda r: -r[key])[:5]],
                "rank": {str(r["season"]): history.rank_of(r[key], [x[key] for x in full])
                         for r in full if r["season"] >= cfg["rank_from"]},
                "of": len(full),
                "by_enso": history.by_phase(known, key, hi, lo) if known else None,
                "with_oni": history.association([r["oni"] for r in known], [r[key] for r in known]) if known else None,
                "trend": history.trend([r["season"] for r in full], [r[key] for r in full]) if len(full) >= 15 else None,
            }
        result["areas"][area] = entry
    return result


def cmd_history(cfg: dict, source: str = "chirps") -> None:
    root = out_dir(cfg)
    result = analyse(cfg, source)
    name = "history.json" if source == "chirps" else f"history_{source}.json"
    (root / name).write_text(json.dumps(result, indent=1), encoding="utf-8")
    a = result["areas"]["all"]
    print("latest ONI:", result["latest_oni"])
    for key in ("total_mm", "peak_5d_mm", "peak_15d_mm"):
        e = a[key]
        print(f"\n{key}: mean {e['mean']}, wet third over {e['wet_third_over']}, dry third under {e['dry_third_under']}")
        print("  top 5:", e["top5"])
        print("  rank of recent seasons (of", e["of"], "):", e["rank"])
        print("  by ENSO:", e["by_enso"])
        print("  with ONI:", e["with_oni"])
        print("  trend per decade:", e["trend"])
    print("\nincomplete:", a["incomplete"])


def cmd_sources(cfg: dict) -> None:
    from . import sources

    root = out_dir(cfg)
    # The gauge archive is left out: its "daily" values behave as running multi-day totals (METHODS.md).
    got = {s: analyse(cfg, s) for s in ("chirps", "era5") if pentads_file(cfg, s).exists()}
    out = {"records": list(got), "areas": {}}
    for area in ["all", *cfg["provinces"]]:
        entry = {}
        for key in ("total_mm", "peak_5d_mm", "peak_15d_mm"):
            val = {s: {r["season"]: r[key] for r in g["areas"][area]["seasons"]} for s, g in got.items()}
            pairs = {f"{a}_vs_{b}": sources.agreement(val[a], val[b])
                     for i, a in enumerate(val) for b in list(val)[i + 1:]}
            entry[key] = {"agreement": pairs,
                          "rank": {s: g["areas"][area][key]["rank"] for s, g in got.items()},
                          "of": {s: g["areas"][area][key]["of"] for s, g in got.items()},
                          "with_oni": {s: g["areas"][area][key]["with_oni"] for s, g in got.items()},
                          "trend": {s: g["areas"][area][key]["trend"] for s, g in got.items()},
                          "top5": {s: g["areas"][area][key]["top5"] for s, g in got.items()}}
        out["areas"][area] = entry
    (root / "sources.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    for key, e in out["areas"]["all"].items():
        print(f"\n== {key}")
        for k, v in e.items():
            print(f"  {k}: {v}")


def cmd_models(cfg: dict) -> None:
    import httpx

    from . import models

    m = cfg["models"]
    root = out_dir(cfg)
    folder = root / "nmme"
    folder.mkdir(exist_ok=True)
    agent = cfg["user_agent"].format(contact=env_value("CONTACT_EMAIL") or "")
    oni = history.parse_oni((root / "oni.txt").read_text(encoding="utf-8"))
    observed_mm = {src: {r["season"]: r["total_mm"] for r in analyse(cfg, src)["areas"]["all"]["seasons"]}
                   for src in ("chirps", "era5") if pentads_file(cfg, src).exists()}
    result = {"box": {"lons": m["lons"], "lats": m["lats"]}, "observed": list(observed_mm), "methods": {},
              "note": "Forecast made at the start of October for November to January. Thirds left one out."}
    with httpx.Client(headers={"user-agent": agent}, timeout=600, follow_redirects=True) as client:
        def text(kind: str, name: str) -> str:
            path = folder / name
            if not path.exists():
                r = client.get(f"{m['base_url']}/{m[kind + '_dir']}/{name}")
                r.raise_for_status()
                path.write_text(r.text, encoding="utf-8")
            return path.read_text(encoding="utf-8")

        series, now = {}, {}
        for model in m["names"]:
            series[model] = models.read_cpt(text("hindcast", m["hindcast_file"].format(model=model)), m["lons"], m["lats"])
            got = models.read_cpt(text("forecast", m["forecast_file"].format(model=model)), m["lons"], m["lats"])
            now[model] = got.get(cfg["last_year"])
    for src, obs_mm in observed_mm.items():
        seasons = sorted(set.intersection(*[set(v) for v in series.values()]) & set(obs_mm))
        observed = models.leave_one_out(obs_mm, seasons)
        block = {"seasons": [seasons[0], seasons[-1]], "always_normal": models.score({s: models.NORMAL for s in seasons}, observed)}
        enso = {s: models.enso_lean(oni.get((cfg["enso_months"], s))) for s in seasons}
        enso = {s: v for s, v in enso.items() if v is not None}
        block["pacific_alone"] = models.score(enso, observed)
        this_enso = models.enso_lean(oni.get((cfg["enso_months"], cfg["last_year"])))
        block["pacific_alone"]["this_season"] = models.odds(this_enso, enso, observed) if this_enso is not None else None
        for model, ser in series.items():
            fc = models.leave_one_out(ser, seasons)
            entry = models.score(fc, observed)
            entry["spearman"] = history.association([ser[s] for s in seasons], [obs_mm[s] for s in seasons], 2000)["spearman"]
            if now[model] is not None:
                lean = models.third_of(now[model], [ser[s] for s in seasons])
                entry["this_season"] = {"mm_per_day": round(now[model], 2),
                                        "hindcast_mean": round(float(sum(ser[s] for s in seasons) / len(seasons)), 2),
                                        **models.odds(lean, fc, observed)}
            block[model] = entry
        result["methods"][src] = block
    (root / "models.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    for src, block in result["methods"].items():
        print(f"\n== scored against {src}, seasons {block['seasons']}")
        for k, v in block.items():
            if k == "seasons":
                continue
            line = f"  {k:12} hit {v['hit_rate_pct']}%  heidke {v['heidke']}"
            if "spearman" in v:
                line += f"  spearman {v['spearman']}"
            if v.get("this_season"):
                t = v["this_season"]
                line += f"  | this season: {t['lean']} {t.get('mm_per_day', '')} odds {t['odds_pct']} from {t['past_seasons_with_this_lean']} seasons"
            print(line)


def cmd_outlook(cfg: dict, issued: str | None) -> None:
    from datetime import date

    from ingest_thaiwater.settings import REPO_DIR

    from . import models as model_mod, outlook

    root = out_dir(cfg)
    season = cfg["last_year"]
    issued = issued or date.today().isoformat()
    scored = json.loads((root / "models.json").read_text(encoding="utf-8"))["methods"]
    records = list(scored)
    oni = history.parse_oni((root / "oni.txt").read_text(encoding="utf-8"))
    now_oni = oni.get((cfg["enso_months"], season))
    phase = history.phase(now_oni)
    hist = {src: analyse(cfg, src)["areas"]["all"]["total_mm"] for src in records}
    rows = []

    def avg(key, method):
        vals = [scored[src][method][key] for src in records]
        return round(sum(vals) / len(vals), 1)

    # The Pacific alone: odds from the whole record, hit rate from the seasons the models were scored on.
    pac_lean = {"la_nina": "wet", "el_nino": "dry", "neutral": "normal"}[phase] if phase else "none"
    pac_usable = all(scored[src]["pacific_alone"]["hit_rate_pct"] > scored[src]["always_normal"]["hit_rate_pct"]
                     for src in records)
    pac_odds = outlook.mean_odds([outlook.enso_odds(hist[src]["by_enso"], phase) for src in records]) if phase else None
    rows.append({"method": "pacific", "lean": pac_lean, "odds": pac_odds,
                 "past_hit_pct": avg("hit_rate_pct", "pacific_alone"),
                 "chance_hit_pct": avg("hit_rate_pct", "always_normal"),
                 "past_seasons": scored[records[0]]["pacific_alone"]["seasons"], "usable": pac_usable,
                 "note": (f"ENSO index {cfg['enso_months']} {season}: {now_oni:+.2f} ({phase.replace('_', ' ')}). "
                          f"Odds from {hist[records[0]]['by_enso'][phase]['seasons']} past seasons after such a Pacific."),
                 "details": {"oni": now_oni, "by_enso": {src: hist[src]["by_enso"] for src in records}}})

    m = cfg["models"]
    for model in m["names"]:
        entries = [scored[src][model] for src in records]
        this = entries[0].get("this_season")
        past = list(model_mod.read_cpt((root / "nmme" / m["hindcast_file"].format(model=model)).read_text(encoding="utf-8"),
                                       m["lons"], m["lats"]).values())
        ok_range = this is not None and outlook.in_range(this["mm_per_day"], past)
        ok_skill = all(outlook.beats(scored[src][model], [scored[src]["always_normal"], scored[src]["pacific_alone"]])
                       for src in records)
        reasons = []
        if not ok_range:
            reasons.append("this year's forecast is beyond everything it forecast in its 30 past seasons")
        if not ok_skill:
            reasons.append("in past seasons it did not beat both 'always normal' and the Pacific alone")
        rows.append({"method": model, "lean": this["lean"] if this else "none",
                     "odds": outlook.mean_odds([scored[src][model]["this_season"]["odds_pct"] for src in records]) if this else None,
                     "past_hit_pct": avg("hit_rate_pct", model), "chance_hit_pct": avg("hit_rate_pct", "always_normal"),
                     "past_seasons": entries[0]["seasons"], "usable": ok_range and ok_skill,
                     "note": "Usable." if ok_range and ok_skill else "Not used: " + "; ".join(reasons) + ".",
                     "details": {"mm_per_day": this and this["mm_per_day"], "hindcast_mean": this and this["hindcast_mean"],
                                 "heidke": {src: scored[src][model]["heidke"] for src in records}}})
    lean, note = outlook.summary(rows)
    rows.insert(0, {"method": "summary", "lean": lean, "odds": None, "past_hit_pct": None, "chance_hit_pct": None,
                    "past_seasons": None, "usable": True, "note": note,
                    "details": {"usable_methods": [r["method"] for r in rows if r["usable"]]}})
    (root / "outlook.json").write_text(json.dumps({"season": season, "issued_on": issued, "rows": rows}, indent=1),
                                       encoding="utf-8")

    def lit(v):
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (int, float)):
            return str(v)
        return "'" + str(v).replace("'", "''") + "'"

    values = []
    for r in rows:
        o = r["odds"] or {}
        values.append("  (" + ", ".join([str(season), lit(issued), lit(r["method"]), lit(r["lean"]),
                                         lit(o.get("dry")), lit(o.get("normal")), lit(o.get("wet")),
                                         lit(r["past_hit_pct"]), lit(r["chance_hit_pct"]), lit(r["past_seasons"]),
                                         lit(r["usable"]), lit(r["note"]),
                                         lit(json.dumps(r["details"], ensure_ascii=False)) + "::jsonb"]) + ")")
    sql = ("-- Generated by pipeline/seasonal_outlook (`outlook`). Do not edit by hand.\n"
           "-- The seasonal outlook for the admins (science plan Module 9). Odds for the drier, middle and\n"
           "-- wetter third of past November-January seasons, with each method's past hit rate. Not a flood\n"
           "-- forecast. Rain records: CHIRPS, ERA5-Land; the Pacific: NOAA ONI; models: NOAA CPC NMME.\n\n"
           f"delete from public.seasonal_outlooks where season = {season} and issued_on = {lit(issued)};\n\n"
           "insert into public.seasonal_outlooks (season, issued_on, method, lean, odds_dry, odds_normal, odds_wet,\n"
           "  past_hit_pct, chance_hit_pct, past_seasons, usable, note, details) values\n"
           + ",\n".join(values) + ";\n")
    (REPO_DIR / "supabase" / "seed" / "60_seasonal_outlook.sql").write_text(sql, encoding="utf-8", newline="\n")
    for r in rows:
        print(f"{r['method']:12} {r['lean']:7} odds {r['odds']}  hit {r['past_hit_pct']} vs {r['chance_hit_pct']}  "
              f"usable {r['usable']}  {r['note']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="seasonal_outlook", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["fetch", "gauges", "history", "sources", "models", "outlook"])
    parser.add_argument("--issued", default=None)
    parser.add_argument("--source", choices=["chirps", "era5", "gauges"], default="chirps")
    args = parser.parse_args(argv)
    cfg = load_config()
    if args.command in ("fetch", "history"):
        {"fetch": cmd_fetch, "history": cmd_history}[args.command](cfg, args.source)
    elif args.command == "outlook":
        cmd_outlook(cfg, args.issued)
    else:
        {"gauges": cmd_gauges, "sources": cmd_sources, "models": cmd_models}[args.command](cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
