"""Application configuration sourced from environment variables and .env file."""

from dotenv import load_dotenv
from functools import lru_cache
from os import getenv

# Load .env from project root (parent of backend/) or current directory
import os
_load_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
load_dotenv(_load_env_path, override=True)


class Settings:
    """Minimal runtime settings. Secrets must be provided outside source control."""

    def __init__(self) -> None:
        self.app_env = getenv("APP_ENV", "development")
        self.database_url = getenv("DATABASE_URL", "sqlite:///./ozon_erp.db")
        self.ozon_api_base_url = getenv("OZON_API_BASE_URL", "https://api-seller.ozon.ru")
        self.default_locale = getenv("DEFAULT_LOCALE", "zh-CN")
        self.default_currency = getenv("DEFAULT_CURRENCY", "CNY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
