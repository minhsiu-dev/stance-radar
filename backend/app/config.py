import shutil
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    youtube_api_key: str = ""
    claude_bin: str = "claude"
    claude_model: str = "claude-haiku-4-5"
    backfill_limit: int = 30
    analysis_concurrency: int = 4
    database_url: str = "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar"
    use_fake_adapters: bool = False

    def validate_required_keys(self) -> None:
        if self.use_fake_adapters:
            return
        problems: list[str] = []
        if not self.youtube_api_key:
            problems.append(
                "Missing required environment variable: YOUTUBE_API_KEY. "
                "Copy .env.example to .env and fill it in."
            )
        if shutil.which(self.claude_bin) is None:
            problems.append(
                f"Claude Code CLI binary '{self.claude_bin}' not found in PATH. "
                "Install it with `npm i -g @anthropic-ai/claude-code` and run "
                "`claude login`; if running in docker, mount ~/.claude into the api "
                "container so the auth token is visible."
            )
        if problems:
            raise RuntimeError("\n".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
