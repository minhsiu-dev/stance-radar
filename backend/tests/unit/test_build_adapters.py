from app.config import Settings
from app.main import build_adapters


def test_build_adapters_passes_proxy_when_set(monkeypatch):
    monkeypatch.setattr("yfinance.set_config", lambda **kw: None)
    s = Settings(
        youtube_api_key="k", fetch_proxy_url="http://proxy:8888",
        gluetun_control_url="http://gluetun:8000", _env_file=None,
    )
    adapters = build_adapters(s)
    assert adapters["market"]._proxy_url == "http://proxy:8888"


def test_build_adapters_no_proxy_by_default():
    s = Settings(youtube_api_key="k", _env_file=None)
    adapters = build_adapters(s)
    assert adapters["market"]._proxy_url == ""


def test_fetch_worker_routes_transcripts_through_the_proxy():
    from app.worker import build_worker_adapters

    s = Settings(
        youtube_api_key="k", fetch_proxy_url="http://proxy:8888",
        gluetun_control_url="http://gluetun:8000", _env_file=None,
    )
    assert build_worker_adapters(s, "fetch")["transcripts"]._proxy_url == "http://proxy:8888"


def test_the_real_analysis_client_never_retries_in_process():
    from app.worker import build_worker_adapters

    s = Settings(youtube_api_key="k", _env_file=None)
    assert build_worker_adapters(s, "analyze")["llm"]._max_retries == 1
