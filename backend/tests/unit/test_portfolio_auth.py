import time
from types import SimpleNamespace

import pytest
from fastapi import Response

from app.config import Settings
from app.portfolio import auth

PW = "hunter2"


def _req(cookies):
    return SimpleNamespace(cookies=cookies)


def _settings(password, idle=30):
    return Settings(
        portfolio_password=password,
        portfolio_lock_idle_minutes=idle,
        _env_file=None,
    )


def test_sign_round_trips_and_detects_tamper():
    token = auth._sign(int(time.time()) + 60, PW)
    assert auth._valid(token, PW)
    assert not auth._valid(token, "wrong-password")
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
    assert not auth._valid(tampered, PW)
    assert not auth._valid(None, PW)
    assert not auth._valid("garbage-no-dot", PW)


def test_expired_token_is_invalid():
    assert not auth._valid(auth._sign(int(time.time()) - 1, PW), PW)


def test_permanent_token_never_expires():
    assert auth._valid(auth._sign(0, PW), PW)


def test_issue_sets_scoped_httponly_cookie():
    resp = Response()
    auth.issue(resp, PW, idle_minutes=30)
    cookie = resp.headers["set-cookie"].lower()
    assert auth.COOKIE_NAME in cookie
    assert "httponly" in cookie
    assert "path=/api/portfolio" in cookie
    assert "samesite=lax" in cookie
    assert "secure" not in cookie
    assert "domain" not in cookie


def test_clear_expires_the_cookie():
    resp = Response()
    auth.clear(resp)
    assert "max-age=0" in resp.headers["set-cookie"].lower()


def test_is_unlocked_true_when_feature_disabled(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(""))
    resp = Response()
    assert auth.is_unlocked(_req({}), resp) is True
    assert "set-cookie" not in resp.headers  # disabled feature does no cookie work


def test_is_unlocked_requires_valid_cookie_and_slides(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    assert auth.is_unlocked(_req({}), Response()) is False
    token = auth._sign(int(time.time()) + 60, PW)
    resp = Response()
    assert auth.is_unlocked(_req({auth.COOKIE_NAME: token}), resp) is True
    # sliding renewal: a fresh cookie is re-issued on the valid check
    assert auth.COOKIE_NAME in resp.headers["set-cookie"]


def test_require_unlock_raises_when_locked(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    with pytest.raises(auth.PortfolioLocked):
        auth.require_unlock(_req({}), Response())


def test_require_unlock_passes_when_unlocked(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    token = auth._sign(int(time.time()) + 60, PW)
    auth.require_unlock(_req({auth.COOKIE_NAME: token}), Response())  # no raise


def test_issue_permanent_uses_long_max_age():
    resp = Response()
    auth.issue(resp, PW, idle_minutes=0)
    cookie = resp.headers["set-cookie"].lower()
    assert f"max-age={auth._PERMANENT_MAX_AGE}" in cookie
    assert auth._PERMANENT_MAX_AGE > 60 * 60 * 24 * 365  # genuinely long-lived (> 1 year)
