"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "Frammer Analytics API"
    DEBUG: bool = False
    DATABASE_URL: Optional[str] = None
    SYNC_DATABASE_URL: str = ""
    GEMINI_API_KEYS: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()
