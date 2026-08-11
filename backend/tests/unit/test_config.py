import pytest

from app.config import Settings


def test_missing_youtube_key_raises_with_name(monkeypatch):
    # Pretend the claude binary is present so we isolate the YOUTUBE_API_KEY check.
    monkeypatch.setattr("app.config.shutil.which", lambda _: "/usr/local/bin/claude")
    settings = Settings(youtube_api_key="", _env_file=None)
    with pytest.raises(RuntimeError) as exc:
        settings.validate_required_keys()
    assert "YOUTUBE_API_KEY" in str(exc.value)


def test_missing_claude_binary_raises_with_install_hint(monkeypatch):
    monkeypatch.setattr("app.config.shutil.which", lambda _: None)
    settings = Settings(youtube_api_key="yt-key", _env_file=None)
    with pytest.raises(RuntimeError) as exc:
        settings.validate_required_keys()
    message = str(exc.value)
    assert "claude" in message.lower()
    assert "YOUTUBE_API_KEY" not in message


def test_require_claude_false_skips_claude_binary_check(monkeypatch):
    # The api process (app/main.py) passes require_claude=False: it never spawns
    # `claude` itself (the worker container does), so it must not demand the binary.
    monkeypatch.setattr("app.config.shutil.which", lambda _: None)
    settings = Settings(youtube_api_key="yt-key", _env_file=None)
    settings.validate_required_keys(require_claude=False)  # should not raise


def test_fake_adapters_mode_skips_validation(monkeypatch):
    # Even with neither YouTube key nor claude binary, fake mode must pass.
    monkeypatch.setattr("app.config.shutil.which", lambda _: None)
    settings = Settings(
        youtube_api_key="", use_fake_adapters=True, _env_file=None
    )
    settings.validate_required_keys()  # should not raise


def test_defaults():
    settings = Settings(youtube_api_key="a", _env_file=None)
    assert settings.claude_bin == "claude"
    assert settings.claude_model == "claude-haiku-4-5"
    assert settings.backfill_limit == 30
    assert settings.analysis_concurrency == 2
    assert settings.shorts_max_seconds == 240
    assert settings.use_fake_adapters is False
    assert settings.fetch_proxy_url == ""
    assert settings.gluetun_control_url == ""
    assert settings.claude_timeout_seconds == 300.0
    assert settings.admin_password == ""
    assert settings.admin_session_minutes == 30
    assert settings.admin_cookie_secure is False
    assert settings.worker_poll_seconds == 1.0
    assert settings.api_base_url == "http://api:8000"
