from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any) -> dict:
    return {"success": True, "data": data, "error": None}


def fail(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "data": None, "error": message},
    )
