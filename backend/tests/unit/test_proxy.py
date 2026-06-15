import httpx
import pytest

from app.net.proxy import ProxyRotator, with_rotation


class Blocked(Exception):
    pass


class FakeRotator:
    def __init__(self):
        self.rotations = 0

    async def rotate(self):
        self.rotations += 1


def is_blocked(exc):
    return isinstance(exc, Blocked)


async def test_with_rotation_success_no_rotation():
    r = FakeRotator()
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return "ok"

    assert await with_rotation(fetch, is_blocked, r, max_rotations=3) == "ok"
    assert r.rotations == 0 and calls == 1


async def test_with_rotation_blocked_then_success():
    r = FakeRotator()
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise Blocked()
        return "ok"

    assert await with_rotation(fetch, is_blocked, r, max_rotations=3) == "ok"
    assert r.rotations == 1 and calls == 2


async def test_with_rotation_persistent_block_gives_up():
    r = FakeRotator()

    async def fetch():
        raise Blocked()

    with pytest.raises(Blocked):
        await with_rotation(fetch, is_blocked, r, max_rotations=2)
    assert r.rotations == 2


async def test_with_rotation_non_block_error_no_rotation():
    r = FakeRotator()

    async def fetch():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        await with_rotation(fetch, is_blocked, r, max_rotations=3)
    assert r.rotations == 0


async def test_rotator_empty_control_url_is_noop():
    await ProxyRotator("").rotate()


async def test_rotator_restarts_and_waits_for_new_ip():
    ips = iter(["1.1.1.1", "1.1.1.1", "2.2.2.2"])
    seen = {"stopped": 0, "running": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/publicip/ip":
            return httpx.Response(200, json={"public_ip": next(ips)})
        if request.url.path == "/v1/openvpn/status":
            body = request.content.decode()
            if "stopped" in body:
                seen["stopped"] += 1
            elif "running" in body:
                seen["running"] += 1
            return httpx.Response(200, json={"outcome": "ok"})
        return httpx.Response(404)

    r = ProxyRotator(
        "http://gluetun:8000",
        poll_interval=0,
        max_polls=5,
        transport=httpx.MockTransport(handler),
    )
    await r.rotate()
    assert seen["stopped"] == 1 and seen["running"] == 1
    # the iterator must be fully consumed: before(1.1.1.1) + 2 polls (1.1.1.1, 2.2.2.2)
    with pytest.raises(StopIteration):
        next(ips)


async def test_rotator_ip_never_changes_exhausts_polls():
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/publicip/ip":
            polls["n"] += 1
            return httpx.Response(200, json={"public_ip": "9.9.9.9"})
        if request.url.path == "/v1/openvpn/status":
            return httpx.Response(200, json={"outcome": "ok"})
        return httpx.Response(404)

    r = ProxyRotator(
        "http://gluetun:8000",
        poll_interval=0,
        max_polls=3,
        transport=httpx.MockTransport(handler),
    )
    await r.rotate()  # must return without error even though the IP never changes
    # 1 read for `before` + exactly max_polls (3) poll reads = 4
    assert polls["n"] == 4
