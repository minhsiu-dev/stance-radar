import time
from types import SimpleNamespace

import pytest
from fastapi import Response

from app.config import Settings
from app import auth

PW = "hunter2"


def _req(cookies):
    return SimpleNamespace(cookies=cookies)


def _settings(password, minutes=30, secure=False):
    return Settings(
        admin_password=password,
        admin_session_minutes=minutes,
        admin_cookie_secure=secure,
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


def test_issue_sets_httponly_scoped_cookie():
    resp = Response()
    auth.issue(resp, PW, session_minutes=30)
    cookie = resp.headers["set-cookie"].lower()
    assert auth.COOKIE_NAME in cookie
    assert "httponly" in cookie
    assert "path=/api" in cookie
    assert "samesite=lax" in cookie
    assert "secure" not in cookie  # default admin_cookie_secure=False


def test_issue_marks_secure_when_configured(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW, secure=True))
    resp = Response()
    auth.issue(resp, PW, session_minutes=30)
    assert "secure" in resp.headers["set-cookie"].lower()


def test_issue_permanent_uses_long_max_age():
    resp = Response()
    auth.issue(resp, PW, session_minutes=0)
    cookie = resp.headers["set-cookie"].lower()
    assert f"max-age={auth._PERMANENT_MAX_AGE}" in cookie
    assert auth._PERMANENT_MAX_AGE > 60 * 60 * 24 * 365


def test_clear_expires_the_cookie():
    resp = Response()
    auth.clear(resp)
    assert "max-age=0" in resp.headers["set-cookie"].lower()


def test_is_admin_denies_when_password_unset(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(""))
    resp = Response()
    assert auth.is_admin(_req({}), resp) is False
    assert "set-cookie" not in resp.headers


def test_is_admin_requires_valid_cookie_and_slides(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    assert auth.is_admin(_req({}), Response()) is False
    original_expiry = int(time.time()) + 5  # near-term: still valid, but about to expire
    token = auth._sign(original_expiry, PW)
    resp = Response()
    assert auth.is_admin(_req({auth.COOKIE_NAME: token}), resp) is True
    set_cookie = resp.headers["set-cookie"]
    assert auth.COOKIE_NAME in set_cookie  # sliding re-issue
    new_token = set_cookie.split(f"{auth.COOKIE_NAME}=", 1)[1].split(";", 1)[0]
    new_expiry = int(new_token.split(".", 1)[0])
    assert new_expiry > original_expiry  # re-issued token's expiry actually advanced


def test_require_admin_raises_when_locked(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    with pytest.raises(auth.AdminLocked):
        auth.require_admin(_req({}), Response())


def test_require_admin_raises_when_password_unset(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(""))
    with pytest.raises(auth.AdminLocked):
        auth.require_admin(_req({}), Response())


def test_require_admin_passes_when_unlocked(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(PW))
    token = auth._sign(int(time.time()) + 60, PW)
    auth.require_admin(_req({auth.COOKIE_NAME: token}), Response())  # no raise
