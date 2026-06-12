import json

from app.envelope import fail, ok


def test_ok_wraps_data():
    assert ok({"a": 1}) == {"success": True, "data": {"a": 1}, "error": None}


def test_fail_builds_json_response():
    resp = fail("channel not found", status_code=404)
    assert resp.status_code == 404
    body = json.loads(resp.body)
    assert body == {"success": False, "data": None, "error": "channel not found"}
