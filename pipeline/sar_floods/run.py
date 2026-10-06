"""One event from scene list to started export tasks. The Earth Engine calls are in ee_ops."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import shape

from . import aoi as aoi_module
from . import ee_ops, grid, naming, plan, runlog, seasons, settings, threshold

log = logging.getLogger("sar_floods")


def _thresholds_for_pass(cfg: dict, cache_dir: Path, p: plan.Pass, compute) -> dict[str, dict[int, threshold.Decision]]:
    """Per polarisation and tile, the threshold decision for one pass.

    Decisions are cached per parameter hash and pass, so a pass shared by a season and a priority
    event gets identical thresholds, and a rerun does not ask Earth Engine again.
    """
    cache = cache_dir / f"{p.pass_id}.json"
    if cache.exists():
        stored = json.loads(cache.read_text(encoding="utf-8"))
        return {pol: {int(i): threshold.Decision(**d) for i, d in tiles.items()} for pol, tiles in stored.items()}
    histograms = compute()
    decisions: dict[str, dict[int, threshold.Decision]] = {pol: {} for pol in cfg["sentinel1"]["polarisations"]}
    for tile, per_pol in histograms.items():
        for pol, counts in per_pol.items():
            decisions[pol][tile] = threshold.decide_from_config(counts, cfg, pol)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({pol: {str(i): d.as_dict() for i, d in tiles.items()}
                                 for pol, tiles in decisions.items()}), encoding="utf-8")
    return decisions


def _orbit_reference(cfg: dict, project: str, orbit: str, entry: dict, years: list[int], scale: int,
                     params_hash: str, stored: set[str], masks: dict, area):
    """(reference backscatter, layover mask) for one orbit: the stored asset if `prepare` made one for
    these parameters, else computed inside every request. `entry` (the run log's record) says which."""
    name = naming.reference_name(years, orbit, scale, params_hash)
    if name in stored:
        entry["source"] = f"{ee_ops.asset_folder_id(project, cfg)}/{name}"
        log.info("orbit %s: stored reference %s", orbit, name)
        return ee_ops.load_reference_asset(cfg, entry["source"])
    backscatter, angle = ee_ops.reference(cfg, entry["scenes"])
    towards_radar = ee_ops.look_direction(cfg, entry["scenes"], area)
    entry["source"] = "computed"
    entry["towards_radar_deg"] = round(towards_radar, 2)
    log.info("orbit %s: reference computed in each request; towards the radar %.1f deg", orbit, towards_radar)
    return backscatter, ee_ops.layover_shadow(angle, towards_radar, masks, cfg)


def prepare_references(cfg: dict, event: seasons.Event, *, dry_run: bool, force: bool = False,
                       command: str = "", now: datetime | None = None) -> runlog.RunLog:
    """Start one asset export per orbit of the event: the dry reference and the layover mask.

    They are the same for every pass of an orbit, and were about 60 % of each pass's compute
    (METHODS.md, "Compute used"). Orbits whose reference is too thin are left out, as in `run`.
    """
    now = now or datetime.now(timezone.utc)
    paths = settings.output_paths(cfg)
    project = settings.ee_project()
    geometry = aoi_module.load()
    aoi_sha = settings.aoi_sha256()
    params_hash = settings.params_hash(cfg, aoi_sha)
    ee_version = ee_ops.init(project)
    rl = runlog.RunLog.start(paths.runs, event=event, cfg=cfg, params_hash=params_hash, aoi_sha256=aoi_sha,
                             project=project, dry_run=dry_run, command=command, now=now, ee_version=ee_version)
    rl.data["purpose"] = "reference assets"
    ex = cfg["export"]
    master = grid.master_grid(aoi_module.bounds(geometry), ex["crs"], ex["scale_m"], ex["snap_m"])
    rl.data["grid"] = master.as_dict()

    area = ee_ops.area(geometry)
    windows = seasons.reference_windows(event, cfg)
    scenes = []
    for a, b in windows:
        scenes += [plan.scene_from_feature(f)
                   for f in ee_ops.list_scenes(ee_ops.s1_collection(cfg, area, *seasons.utc_millis(a, b)))]
    reference = plan.reference_by_orbit(scenes)
    rl.data["reference"] = {"windows": [[a.isoformat(), b.isoformat()] for a, b in windows], "orbits": reference}
    years = [a.year for a, _ in windows]
    stored = set() if force else ee_ops.reference_assets(project, cfg)
    done = {} if force else runlog.already_exported(paths.runs)
    folder = ee_ops.asset_folder_id(project, cfg)

    todo = []
    for orbit, entry in reference.items():
        name = naming.reference_name(years, orbit, master.scale, params_hash)
        rec = {"name": name, "kind": "reference", "orbit": orbit, "asset_id": f"{folder}/{name}",
               "task_id": None, "state": "PLANNED"}
        if entry["passes"] < cfg["reference"]["min_passes"]:
            rec["state"] = "SKIPPED_THIN_REFERENCE"
            rl.warn(f"orbit {orbit}: reference has {entry['passes']} passes, needs {cfg['reference']['min_passes']}")
        elif name in stored:
            rec["state"] = "SKIPPED_ASSET_EXISTS"
        elif name in done:
            rec["state"] = "SKIPPED_ALREADY_EXPORTED"
            rec["previous"] = done[name]
        else:
            todo.append((entry, rec))
        rl.data["exports"].append(rec)
        log.info("reference %s: %d passes, %d scenes, %s", name, entry["passes"], len(entry["scenes"]),
                 rec["state"].lower())
    rl.save()
    if dry_run or not todo:
        rl.finish(datetime.now(timezone.utc))
        return rl

    ee_ops.ensure_asset_folder(project, cfg)
    masks = ee_ops.static_masks(cfg)
    for entry, rec in todo:
        backscatter, angle = ee_ops.reference(cfg, entry["scenes"])
        towards_radar = ee_ops.look_direction(cfg, entry["scenes"], area)
        entry["towards_radar_deg"] = round(towards_radar, 2)
        image = ee_ops.reference_asset_image(
            cfg, backscatter, ee_ops.layover_shadow(angle, towards_radar, masks, cfg), area)
        task = ee_ops.reference_export_task(image, rec["name"], rec["asset_id"], master, cfg)
        task.start()
        rec.update(task_id=task.id, state="SUBMITTED")
        log.info("started %s (task %s), towards the radar %.1f deg", rec["name"], task.id, towards_radar)
        rl.save()
    rl.finish(datetime.now(timezone.utc))
    return rl


def run_event(cfg: dict, event: seasons.Event, *, dry_run: bool, with_thresholds: bool = False,
              force: bool = False, command: str = "", now: datetime | None = None) -> runlog.RunLog:
    """Plan one event and, unless dry_run, start its exports. Always writes a run log.

    dry_run                     list scenes and planned exports; two small metadata requests, no tasks
    dry_run + with_thresholds   also fetch the tile histograms and log every threshold; still no tasks
    """
    now = now or datetime.now(timezone.utc)
    paths = settings.output_paths(cfg)
    project = settings.ee_project()
    geometry = aoi_module.load()
    aoi_sha = settings.aoi_sha256()
    params_hash = settings.params_hash(cfg, aoi_sha)
    ee_version = ee_ops.init(project)

    rl = runlog.RunLog.start(paths.runs, event=event, cfg=cfg, params_hash=params_hash, aoi_sha256=aoi_sha,
                             project=project, dry_run=dry_run, command=command, now=now, ee_version=ee_version)
    ex = cfg["export"]
    area_bounds = aoi_module.bounds(geometry)
    master = grid.master_grid(area_bounds, ex["crs"], ex["scale_m"], ex["snap_m"])
    lattice = grid.tile_lattice(area_bounds, cfg["threshold"]["tile_size_deg"])
    tiles = grid.tiles_in_area(lattice, shape(geometry))
    rl.data["grid"] = master.as_dict()
    rl.data["tiles"] = {**lattice.as_dict(), "in_area": len(tiles)}
    log.info("%s: %s to %s (Bangkok), parameters %s, grid %s px at %d m",
             event.id, event.start, event.end, params_hash, master.dimensions, master.scale)

    # 1. Scenes of the event and of its dry reference (metadata only).
    area = ee_ops.area(geometry)
    start_ms, end_ms = seasons.utc_millis(event.start, event.end)
    passes = plan.group_passes([plan.scene_from_feature(f)
                                for f in ee_ops.list_scenes(ee_ops.s1_collection(cfg, area, start_ms, end_ms))])
    windows = seasons.reference_windows(event, cfg)
    ref_scenes = []
    for a, b in windows:
        ref_scenes += [plan.scene_from_feature(f)
                       for f in ee_ops.list_scenes(ee_ops.s1_collection(cfg, area, *seasons.utc_millis(a, b)))]
    reference = plan.reference_by_orbit(ref_scenes)
    plan.apply_reference_rule(passes, reference, cfg["reference"]["min_passes"])
    rl.data["reference"] = {"windows": [[a.isoformat(), b.isoformat()] for a, b in windows], "orbits": reference}
    rl.data["passes"] = [p.as_dict() for p in passes]

    for orbit, r in reference.items():
        log.info("reference %s: %d passes, %d scenes", orbit, r["passes"], len(r["scenes"]))
    for p in passes:
        log.info("pass %s: %d scenes, %s", p.pass_id, len(p.scenes),
                 p.status if p.status == "used" else f"SKIPPED ({p.skip_reason})")
        if p.status == "skipped":
            rl.warn(f"pass {p.pass_id} skipped: {p.skip_reason}")
    used = [p for p in passes if p.status == "used"]
    if not used:
        rl.warn("no usable passes in this event")
        log.warning("%s: no usable passes; nothing to export", event.id)

    # 2. Planned exports.
    exports = plan.planned_exports(event, passes, master, params_hash)
    done = {} if force else runlog.already_exported(paths.runs)
    records = []
    for e in exports:
        rec = {**e.as_dict(), "drive_folder": ex["drive_folder"], "task_id": None, "state": "PLANNED"}
        if e.name in done:
            rec["state"] = "SKIPPED_ALREADY_EXPORTED"
            rec["previous"] = done[e.name]
        records.append(rec)
        log.info("export %s: %s px, %s", e.name, e.grid.dimensions, rec["state"].lower())
    rl.data["exports"] = records
    log.info("%d passes used, %d skipped; %d exports planned, %.2f billion pixels in total",
             len(used), len(passes) - len(used), len(exports), sum(e.grid.pixels for e in exports) / 1e9)
    rl.save()
    if (dry_run and not with_thresholds) or not used:
        rl.finish(datetime.now(timezone.utc))
        return rl

    # 3. Thresholds: one histogram request per pass, decided locally (threshold.py).
    masks = ee_ops.static_masks(cfg)
    tile_index = ee_ops.tile_index_image(lattice)
    stored = ee_ops.reference_assets(project, cfg)
    years = [a.year for a, _ in windows]
    ref_images, layover = {}, {}
    per_pass = {}
    for p in used:
        if p.orbit not in ref_images:
            ref_images[p.orbit], layover[p.orbit] = _orbit_reference(
                cfg, project, p.orbit, reference[p.orbit], years, master.scale, params_hash, stored, masks, area)
        change = ee_ops.change_image(cfg, p, ref_images[p.orbit])
        observed, valid = ee_ops.validity(change, masks, layover[p.orbit])
        decisions = _thresholds_for_pass(
            cfg, paths.thresholds(params_hash), p,
            lambda: ee_ops.tile_histograms(cfg, change, valid, area, lattice, tiles))
        p.thresholds = {pol: {"summary": threshold.summarise(d),
                              "tiles": {str(i): x.as_dict() for i, x in sorted(d.items())}}
                        for pol, d in decisions.items()}
        for pol, t in p.thresholds.items():
            log.info("thresholds %s %s: %s", p.pass_id, pol, t["summary"])
        per_pass[p.pass_id] = {"change": change, "observed": observed, "valid": valid, "decisions": decisions}
        rl.data["passes"] = [q.as_dict() for q in passes]
        rl.save()
    if dry_run:
        rl.finish(datetime.now(timezone.utc))
        return rl

    # 4. Build the products and start the tasks.
    for pid, x in per_pass.items():
        x["flood"] = ee_ops.classify(cfg, x["change"], x["valid"], tile_index, x["decisions"])
    by_id = {p.pass_id: p for p in used}
    for e, rec in zip(exports, records):
        if rec["state"] != "PLANNED":
            continue
        if e.kind == "scene":
            x = per_pass[e.pass_id]
            image = ee_ops.scene_product(x["flood"], x["observed"], x["valid"], masks,
                                         layover[by_id[e.pass_id].orbit], area)
        else:
            image = ee_ops.event_product(cfg, list(per_pass.values()), masks, area)
        task = ee_ops.export_task(image, e, cfg)
        task.start()
        rec.update(task_id=task.id, state="SUBMITTED")
        log.info("started %s (task %s)", e.name, task.id)
        rl.save()
    rl.finish(datetime.now(timezone.utc))
    return rl


def update_status(rl: runlog.RunLog) -> dict[str, int]:
    """Refresh task states and EECU-seconds in a run log. Returns a count per state."""
    ee_ops.init(settings.ee_project())
    status = ee_ops.task_status(rl.task_ids()) if rl.task_ids() else {}
    counts: dict[str, int] = {}
    total = 0.0
    for e in rl.data["exports"]:
        s = status.get(e.get("task_id"))
        if s:
            e["state"] = s.pop("state", e["state"])
            e["task"] = s
            total += float(s.get("batch_eecu_usage_seconds", 0) or 0)
        counts[e["state"]] = counts.get(e["state"], 0) + 1
    rl.data["eecu_seconds_total"] = round(total, 1)
    rl.save()
    return counts
