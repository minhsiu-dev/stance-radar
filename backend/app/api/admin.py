import asyncio
import hmac

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.auth import clear, is_admin, issue
from app.config import get_settings
from app.envelope import fail, ok

router = APIRouter(prefix="/api/admin")

_WRONG_PASSWORD_DELAY = 0.3


class UnlockBody(BaseModel):
    password: str


@router.post("/unlock")
async def unlock(body: UnlockBody, response: Response):
    password = get_settings().admin_password
    if not password:
        return fail("Admin lock is not configured", status_code=401)
    if not hmac.compare_digest(body.password.encode(), password.encode()):
        await asyncio.sleep(_WRONG_PASSWORD_DELAY)  # mild anti-guess
        return fail("Wrong password", status_code=401)
    issue(response, password, get_settings().admin_session_minutes)
    return ok({"authenticated": True})


@router.post("/lock")
async def lock(response: Response):
    clear(response)
    return ok({"authenticated": False})


@router.get("/session")
async def session_status(request: Request, response: Response):
    password = get_settings().admin_password
    return ok({
        "enabled": bool(password),
        "authenticated": is_admin(request, response),
    })
