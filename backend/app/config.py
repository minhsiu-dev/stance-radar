from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    youtube_api_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"
    backfill_limit: int = 30
    analysis_concurrency: int = 4
    database_url: str = "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar"
    use_fake_adapters: bool = False

    def validate_required_keys(self) -> None:
        if self.use_fake_adapters:
            return
        required = (
            ("YOUTUBE_API_KEY", self.youtube_api_key),
            ("ANTHROPIC_API_KEY", self.anthropic_api_key),
        )
        missing = [name for name, value in required if not value]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Copy .env.example to .env and fill them in."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
