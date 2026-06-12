from app.market.cache import TTLCache


def make_clock(start: float = 0.0):
    state = {"now": start}

    def clock() -> float:
        return state["now"]

    return clock, state


def test_get_before_expiry_returns_value():
    clock, state = make_clock()
    cache = TTLCache(ttl_seconds=10, clock=clock)
    cache.set("k", {"v": 1})
    state["now"] = 9.9
    assert cache.get("k") == {"v": 1}


def test_get_after_expiry_returns_none():
    clock, state = make_clock()
    cache = TTLCache(ttl_seconds=10, clock=clock)
    cache.set("k", "v")
    state["now"] = 10.0
    assert cache.get("k") is None


def test_missing_key_returns_none():
    cache = TTLCache(ttl_seconds=10)
    assert cache.get("nope") is None
