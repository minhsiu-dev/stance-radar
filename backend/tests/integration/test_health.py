from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_envelope(monkeypatch):
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "data": {"status": "ok"}, "error": None}
