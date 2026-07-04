import hashlib
import hmac
import time

from fastapi import Request, Response

from app.config import get_settings

COOKIE_NAME = "sr_portfolio"
COOKIE_PATH = "/api/portfolio"
# Long-lived cookie for the "permanent" (idle_minutes=0) case so it survives a browser restart.
_PERMANENT_MAX_AGE = 60 * 60 * 24 * 3650


class PortfolioLocked(Exception):
    """Raised by require_unlock when a gated endpoint is hit without a valid unlock cookie."""


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


def issue(response: Response, password: str, idle_minutes: int) -> None:
    if idle_minutes <= 0:
        expiry, max_age = 0, _PERMANENT_MAX_AGE
    else:
        max_age = idle_minutes * 60
        expiry = int(time.time()) + max_age
    response.set_cookie(
        COOKIE_NAME,
        _sign(expiry, password),
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,
        samesite="lax",
    )


def clear(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)


def is_unlocked(request: Request, response: Response) -> bool:
    settings = get_settings()
    password = settings.portfolio_password
    if not password:
        return True  # feature disabled -> always unlocked
    if _valid(request.cookies.get(COOKIE_NAME), password):
        issue(response, password, settings.portfolio_lock_idle_minutes)  # sliding renewal
        return True
    return False


def require_unlock(request: Request, response: Response) -> None:
    if not is_unlocked(request, response):
        raise PortfolioLocked()
