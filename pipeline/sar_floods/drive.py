"""Download the exported GeoTIFFs from Google Drive with the Earth Engine sign-in.

`earthengine authenticate` asks for the Drive scope by default, so no second sign-in is needed.
The Google Drive API must be enabled on the Cloud project (EE_PROJECT), which is also used as the
quota project. NOT YET RUN (no credentials on 2026-10-05); `pick_latest` and the name handling are
covered by the offline tests, the API calls are not.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

from . import naming

log = logging.getLogger("sar_floods")
FOLDER_MIME = "application/vnd.google-apps.folder"
FIELDS = "nextPageToken, files(id, name, size, md5Checksum, modifiedTime)"


def service(project: str):
    """A Drive v3 client using the stored Earth Engine credentials."""
    import ee
    from googleapiclient.discovery import build

    credentials = ee.data.get_persistent_credentials()
    if hasattr(credentials, "with_quota_project"):
        credentials = credentials.with_quota_project(project)
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def _list(svc, query: str) -> list[dict]:
    out, token = [], None
    while True:
        page = svc.files().list(q=query, fields=FIELDS, pageSize=1000, pageToken=token,
                                spaces="drive").execute()
        out += page.get("files", [])
        token = page.get("nextPageToken")
        if not token:
            return out


def list_exports(svc, folder: str) -> list[dict]:
    """Our GeoTIFFs in every Drive folder with the export folder's name (Drive allows duplicates)."""
    name = folder.replace("\\", "\\\\").replace("'", "\\'")
    folders = _list(svc, f"name = '{name}' and mimeType = '{FOLDER_MIME}' and trashed = false")
    files = []
    for f in folders:
        files += _list(svc, f"'{f['id']}' in parents and trashed = false and name contains '{naming.PREFIX}'")
    return [f for f in files if naming.split_part(f["name"]) is not None]


def pick_latest(files: list[dict]) -> tuple[list[dict], list[str]]:
    """One file per name. Starting the same export twice leaves two files with one name in Drive:
    the newest wins and the name is reported. Returns (files sorted by name, duplicated names)."""
    latest: dict[str, dict] = {}
    duplicated = set()
    for f in files:
        seen = latest.get(f["name"])
        if seen is not None:
            duplicated.add(f["name"])
        if seen is None or f["modifiedTime"] > seen["modifiedTime"]:
            latest[f["name"]] = f
    return [latest[n] for n in sorted(latest)], sorted(duplicated)


def md5(path: Path) -> str:
    digest = hashlib.md5()  # Drive's own checksum; integrity only, not security
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_current(path: Path, remote: dict) -> bool:
    return path.is_file() and path.stat().st_size == int(remote["size"]) and md5(path) == remote["md5Checksum"]


def fetch(svc, remote: dict, dest_dir: Path) -> Path:
    """Download one file, verify its checksum, then move it into place."""
    from googleapiclient.http import MediaIoBaseDownload

    dest_dir.mkdir(parents=True, exist_ok=True)
    final, tmp = dest_dir / remote["name"], dest_dir / (remote["name"] + ".part")
    with open(tmp, "wb") as f:
        downloader = MediaIoBaseDownload(f, svc.files().get_media(fileId=remote["id"]), chunksize=32 << 20)
        finished = False
        while not finished:
            _, finished = downloader.next_chunk(num_retries=5)
    if md5(tmp) != remote["md5Checksum"]:
        tmp.unlink()
        raise IOError(f"Checksum mismatch for {remote['name']}; run the download again.")
    os.replace(tmp, final)
    return final


def download_all(svc, folder: str, dest_dir: Path, dry_run: bool = False) -> list[str]:
    """Fetch every export that is missing or different locally. Returns one summary line per file."""
    files, duplicated = pick_latest(list_exports(svc, folder))
    lines = [f"WARNING {name}: several files with this name in Drive; using the newest" for name in duplicated]
    for remote in files:
        size_mb = int(remote["size"]) / 1e6
        if is_current(dest_dir / remote["name"], remote):
            lines.append(f"have      {remote['name']} ({size_mb:.1f} MB)")
        elif dry_run:
            lines.append(f"would get {remote['name']} ({size_mb:.1f} MB)")
        else:
            fetch(svc, remote, dest_dir)
            lines.append(f"got       {remote['name']} ({size_mb:.1f} MB)")
    return lines
