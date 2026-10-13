"""Command line: `uv run python -m seasonal_outlook <command>` from the pipeline folder.

Commands
  fetch      five-day rain totals (CHIRPS pentads, October to January, 1981 on) averaged over each
             province and the four together, from Earth Engine (small interactive requests, no
             export task), and NOAA's ENSO index -> <output_dir>/pentads.json, oni.txt
  history    what the past seasons say -> <output_dir>/history.json: every season's total and
             wettest five and fifteen days, where the last seasons rank, how the season went with
             the Pacific's state three months before, and the trend

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


def cmd_fetch(cfg: dict) -> None:
    import httpx
    import shapely

    from sar_floods import ee_ops, settings as sar_settings
    from sar_floods.aoi import province_geometries

    root = out_dir(cfg)
    agent = cfg["user_agent"].format(contact=env_value("CONTACT_EMAIL") or "")
    r = httpx.get(cfg["oni_url"], headers={"user-agent": agent}, timeout=60, follow_redirects=True)
    r.raise_for_status()
    (root / "oni.txt").write_text(r.text, encoding="utf-8")

    ee_ops.init(sar_settings.ee_project())
    ee = ee_ops.ee()
    shapes = province_geometries(list(cfg["provinces"]))
    shapes["all"] = shapely.union_all(list(shapes.values()))
    regions = ee.FeatureCollection([
        ee.Feature(ee.Geometry(shapely.geometry.mapping(g.simplify(cfg["simplify_deg"]))), {"area": code})
        for code, g in shapes.items()])
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


def cmd_history(cfg: dict) -> None:
    root = out_dir(cfg)
    rows = json.loads((root / "pentads.json").read_text(encoding="utf-8"))
    oni = history.parse_oni((root / "oni.txt").read_text(encoding="utf-8"))
    label, base = cfg["enso_months"], cfg["baseline"]
    result = {"rain": "CHIRPS five-day totals, area mean", "season": "November to January, named by its first year",
              "enso": f"NOAA ONI, {label} before the season; La Nina at or under -0.5, El Nino at or over 0.5",
              "baseline": base, "areas": {}}
    newest = max(oni, key=lambda k: (k[1], "DJF JFM FMA MAM AMJ MJJ JJA JAS ASO SON OND NDJ".split().index(k[0])))
    result["latest_oni"] = {"months": newest[0], "year": newest[1], "value": oni[newest],
                            "phase": history.phase(oni[newest])}
    for area in ["all", *cfg["provinces"]]:
        seas = history.seasons([r for r in rows if r["area"] == area])
        full = [{"season": s, **v, "oni": oni.get((label, s)), "phase": history.phase(oni.get((label, s)))}
                for s, v in seas.items() if v["complete"]]
        ref = [r for r in full if base[0] <= r["season"] <= base[1]]
        entry = {"seasons": full, "incomplete": {s: v for s, v in seas.items() if not v["complete"]}}
        for key in ("total_mm", "peak_5d_mm", "peak_15d_mm"):
            lo, hi = history.terciles([r[key] for r in ref])
            known = [r for r in full if r["phase"]]
            entry[key] = {
                "mean": round(sum(r[key] for r in ref) / len(ref), 1), "dry_third_under": round(lo, 1),
                "wet_third_over": round(hi, 1),
                "top5": [(r["season"], r[key]) for r in sorted(full, key=lambda r: -r[key])[:5]],
                "rank": {str(r["season"]): history.rank_of(r[key], [x[key] for x in full])
                         for r in full if r["season"] >= cfg["rank_from"]},
                "of": len(full),
                "by_enso": history.by_phase(known, key, hi, lo),
                "with_oni": history.association([r["oni"] for r in known], [r[key] for r in known]),
                "trend": history.trend([r["season"] for r in full], [r[key] for r in full]),
            }
        result["areas"][area] = entry
    (root / "history.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="seasonal_outlook", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["fetch", "history"])
    args = parser.parse_args(argv)
    cfg = load_config()
    {"fetch": cmd_fetch, "history": cmd_history}[args.command](cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
