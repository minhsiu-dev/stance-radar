import pytest

from app.config import Settings


def test_missing_keys_raise_with_names():
    settings = Settings(youtube_api_key="", anthropic_api_key="", _env_file=None)
    with pytest.raises(RuntimeError) as exc:
        settings.validate_required_keys()
    assert "YOUTUBE_API_KEY" in str(exc.value)
    assert "ANTHROPIC_API_KEY" in str(exc.value)


def test_partial_missing_lists_only_missing():
    settings = Settings(youtube_api_key="yt-key", anthropic_api_key="", _env_file=None)
    with pytest.raises(RuntimeError) as exc:
        settings.validate_required_keys()
    assert "ANTHROPIC_API_KEY" in str(exc.value)
    assert "YOUTUBE_API_KEY" not in str(exc.value)


def test_fake_adapters_mode_skips_validation():
    settings = Settings(
        youtube_api_key="", anthropic_api_key="", use_fake_adapters=True, _env_file=None
    )
    settings.validate_required_keys()  # 不應 raise


def test_defaults():
    settings = Settings(youtube_api_key="a", anthropic_api_key="b", _env_file=None)
    assert settings.anthropic_model == "claude-haiku-4-5"
    assert settings.backfill_limit == 30
    assert settings.analysis_concurrency == 4
    assert settings.use_fake_adapters is False
