"""Source rasters for the hazard baseline, exported once from Earth Engine to Google Drive.

  jaga_hazard_fabdem_<bbox>.tif          FABDEM elevation, metres, float32, its own 1 arc-second grid
  jaga_hazard_jrc_occurrence_<bbox>.tif  JRC surface-water occurrence, percent, uint8, same grid

Both are small exports (a few EECU-minutes). Everything after this runs locally.
"""

from __future__ import annotations

from pathlib import Path

from sar_floods import drive, ee_ops

PREFIX = "jaga_hazard_"
ARCSEC = 1 / 3600


def bbox_tag(bbox: list[int]) -> str:
    w, s, e, n = bbox
    return f"e{w:03d}n{s:02d}_e{e:03d}n{n:02d}"


def names(cfg: dict) -> dict[str, str]:
    tag = bbox_tag(cfg["bbox_deg"])
    return {"dem": f"{PREFIX}fabdem_{tag}", "water": f"{PREFIX}jrc_occurrence_{tag}"}


def grid(cfg: dict) -> tuple[list[float], str]:
    """(crsTransform, dimensions) of FABDEM's own 1 arc-second grid over the box. Its cell centres,
    not its cell edges, lie on whole arc-seconds (checked 2026-10-06: tile N04E098 starts at
    97.99986, 5.00014), so the grid starts half a cell west and north of the box."""
    w, s, e, n = cfg["bbox_deg"]
    return ([ARCSEC, 0, w - ARCSEC / 2, 0, -ARCSEC, n + ARCSEC / 2],
            f"{(e - w) * 3600}x{(n - s) * 3600}")


def export_tasks(cfg: dict) -> list:
    """UNSTARTED Drive exports of the DEM and the water occurrence on the same grid."""
    ee = ee_ops.ee()
    transform, dimensions = grid(cfg)
    dem = ee.ImageCollection(cfg["dem"]["asset"]).select(cfg["dem"]["band"]).mosaic().toFloat()
    water = ee.Image(cfg["water"]["asset"]).select(cfg["water"]["band"]).unmask(0).toUint8()
    out = []
    for image, name, nodata in ((dem, names(cfg)["dem"], -9999), (water, names(cfg)["water"], 255)):
        out.append(ee.batch.Export.image.toDrive(
            image=image, description=name, folder=cfg["export"]["drive_folder"], fileNamePrefix=name,
            crs="EPSG:4326", crsTransform=transform, dimensions=dimensions, maxPixels=int(1e9),
            fileFormat="GeoTIFF", formatOptions={"cloudOptimized": True, "noData": nodata}))
    return out


def download(cfg: dict, project: str, dest: Path, dry_run: bool = False) -> list[str]:
    """Fetch the source rasters from Drive (checksums verified). One summary line per file."""
    svc = drive.service(project)
    folder = cfg["export"]["drive_folder"]
    folders = drive._list(svc, f"name = '{folder}' and mimeType = '{drive.FOLDER_MIME}' and trashed = false")
    files = []
    for f in folders:
        files += drive._list(svc, f"'{f['id']}' in parents and trashed = false and name contains '{PREFIX}'")
    latest, duplicated = drive.pick_latest(files)
    lines = [f"WARNING {n}: several files with this name in Drive; using the newest" for n in duplicated]
    for remote in latest:
        size_mb = int(remote["size"]) / 1e6
        if drive.is_current(dest / remote["name"], remote):
            lines.append(f"have      {remote['name']} ({size_mb:.1f} MB)")
        elif dry_run:
            lines.append(f"would get {remote['name']} ({size_mb:.1f} MB)")
        else:
            drive.fetch(svc, remote, dest)
            lines.append(f"got       {remote['name']} ({size_mb:.1f} MB)")
    return lines
