from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        enable_decoding=False,
    )

    app_env: str = "development"
    secret_key: str = "development-secret-key-with-at-least-32-bytes"
    api_v1_prefix: str = "/api/v1"

    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    jwt_algorithm: str = "HS256"
    log_level: str = "INFO"
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "test", "testserver"]
    rate_limit_requests: int = 300
    rate_limit_window_seconds: int = 60

    postgres_url: str = "postgresql+asyncpg://newtalk:change-me@localhost:5432/newtalk"

    cors_origins: list[str] = ["http://localhost:3000"]
    storage_bucket_name: str = "newtalk-media"
    storage_region: str = "us-east-1"
    storage_endpoint_url: str | None = "http://localhost:9000"
    storage_access_key: str = "minioadmin"
    storage_secret_key: str = "minioadmin"
    storage_presign_expire_seconds: int = 900
    # Public URL prefix used to rewrite internal MinIO URLs for browser access.
    # When set, internal endpoint (e.g. http://minio:9000) is replaced with this value.
    storage_public_url: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def parse_allowed_hosts(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
