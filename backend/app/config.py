import shutil
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    youtube_api_key: str = ""
    claude_bin: str = "claude"
    claude_model: str = "claude-haiku-4-5"
    backfill_limit: int = 30
    analysis_concurrency: int = 2
    # Max seconds to wait for a single Claude CLI analysis call before killing it and retrying.
    # Long transcripts spend the whole call generating a large JSON output (a single turn, no
    # tool use); e.g. a ~15-min video measured ~196s, so 180s timed out. 300s covers that.
    claude_timeout_seconds: float = 300.0
    # Skip imported videos this many seconds or shorter (YouTube Shorts / too-short
    # clips have no analyzable content); 0 disables the filter
    shorts_max_seconds: int = 240
    # Admin lock: password required before add/remove channel, review videos, trigger analysis.
    # Empty = deny all writes (secure default for the public tunnel; set ADMIN_PASSWORD to enable).
    admin_password: str = ""
    # Minutes of inactivity before the admin cookie expires (sliding). 0 = permanent (never idle-lock).
    admin_session_minutes: int = 30
    # Set true when served over HTTPS (the Cloudflare tunnel) so the cookie is Secure.
    # Keep false for local http://localhost dev, or the browser drops the cookie.
    admin_cookie_secure: bool = False
    # Auto discover + analyze every N minutes (0 = disabled, stays fully manual)
    auto_refresh_minutes: int = 0
    database_url: str = "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar"
    use_fake_adapters: bool = False
    # Opt-in VPN proxy (set by docker-compose.vpn.yml); empty = fetch directly
    fetch_proxy_url: str = ""
    gluetun_control_url: str = ""
    # Worker: how often to poll the jobs table for enqueued work
    worker_poll_seconds: float = 1.0
    # Worker -> api base URL, used for ticker validation (the worker never imports yfinance)
    api_base_url: str = "http://api:8000"

    def validate_required_keys(self, *, require_claude: bool = True) -> None:
        if self.use_fake_adapters:
            return
        problems: list[str] = []
        if not self.youtube_api_key:
            problems.append(
                "Missing required environment variable: YOUTUBE_API_KEY. "
                "Copy .env.example to .env and fill it in."
            )
        if require_claude and shutil.which(self.claude_bin) is None:
            problems.append(
                f"Claude Code CLI binary '{self.claude_bin}' not found in PATH. "
                "Install it with `npm i -g @anthropic-ai/claude-code` and run "
                "`claude login`; if running in docker, mount ~/.claude into the worker "
                "container so the auth token is visible."
            )
        if problems:
            raise RuntimeError("\n".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
