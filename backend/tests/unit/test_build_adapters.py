from app.config import Settings
from app.main import build_adapters


def test_build_adapters_passes_proxy_when_set(monkeypatch):
    monkeypatch.setattr("yfinance.set_config", lambda **kw: None)
    s = Settings(
        youtube_api_key="k", fetch_proxy_url="http://proxy:8888",
        gluetun_control_url="http://gluetun:8000", _env_file=None,
    )
    adapters = build_adapters(s)
    assert adapters["transcripts"]._proxy_url == "http://proxy:8888"
    assert adapters["market"]._proxy_url == "http://proxy:8888"


def test_build_adapters_no_proxy_by_default():
    s = Settings(youtube_api_key="k", _env_file=None)
    adapters = build_adapters(s)
    assert adapters["transcripts"]._proxy_url == ""
    assert adapters["market"]._proxy_url == ""
