"""Upload product videos to Yandex Disk and return a shareable link.

Ozon product videos are not uploaded through an Ozon API: the seller card
only accepts a video *link* from a whitelisted source (RuTube / VK Video /
Yandex Disk).  This module uploads the MP4 to the configured Yandex Disk
account, publishes it, and returns the public link (disk.yandex.com/i/...)
that Ozon accepts.

The Yandex API is unreachable from CN networks, so requests go through the
configured proxy (``YANDEX_PROXY`` in .env, e.g. the workstation's Clash at
http://192.168.0.200:10808).  The OAuth token is read from
``YANDEX_ACCESS_TOKEN`` in .env.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

import httpx

_API_BASE = "https://cloud-api.yandex.net/v1/disk/resources"
_TOKEN_ENV = "YANDEX_ACCESS_TOKEN"
_PROXY_ENV = "YANDEX_PROXY"
_DEFAULT_FOLDER = "ozon-erp/videos"


class YandexDiskError(Exception):
    pass


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    try:
        with open(env_file, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return env


def _make_client(proxy: str | None) -> httpx.Client:
    env = _load_env()
    return httpx.Client(
        proxy=proxy or None,
        timeout=httpx.Timeout(60.0, connect=15.0),
        headers={"Authorization": f"OAuth {env.get(_TOKEN_ENV) or os.environ.get(_TOKEN_ENV, '').strip()}"},
    )


def _client() -> httpx.Client:
    """Direct connection first; fall back to the configured proxy on failure.

    With a VPN up the laptop reaches Yandex directly.  Without it, the
    configured YANDEX_PROXY (e.g. the workstation's Clash at
    192.168.0.200:10808) is used automatically.
    """
    env = _load_env()
    proxy = env.get(_PROXY_ENV) or os.environ.get(_PROXY_ENV, "").strip() or None
    if not proxy:
        return _make_client(None)
    direct = _make_client(None)
    try:
        with direct:
            probe = direct.get("https://cloud-api.yandex.net/v1/disk/", timeout=httpx.Timeout(8.0, connect=5.0))
            if probe.status_code < 500:
                return _make_client(None)
    except Exception:
        pass
    return _make_client(proxy)


def _require_token(client: httpx.Client) -> None:
    auth = client.headers.get("Authorization") or ""
    if not auth.startswith("OAuth ") or len(auth) <= 7:
        raise YandexDiskError("缺少 YANDEX_ACCESS_TOKEN（.env）")


def _ensure_folder(client: httpx.Client, folder: str) -> None:
    resp = client.put(_API_BASE, params={"path": f"app:/{folder}"})
    if resp.status_code not in (200, 201, 409):
        raise YandexDiskError(f"创建 Yandex Disk 目录失败（HTTP {resp.status_code}）: {resp.text[:200]}")


def _public_url_of(client: httpx.Client, disk_path: str) -> str:
    resp = client.put(f"{_API_BASE}/publish", params={"path": disk_path})
    if resp.status_code not in (200, 201):
        raise YandexDiskError(f"Yandex Disk 发布失败（HTTP {resp.status_code}）: {resp.text[:200]}")
    # The publish response body is a GET href, not the public link.  The
    # public_url is returned by GET /resources after the resource is public.
    info = client.get(_API_BASE, params={"path": disk_path})
    if info.status_code == 200:
        public_url = info.json().get("public_url") or ""
        if public_url:
            # Normalize the yadi.sk short link to the long disk.yandex.com form
            # (HTTP 200 directly; matches the link format verified with Ozon).
            m = re.match(r"^https?://yadi\.sk/i/([\w-]+)", str(public_url))
            if m:
                return f"https://disk.yandex.com/i/{m.group(1)}"
            return str(public_url)
    body = resp.json() if resp.content else {}
    public_url = body.get("public_url") or ""
    if not public_url:
        raise YandexDiskError("Yandex Disk 发布成功但未返回 public_url")
    return str(public_url)


def upload_video(file_bytes: bytes, filename: str, folder: str = _DEFAULT_FOLDER) -> str:
    """Upload ``file_bytes`` to Yandex Disk, publish it, return public URL."""
    if not file_bytes:
        raise YandexDiskError("file_bytes is required")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename) or "video.mp4"
    if not safe_name.lower().endswith((".mp4", ".mov", ".webm", ".avi")):
        safe_name += ".mp4"
    disk_path = f"app:/{folder}/{safe_name}"
    with _client() as client:
        _require_token(client)
        _ensure_folder(client, folder)
        resp = client.get(f"{_API_BASE}/upload", params={"path": disk_path, "overwrite": "true"})
        if resp.status_code != 200:
            raise YandexDiskError(f"获取上传地址失败（HTTP {resp.status_code}）: {resp.text[:200]}")
        href = (resp.json().get("href") or "").strip()
        if not href:
            raise YandexDiskError("Yandex Disk 未返回上传地址 href")
        upload = client.put(href, content=file_bytes, headers={"Content-Type": "video/mp4"})
        if upload.status_code not in (200, 201):
            raise YandexDiskError(f"上传视频失败（HTTP {upload.status_code}）: {upload.text[:200]}")
        return _public_url_of(client, disk_path)


def attach_or_raise(db, shop_id: int, offer_ids: list[str], video_url: str) -> dict[str, Any]:
    """Convenience wrapper: attach a video URL to Ozon offers via the seller client."""
    from .sync_service import _credentials
    from .integrations.ozon_seller import OzonSellerClient
    client_id, api_key = _credentials(db, shop_id)
    with OzonSellerClient(client_id=client_id, api_key=api_key) as client:
        return client.attach_videos(offer_ids=offer_ids, video_url=video_url)
