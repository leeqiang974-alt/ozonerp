"""Application configuration sourced only from environment variables."""

from functools import lru_cache
from os import getenv


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
