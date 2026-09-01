"""Local configuration for listing-text LLM providers.

Secrets stay outside the repository.  DeepSeek is the default provider for
product titles and descriptions; Volcano Ark remains an explicit fallback.
"""

from __future__ import annotations

import os
from pathlib import Path


DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"


def _read_secret_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8-sig").strip()
    except OSError:
        return ""


def get_listing_llm_provider() -> str:
    """Return the configured provider name without exposing credentials."""
    provider = os.getenv("LLM_PROVIDER", "deepseek").strip().lower()
    if provider in {"volcano", "volc", "ark"}:
        return "volcengine"
    if provider not in {"deepseek", "volcengine"}:
        raise RuntimeError("LLM_PROVIDER 仅支持 deepseek 或 volcengine")
    return provider


def get_listing_llm_config() -> tuple[str, str, str]:
    """Return ``(api_key, base_url, model)`` for title/description generation.

    ``LLM_API_KEY`` remains a Volcano compatibility fallback.  It is
    deliberately never used for DeepSeek, preventing an old Volcano key from
    being sent to the wrong provider after the default switches.
    """
    provider = get_listing_llm_provider()
    if provider == "deepseek":
        key_file = os.getenv("DEEPSEEK_API_KEY_FILE", r"D:\Desktop\api\deepseek.txt")
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
