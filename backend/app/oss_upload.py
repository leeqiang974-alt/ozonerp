#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""Reusable Aliyun OSS upload helper for the Temu automation project.

Reads credentials from D:/Desktop/api/阿里云的key和secret.txt (never prints them).
Other agents can import this module and call upload_file() / upload_bytes().

Quick start:
    import sys
    sys.path.insert(0, r"C:\Users\Administrator\Documents\temu自动化\skills\oss-upload")
    from oss_upload import upload_file, upload_bytes, get_bucket

    url = upload_file(r"E:\path\to\image.jpg", "temu-jit/my-batch/img/abc.jpg")
    print(url)
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import pathlib
import urllib.parse
import urllib.request
from typing import Optional

import oss2

from .secret_paths import api_file

# -- Credential & endpoint config --
_LEGACY_CRED_FILE = pathlib.Path(r"D:\Desktop\api\阿里云的key和secret.txt")


def _credential_file() -> pathlib.Path:
    """Resolve OSS credentials for the current workstation/deployment."""

    configured = os.getenv("ALIYUN_OSS_CREDENTIAL_FILE", "").strip()
    if configured:
        return pathlib.Path(configured).expanduser()
    if _LEGACY_CRED_FILE.is_file():
        return _LEGACY_CRED_FILE
    return api_file("阿里云的key和secret.txt")
_ENDPOINT = "oss-cn-shanghai.aliyuncs.com"
_BUCKET = "ozonshanghai"


def read_oss_config() -> dict:
    """Load OSS credentials from the project key file.

    File format (non-blank lines, 0-indexed):
        line[0] = label  ("AccessKeyId...")
        line[1] = AccessKeyId        (starts with LTAI)
        line[2] = label  ("AccessKeySecret...")
        line[3] = AccessKeySecret
    Returns dict with access_key_id, access_key_secret, endpoint, bucket.
    Never prints or logs the key values.
    """
    cred_file = _credential_file()
    lines = [x.strip() for x in cred_file.read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(lines) < 4:
        raise ValueError(f"Credential file has too few non-blank lines: {cred_file}")
    return {
        "access_key_id": lines[1],
        "access_key_secret": lines[3],
        "endpoint": _ENDPOINT,
        "bucket": _BUCKET,
    }


def get_bucket() -> oss2.Bucket:
    """Create and return an authenticated oss2.Bucket ready for operations.

    Explicit timeouts prevent a slow OSS endpoint from hanging the batch
    worker indefinitely.
    """
    cfg = read_oss_config()
    auth = oss2.Auth(cfg["access_key_id"], cfg["access_key_secret"])
    return oss2.Bucket(
        auth,
        f"https://{cfg['endpoint']}",
        cfg["bucket"],
        connect_timeout=15,
        timeout=60,
    )


def _public_url(bucket: oss2.Bucket, object_key: str) -> str:
    endpoint_clean = str(bucket.endpoint).replace("https://", "").replace("http://", "")
    return f"https://{bucket.bucket_name}.{endpoint_clean}/{object_key}"


def _guess_content_type(filepath: Optional[str], fallback: str = "image/jpeg") -> str:
    if filepath:
        ct = mimetypes.guess_type(filepath)[0]
        if ct:
            return ct
    return fallback


def upload_file(
    filepath: str,
    object_key: str,
    *,
    content_type: Optional[str] = None,
    verify: bool = True,
    bucket: Optional[oss2.Bucket] = None,
) -> str:
    """Upload a local file to OSS and return its public URL.

    Args:
        filepath: local file path to upload.
        object_key: OSS object key, e.g.
            "temu-jit/yeahf-2000d/t-carousel/20260808/abc.jpg".
        content_type: override MIME type; auto-guessed from filepath if omitted.
        verify: if True, HEAD the object after upload to confirm (recommended).
        bucket: reuse an existing oss2.Bucket; created automatically if None.
    Returns:
        Public URL:
        https://ozonshanghai.oss-cn-shanghai.aliyuncs.com/{object_key}
    """
    p = pathlib.Path(filepath)
    if not p.exists():
        raise FileNotFoundError(filepath)
    own_bucket = bucket is None
    if own_bucket:
        bucket = get_bucket()
    ct = content_type or _guess_content_type(str(p))
    bucket.put_object_from_file(object_key, str(p), headers={"Content-Type": ct})
    url = _public_url(bucket, object_key)
    if verify:
        meta = bucket.head_object(object_key)
        if meta.status != 200:
            raise RuntimeError(
                f"HEAD verify failed: status={meta.status} key={object_key}"
            )
    return url


def upload_bytes(
    data: bytes,
    object_key: str,
    *,
    content_type: str = "image/jpeg",
    verify: bool = True,
    bucket: Optional[oss2.Bucket] = None,
) -> str:
    """Upload raw bytes to OSS and return its public URL.

    Useful for uploading images fetched from a URL (download bytes first,
    then pass them here) without writing a temp file.
    """
    own_bucket = bucket is None
    if own_bucket:
        bucket = get_bucket()
    bucket.put_object(object_key, data, headers={"Content-Type": content_type})
    url = _public_url(bucket, object_key)
    if verify:
        meta = bucket.head_object(object_key)
        if meta.status != 200:
            raise RuntimeError(
                f"HEAD verify failed: status={meta.status} key={object_key}"
            )
    return url


def fetch_and_upload(
    source_url: str,
    object_key: str,
    *,
    verify: bool = True,
    bucket: Optional[oss2.Bucket] = None,
) -> str:
    """Download bytes from a URL and re-upload to OSS, returning the new URL.

    Handy for mirroring third-party image URLs (kwcdn, etc.) into the project
    OSS bucket so they become durable/public. The object_key extension is
    auto-corrected to match the detected image type if needed.
    """
    request = urllib.request.Request(source_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
        content_type = response.headers.get("Content-Type", "image/jpeg")

    ext = ""
    path_suffix = pathlib.Path(urllib.parse.urlsplit(source_url).path).suffix.lower()
    if path_suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = path_suffix
    else:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip()) if content_type else None
        if guessed in {".jpg", ".jpeg", ".png", ".webp"}:
            ext = guessed
    if not ext:
        ext = ".jpg"

    final_key = object_key if object_key.lower().endswith(ext) else object_key + ext
    return upload_bytes(
        data,
        final_key,
        content_type=content_type or "image/jpeg",
        verify=verify,
        bucket=bucket,
    )


def sha256_file(filepath: str) -> str:
    """Return SHA-256 hex digest of a file (for manifest dedup/audit)."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


if __name__ == "__main__":
    # Smoke test: print config status (NO key values) and bucket connectivity.
    cfg = read_oss_config()
    print(
        f"config OK: endpoint={cfg['endpoint']} bucket={cfg['bucket']} "
        f"key_id_len={len(cfg['access_key_id'])} "
        f"secret_len={len(cfg['access_key_secret'])}"
    )
    b = get_bucket()
    meta = b.head_object(
        "temu-jit/workbook-189-round17/package-image/20260625/"
        "e9071b0c45a24dfcb7dad84539512130_2cec521bebc947e7bba27258d5b9e37b-goods.jpeg"
    )
    print(f"bucket reachable: HEAD status={meta.status} len={meta.content_length}")
