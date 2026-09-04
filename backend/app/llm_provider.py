"""Local configuration for listing-text LLM providers.

Secrets stay outside the repository.  DeepSeek is the default provider for
product titles and descriptions; Volcano Ark remains an explicit fallback.
"""

from __future__ import annotations

import os
from pathlib import Path

from .secret_paths import api_file


DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"

AGNES_DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1"
AGNES_DEFAULT_MODEL = "agnes-2.5-flash"


def _read_secret_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8-sig").strip()
    except OSError:
        return ""


def _read_agnes_api_key() -> str:
    """Read the Agnes key from AGNES_API_KEY env or cangyuanapi.txt KEY=VALUE lines."""
    from_env = os.getenv("AGNES_API_KEY", "").strip()
    if from_env:
        return from_env
    path = os.getenv("AGNES_API_KEY_FILE", str(api_file("cangyuanapi.txt")))
    try:
        for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith("AGNES_API_KEY="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def get_listing_llm_provider() -> str:
    """Return the configured provider name without exposing credentials."""
    provider = os.getenv("LLM_PROVIDER", "deepseek").strip().lower()
    if provider in {"agnes", "agnesai", "agnes-ai"}:
        return "agnes"
    if provider in {"volcano", "volc", "ark"}:
        return "volcengine"
    if provider not in {"deepseek", "volcengine", "agnes"}:
        raise RuntimeError("LLM_PROVIDER 仅支持 deepseek、volcengine 或 agnes")
    return provider


def get_listing_llm_config() -> tuple[str, str, str]:
    """Return ``(api_key, base_url, model)`` for title/description generation.

    ``LLM_API_KEY`` remains a Volcano compatibility fallback.  It is
    deliberately never used for DeepSeek, preventing an old Volcano key from
    being sent to the wrong provider after the default switches.
    """
    provider = get_listing_llm_provider()
    if provider == "agnes":
        api_key = _read_agnes_api_key()
        base_url = os.getenv("AGNES_BASE_URL", AGNES_DEFAULT_BASE_URL).strip()
        model = os.getenv("AGNES_LLM_MODEL", AGNES_DEFAULT_MODEL).strip()
        return api_key, base_url, model
    if provider == "deepseek":
        key_file = os.getenv("DEEPSEEK_API_KEY_FILE", str(api_file("deepseek.txt")))
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip() or _read_secret_file(key_file)
        base_url = os.getenv("DEEPSEEK_BASE_URL", DEEPSEEK_DEFAULT_BASE_URL).strip()
        model = os.getenv("DEEPSEEK_MODEL", DEEPSEEK_DEFAULT_MODEL).strip()
        return api_key, base_url, model

    api_key = (
        os.getenv("VOLCENGINE_LLM_API_KEY", "").strip()
        or os.getenv("LLM_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    base_url = (
        os.getenv("VOLCENGINE_LLM_BASE_URL", "").strip()
        or os.getenv("LLM_BASE_URL", "").strip()
    )
    model = (
        os.getenv("VOLCENGINE_LLM_MODEL", "").strip()
        or os.getenv("LLM_MODEL", "").strip()
    )
    return api_key, base_url, model
