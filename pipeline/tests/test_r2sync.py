"""Offline tests for r2sync: a fake S3 client, no network, no real keys."""

import io
import json

import pytest
from botocore.exceptions import ClientError

from r2sync.core import IMMUTABLE, MANIFEST_CACHE, R2Config, R2Error, check_key, object_headers, push, read_manifest, set_layer

CFG = R2Config(endpoint="https://acct.r2.cloudflarestorage.com", access_key_id="id", secret_access_key="secret",
               buckets={"public": "jaga-tiles", "private": "jaga-rasters"})


class FakeS3:
    def __init__(self):
        self.objects = {}  # (bucket, key) -> {"body": bytes, **headers}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    def upload_file(self, path, Bucket, Key, ExtraArgs=None):
        with open(path, "rb") as f:
            self.objects[(Bucket, Key)] = {"body": f.read(), **(ExtraArgs or {})}

    def put_object(self, Bucket, Key, Body, **headers):
        self.objects[(Bucket, Key)] = {"body": Body, **headers}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)]["body"])}


@pytest.fixture
def pmtiles(tmp_path):
    p = tmp_path / "flood-depth-rp100.pmtiles"
    p.write_bytes(b"PMTiles\x03" + b"\0" * 64)
    return p


@pytest.mark.parametrize("bucket,key", [
    ("public", "dem/fabdem.tif"),            # dem/ is private-only
    ("public", "/hazard/x.pmtiles"),         # absolute
    ("public", "hazard/../dem/x.tif"),       # escapes its prefix
    ("public", "manifest.json"),             # only via set_layer
    ("private", "assets/sprite.png"),        # assets/ is public-only
    ("both", "hazard/x.pmtiles"),            # unknown bucket
])
def test_check_key_rejects_keys_outside_the_bucket_layout(bucket, key):
    with pytest.raises(R2Error):
        check_key(bucket, key)


def test_check_key_normalises_windows_separators():
    assert check_key("public", "hazard\\rp100\\2026-10-05.pmtiles") == "hazard/rp100/2026-10-05.pmtiles"


def test_public_objects_are_immutable_and_typed_private_ones_are_not_cached():
    assert object_headers("public", "hazard/a/2026-10-05.pmtiles") == {
        "ContentType": "application/vnd.pmtiles", "CacheControl": IMMUTABLE}
    assert object_headers("private", "dem/fabdem.tif") == {"ContentType": "image/tiff"}


def test_push_uploads_once_and_refuses_to_overwrite(pmtiles):
    s3 = FakeS3()
    msg = push(s3, CFG, pmtiles, "public", "hazard/rp100/2026-10-05.pmtiles")
    assert msg.startswith("uploaded jaga-tiles/hazard/rp100/2026-10-05.pmtiles")
    assert s3.objects[("jaga-tiles", "hazard/rp100/2026-10-05.pmtiles")]["CacheControl"] == IMMUTABLE
    with pytest.raises(R2Error, match="write-once"):
        push(s3, CFG, pmtiles, "public", "hazard/rp100/2026-10-05.pmtiles")


def test_push_dry_run_uploads_nothing(pmtiles):
    s3 = FakeS3()
    assert push(s3, CFG, pmtiles, "private", "hazard/rp100/src.tif", dry_run=True).startswith("dry run")
    assert s3.objects == {}


def test_manifest_points_layers_at_existing_keys_only(pmtiles):
    s3 = FakeS3()
    with pytest.raises(R2Error, match="doesn't exist"):
        set_layer(s3, CFG, "flood-depth-rp100", "hazard/rp100/2026-10-05.pmtiles")
    push(s3, CFG, pmtiles, "public", "hazard/rp100/2026-10-05.pmtiles")
    set_layer(s3, CFG, "flood-depth-rp100", "hazard/rp100/2026-10-05.pmtiles")
    stored = s3.objects[("jaga-tiles", "manifest.json")]
    assert stored["CacheControl"] == MANIFEST_CACHE
    assert json.loads(stored["body"])["layers"]["flood-depth-rp100"]["key"] == "hazard/rp100/2026-10-05.pmtiles"
    assert read_manifest(s3, CFG)["layers"]["flood-depth-rp100"]["key"].endswith("2026-10-05.pmtiles")


def test_missing_settings_name_the_variables_but_never_values(monkeypatch, tmp_path):
    import r2sync.core as core

    for k in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_ACCOUNT_ID"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(core, "env_value", lambda k: {"R2_ACCESS_KEY_ID": "AKIA-SHOULD-NOT-PRINT"}.get(k))
    with pytest.raises(R2Error) as e:
        R2Config.from_env()
    assert "R2_SECRET_ACCESS_KEY" in str(e.value) and "R2_ENDPOINT" in str(e.value)
    assert "AKIA-SHOULD-NOT-PRINT" not in str(e.value)


def test_endpoint_is_derived_from_account_id(monkeypatch):
    import r2sync.core as core

    vals = {"R2_ACCESS_KEY_ID": "id", "R2_SECRET_ACCESS_KEY": "s", "R2_ACCOUNT_ID": "abc123"}
    monkeypatch.setattr(core, "env_value", lambda k: vals.get(k))
    cfg = R2Config.from_env()
    assert cfg.endpoint == "https://abc123.r2.cloudflarestorage.com"
    assert cfg.buckets == {"public": "jaga-tiles", "private": "jaga-rasters"}
