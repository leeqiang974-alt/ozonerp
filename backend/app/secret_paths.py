r"""Resolve local secret files without baking one workstation's drive into code.

The notebook and the development PC use different Desktop paths.  A single
environment override keeps deployments explicit while the fallback preserves
the existing ``D:\\Desktop\\api`` layout and also supports the normal Windows
user Desktop layout.
"""

from __future__ import annotations

import os
from pathlib import Path


def api_dir() -> Path:
    """Return the configured local API-secret directory.

    ``ERP_API_DIR`` is intentionally a directory, not a secret value.  If it
    is absent, prefer the legacy shared path when it exists, then the current
    user's ``Desktop\api`` directory.  We do not create either directory or log
    its contents here.
    """

    configured = os.getenv("ERP_API_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    legacy = Path(r"D:\Desktop\api")
    if legacy.is_dir():
        return legacy
    return Path.home() / "Desktop" / "api"


def api_file(name: str) -> Path:
    """Return a path below :func:`api_dir` for a known secret filename."""

    return api_dir() / name
