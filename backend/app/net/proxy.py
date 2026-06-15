import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx

T = TypeVar("T")


class ProxyRotator:
    """Rotate the gluetun VPN exit IP via its control server.

    A no-op when control_url is empty (e.g. the VPN override is not active), so the
    same code path works with and without the VPN.
    """

    def __init__(
        self,
        control_url: str = "",
        *,
        poll_interval: float = 2.0,
        max_polls: int = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._control_url = control_url.rstrip("/")
        self._poll_interval = poll_interval
        self._max_polls = max_polls
        self._transport = transport

    async def _current_ip(self, client: httpx.AsyncClient) -> str | None:
        try:
            resp = await client.get(f"{self._control_url}/v1/publicip/ip")
            return resp.json().get("public_ip")
        except Exception:
            return None

    async def rotate(self) -> None:
        if not self._control_url:
            return
        async with httpx.AsyncClient(transport=self._transport, timeout=10) as client:
            before = await self._current_ip(client)
            # Restart the OpenVPN tunnel -> gluetun reconnects to a (random) server
            # from SERVER_COUNTRIES, usually yielding a fresh exit IP.
            await client.put(
                f"{self._control_url}/v1/openvpn/status", json={"status": "stopped"}
            )
            await client.put(
                f"{self._control_url}/v1/openvpn/status", json={"status": "running"}
            )
            for _ in range(self._max_polls):
                await asyncio.sleep(self._poll_interval)
                now = await self._current_ip(client)
                if now and now != before:
                    return


async def with_rotation(
    fetch: Callable[[], Awaitable[T]],
    is_blocked: Callable[[BaseException], bool],
    rotator: ProxyRotator,
    max_rotations: int = 3,
) -> T:
    """Run fetch(); on a 'blocked' exception, rotate the exit IP and retry.

    Up to max_rotations retries. Non-block exceptions propagate immediately.
    """
    for attempt in range(max_rotations + 1):
        try:
            return await fetch()
        except BaseException as exc:  # noqa: BLE001 - re-raised unless it's a block
            if attempt < max_rotations and is_blocked(exc):
                await rotator.rotate()
                continue
            raise
