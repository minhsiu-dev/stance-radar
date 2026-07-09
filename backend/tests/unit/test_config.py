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
    assert settings.analysis_concurrency == 4
    assert settings.shorts_max_seconds == 240
    assert settings.use_fake_adapters is False
    assert settings.fetch_proxy_url == ""
    assert settings.gluetun_control_url == ""
    assert settings.claude_timeout_seconds == 300.0
