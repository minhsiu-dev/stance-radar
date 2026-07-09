import hashlib
import hmac
import time

from fastapi import Request, Response

from app.config import get_settings

COOKIE_NAME = "sr_admin"
# Sent on all /api/* requests so every write endpoint can gate on it.
COOKIE_PATH = "/api"
# Long-lived cookie for the permanent (session_minutes=0) case so it survives a browser restart.
_PERMANENT_MAX_AGE = 60 * 60 * 24 * 3650


class AdminLocked(Exception):
    """Raised by require_admin when a gated endpoint is hit without a valid admin cookie."""


def _key(password: str) -> bytes:
    return hashlib.sha256(password.encode()).digest()


def _sign(expiry: int, password: str) -> str:
    mac = hmac.new(_key(password), str(expiry).encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{mac}"


def _valid(token: str | None, password: str) -> bool:
    if not token or "." not in token:
        return False
    expiry_str, mac = token.split(".", 1)
    try:
        expiry = int(expiry_str)
    except ValueError:
        return False
    expected = _sign(expiry, password).split(".", 1)[1]
    if not hmac.compare_digest(mac, expected):
        return False
    return expiry == 0 or expiry > int(time.time())


def issue(response: Response, password: str, session_minutes: int) -> None:
    if session_minutes <= 0:
        expiry, max_age = 0, _PERMANENT_MAX_AGE
    else:
        max_age = session_minutes * 60
        expiry = int(time.time()) + max_age
    response.set_cookie(
        COOKIE_NAME,
        _sign(expiry, password),
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=get_settings().admin_cookie_secure,
    )


def clear(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)


def is_admin(request: Request, response: Response) -> bool:
    settings = get_settings()
    password = settings.admin_password
    if not password:
        return False  # no password configured -> deny all writes (secure default)
    if _valid(request.cookies.get(COOKIE_NAME), password):
        issue(response, password, settings.admin_session_minutes)  # sliding renewal
        return True
    return False


def require_admin(request: Request, response: Response) -> None:
    if not is_admin(request, response):
        raise AdminLocked()
