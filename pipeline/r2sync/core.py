"""Upload pipeline outputs to Cloudflare R2 (S3-compatible) and keep jaga-tiles/manifest.json current.

Two buckets (docs/decisions.md, 2026-09-28):
- public  (R2_BUCKET_PUBLIC,  default jaga-tiles):   what the app serves, e.g. hazard/<layer>/<date>.pmtiles
- private (R2_BUCKET_PRIVATE, default jaga-rasters): source rasters, never served

Keys are write-once: push refuses to overwrite, so a published tile file never changes under a
cached URL. A new version gets a new key, and manifest.json points the app at it.
"""

from __future__ import annotations

import json
import mimetypes
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from ingest_thaiwater.settings import env_value

PREFIXES = {
    "public": ("hazard/", "extents/", "stage/", "assets/"),
    "private": ("dem/", "sar/", "hazard/", "extents/", "stage/"),
}
MANIFEST_KEY = "manifest.json"
IMMUTABLE = "public, max-age=31536000, immutable"
MANIFEST_CACHE = "public, max-age=300"
CONTENT_TYPES = {
    ".pmtiles": "application/vnd.pmtiles",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".pbf": "application/x-protobuf",
}


class R2Error(Exception):
    """A problem the user can fix; the message says how. Never includes key values."""


@dataclass(frozen=True)
class R2Config:
    endpoint: str
    access_key_id: str
    secret_access_key: str
    buckets: dict[str, str]

    @classmethod
    def from_env(cls) -> "R2Config":
        missing = [k for k in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not env_value(k)]
        endpoint = env_value("R2_ENDPOINT")
        if not endpoint and env_value("R2_ACCOUNT_ID"):
            endpoint = f"https://{env_value('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com"
        if not endpoint:
            missing.append("R2_ENDPOINT (or R2_ACCOUNT_ID)")
        if missing:
            raise R2Error("Missing in .env.local: " + ", ".join(missing) + ". See SETUP.md, 'One-time: Cloudflare R2'.")
        return cls(
            endpoint=endpoint.rstrip("/"),
            access_key_id=env_value("R2_ACCESS_KEY_ID"),
            secret_access_key=env_value("R2_SECRET_ACCESS_KEY"),
            buckets={
                "public": env_value("R2_BUCKET_PUBLIC") or "jaga-tiles",
                "private": env_value("R2_BUCKET_PRIVATE") or "jaga-rasters",
            },
        )


def make_client(cfg: R2Config):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
        # R2 doesn't need boto3's default extra checksums; only send them when an API requires it.
        config=Config(request_checksum_calculation="when_required",
                      response_checksum_validation="when_required",
                      retries={"max_attempts": 5, "mode": "standard"}),
    )


def check_key(bucket: str, key: str) -> str:
    """Normalise and validate an object key for the given bucket ('public' or 'private')."""
    if bucket not in PREFIXES:
        raise R2Error(f"Unknown bucket '{bucket}': use 'public' or 'private'.")
    key = key.replace("\\", "/").strip()
    parts = PurePosixPath(key).parts
    if not key or key.startswith("/") or ".." in parts or key.endswith("/"):
        raise R2Error(f"Invalid key '{key}': use a relative path like hazard/<layer>/<date>.pmtiles.")
    if key == MANIFEST_KEY:
        raise R2Error("manifest.json is only written by the 'manifest' command.")
    if not key.startswith(PREFIXES[bucket]):
        raise R2Error(f"Key '{key}' is not under an allowed prefix for the {bucket} bucket: "
                      + ", ".join(PREFIXES[bucket]))
    return key


def object_headers(bucket: str, key: str) -> dict[str, str]:
    suffix = PurePosixPath(key).suffix.lower()
    ctype = CONTENT_TYPES.get(suffix) or mimetypes.guess_type(key)[0] or "application/octet-stream"
    headers = {"ContentType": ctype}
    if bucket == "public":
        headers["CacheControl"] = IMMUTABLE
    return headers


def exists(client, bucket_name: str, key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        client.head_object(Bucket=bucket_name, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def push(client, cfg: R2Config, path: Path, bucket: str, key: str, dry_run: bool = False) -> str:
    """Upload one file. Refuses to overwrite an existing key. Returns a one-line summary."""
    key = check_key(bucket, key)
    if not path.is_file():
        raise R2Error(f"File not found: {path}")
    name = cfg.buckets[bucket]
    if exists(client, name, key):
        raise R2Error(f"{name}/{key} already exists. Keys are write-once: upload under a new key "
                      "(e.g. a new date) and point the manifest at it.")
    headers = object_headers(bucket, key)
    size_mb = path.stat().st_size / 1e6
    summary = f"{name}/{key} ({size_mb:.1f} MB, {headers['ContentType']})"
    if dry_run:
        return "dry run, would upload " + summary
    client.upload_file(str(path), name, key, ExtraArgs=headers)
    return "uploaded " + summary


def list_keys(client, bucket_name: str, prefix: str = "") -> list[tuple[str, int]]:
    out, token = [], None
    while True:
        kw = {"Bucket": bucket_name, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        page = client.list_objects_v2(**kw)
        out += [(o["Key"], o["Size"]) for o in page.get("Contents", [])]
        if not page.get("IsTruncated"):
            return out
        token = page["NextContinuationToken"]


def read_manifest(client, cfg: R2Config) -> dict:
    name = cfg.buckets["public"]
    if not exists(client, name, MANIFEST_KEY):
        return {"layers": {}}
    body = client.get_object(Bucket=name, Key=MANIFEST_KEY)["Body"].read()
    return json.loads(body)


def set_layer(client, cfg: R2Config, layer: str, key: str, dry_run: bool = False) -> dict:
    """Point manifest.json's entry for `layer` at an existing public key."""
    key = check_key("public", key)
    name = cfg.buckets["public"]
    if not exists(client, name, key):
        raise R2Error(f"{name}/{key} doesn't exist. Push the file first, then update the manifest.")
    manifest = read_manifest(client, cfg)
    manifest.setdefault("layers", {})[layer] = {
        "key": key,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if not dry_run:
        client.put_object(Bucket=name, Key=MANIFEST_KEY,
                          Body=json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
                          ContentType="application/json", CacheControl=MANIFEST_CACHE)
    return manifest
