from datetime import datetime, timezone

from app.models import Channel, Video, VideoStatus


async def seed_failures(sessionmaker) -> None:
    """Two channels, five failed videos:
      ch-a: f-a1 (no transcript, 1 attempt), f-a2 (no transcript, 5 attempts),
            f-a3 (transcript stored, 2 attempts)
      ch-b: f-b1 (transcript stored, 1 attempt)
      plus one analyzed video that must never show up.
    """
    def vid(vid_id, ch, day, *, transcript, attempts, status=VideoStatus.failed):
        return Video(
            id=vid_id, channel_id=ch, title=f"title {vid_id}",
            published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=600, status=status,
            transcript=transcript, analysis_attempts=attempts,
            error_message="boom" if status == VideoStatus.failed else None,
        )

    stored = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}
    async with sessionmaker() as s:
        s.add(Channel(id="ch-a", title="Alpha", thumbnail_url="", uploads_playlist_id="UUa"))
        s.add(Channel(id="ch-b", title="Beta", thumbnail_url="", uploads_playlist_id="UUb"))
        s.add(vid("f-a1", "ch-a", 1, transcript=None, attempts=1))
        s.add(vid("f-a2", "ch-a", 2, transcript=None, attempts=5))
        s.add(vid("f-a3", "ch-a", 3, transcript=stored, attempts=2))
        s.add(vid("f-b1", "ch-b", 4, transcript=stored, attempts=1))
        s.add(vid("ok-1", "ch-b", 5, transcript=stored, attempts=1,
                  status=VideoStatus.analyzed))
        await s.commit()


async def test_summary_splits_on_transcript_presence(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    data = (await client.get("/api/videos/failures")).json()["data"]
    by_kind = {g["kind"]: g for g in data["groups"]}
    assert by_kind["transcript"]["total"] == 2   # f-a1, f-a2
    assert by_kind["analysis"]["total"] == 2     # f-a3, f-b1
    assert data["total"] == 4                    # the analyzed video is excluded
    assert [c["id"] for c in data["channels"]] == ["ch-a", "ch-b"]  # 3 then 1
    assert data["channels"][0] == {"id": "ch-a", "title": "Alpha", "total": 3}


async def test_summary_returns_both_groups_even_when_one_is_empty(api, sessionmaker):
    _, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch-c", title="C", thumbnail_url="", uploads_playlist_id="UUc"))
        s.add(Video(
            id="only", channel_id="ch-c", title="t",
            published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.failed,
            transcript=None, analysis_attempts=1, error_message="boom",
        ))
        await s.commit()

    data = (await client.get("/api/videos/failures")).json()["data"]
    assert [g["kind"] for g in data["groups"]] == ["transcript", "analysis"]
    assert [g["total"] for g in data["groups"]] == [1, 0]


async def test_max_attempts_narrows_retryable_only_and_is_strict(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    data = (await client.get(
        "/api/videos/failures", params={"max_attempts": 2}
    )).json()["data"]
    by_kind = {g["kind"]: g for g in data["groups"]}
    # transcript: f-a1 (1) counts, f-a2 (5) does not
    assert by_kind["transcript"] == {"kind": "transcript", "total": 2, "retryable": 1}
    # analysis: f-b1 (1) counts, f-a3 (2) does NOT -- strict less-than
    assert by_kind["analysis"] == {"kind": "analysis", "total": 2, "retryable": 1}


async def test_summary_is_not_swallowed_by_the_video_id_route(api, sessionmaker):
    """Regression: /{video_id} is a catch-all declared later in the same router."""
    _, client = api
    await seed_failures(sessionmaker)
    resp = await client.get("/api/videos/failures")
    assert resp.status_code == 200
    assert "groups" in resp.json()["data"]


async def test_items_shape_and_ordering(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    data = (await client.get("/api/videos/failures/items")).json()["data"]
    assert data["total"] == 4
    assert data["page"] == 1
    assert [i["id"] for i in data["items"]] == ["f-b1", "f-a3", "f-a2", "f-a1"]
    row = data["items"][0]
    assert row["channel"] == {"id": "ch-b", "title": "Beta"}
    assert row["error_message"] == "boom"
    assert row["analysis_attempts"] == 1
    assert row["last_attempt_at"] is None
    assert row["duration_seconds"] == 600


async def test_items_kind_and_channel_filters(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    transcript = (await client.get(
        "/api/videos/failures/items", params={"kind": "transcript"}
    )).json()["data"]
    assert [i["id"] for i in transcript["items"]] == ["f-a2", "f-a1"]

    ch_a = (await client.get(
        "/api/videos/failures/items", params={"channel_id": "ch-a"}
    )).json()["data"]
    assert ch_a["total"] == 3
    assert {i["channel"]["id"] for i in ch_a["items"]} == {"ch-a"}


async def test_items_paginate(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    page1 = (await client.get(
        "/api/videos/failures/items", params={"page": 1, "page_size": 2}
    )).json()["data"]
    page2 = (await client.get(
        "/api/videos/failures/items", params={"page": 2, "page_size": 2}
    )).json()["data"]
    assert [i["id"] for i in page1["items"]] == ["f-b1", "f-a3"]
    assert [i["id"] for i in page2["items"]] == ["f-a2", "f-a1"]
    assert page2["total"] == 4


async def test_items_paginate_stable_when_published_at_ties(api, sessionmaker):
    """Two-plus failed videos can share the same published_at (same-day
    uploads); the retry queue pages through them by clicking a button on each
    row, so paging must be gapless and duplicate-free even when published_at
    alone does not fully order the rows.

    Seeded out of id order (z, m, a) so that whatever order an unordered-tie
    query happens to fall back on does NOT coincidentally match the
    `Video.id.asc()` order asserted below. Without that tiebreaker clause,
    SQL gives no order guarantee among rows with equal published_at, so this
    exact sequence has no basis to hold -- passing would be an accident of
    Postgres internals, not a query contract. (Verified directly: with the
    `Video.id.asc()` clause removed from the query, this test fails --
    `assert ['tie-z', 'tie-m', 'tie-a'] == ['tie-a', 'tie-m', 'tie-z']` --
    because a plain seq scan returns insertion order for ties; with the
    clause restored it passes.)
    """
    same_ts = datetime(2026, 6, 10, tzinfo=timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="ch-tie", title="Tie", thumbnail_url="", uploads_playlist_id="UUt"))
        for vid_id in ("tie-z", "tie-m", "tie-a"):  # inserted out of id order on purpose
            s.add(Video(
                id=vid_id, channel_id="ch-tie", title=f"title {vid_id}",
                published_at=same_ts, thumbnail_url="", duration_seconds=60,
                status=VideoStatus.failed, transcript=None, analysis_attempts=1,
                error_message="boom",
            ))
        await s.commit()

    _, client = api
    seen = []
    for page in (1, 2, 3):
        data = (await client.get(
            "/api/videos/failures/items",
            params={"channel_id": "ch-tie", "page": page, "page_size": 1},
        )).json()["data"]
        seen.extend(i["id"] for i in data["items"])
    assert seen == ["tie-a", "tie-m", "tie-z"]


async def test_items_rejects_unknown_kind(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)
    resp = await client.get("/api/videos/failures/items", params={"kind": "bogus"})
    assert resp.status_code == 400
    assert resp.json()["success"] is False


async def test_retry_requeues_only_the_matching_subset(api, session, sessionmaker):
    from tests.conftest import wait_refresh

    app, client = api
    await seed_failures(sessionmaker)

    resp = await client.post(
        "/api/videos/failures/retry", json={"kind": "analysis"}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["queued"] == 2      # f-a3, f-b1
    assert data["created"] is True
    await wait_refresh(app)

    # untouched: the transcript-class failures keep their status AND their error
    a1 = await session.get(Video, "f-a1")
    await session.refresh(a1)
    assert a1.status == VideoStatus.failed
    assert a1.error_message == "boom"
    assert a1.analysis_attempts == 1


async def test_retry_preserves_the_attempt_counter(api, session, sessionmaker):
    from tests.conftest import wait_refresh

    app, client = api
    await seed_failures(sessionmaker)

    await client.post("/api/videos/failures/retry", json={"kind": "analysis"})
    await wait_refresh(app)

    # f-a3 started at 2; the retry itself is one more attempt -> 3, never reset to 0
    a3 = await session.get(Video, "f-a3")
    await session.refresh(a3)
    assert a3.analysis_attempts == 3


async def test_retry_honours_the_attempt_threshold(api, session, sessionmaker):
    from tests.conftest import wait_refresh

    app, client = api
    await seed_failures(sessionmaker)

    resp = await client.post(
        "/api/videos/failures/retry", json={"kind": "transcript", "max_attempts": 2}
    )
    assert resp.json()["data"]["queued"] == 1   # f-a1 (1 attempt), not f-a2 (5)
    await wait_refresh(app)

    a2 = await session.get(Video, "f-a2")
    await session.refresh(a2)
    assert a2.analysis_attempts == 5            # the residue was left alone


async def test_retry_matching_nothing_starts_no_job(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    resp = await client.post(
        "/api/videos/failures/retry", json={"kind": "transcript", "max_attempts": 1}
    )
    data = resp.json()["data"]
    assert data == {"queued": 0, "job_id": None, "created": False}
    assert (await client.get("/api/jobs/current")).status_code == 204


async def test_retry_rejects_unknown_kind(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)
    resp = await client.post("/api/videos/failures/retry", json={"kind": "bogus"})
    assert resp.status_code == 400
    assert resp.json()["success"] is False


async def test_retry_requires_admin(locked_api, sessionmaker):
    _, client = locked_api
    await seed_failures(sessionmaker)
    resp = await client.post("/api/videos/failures/retry", json={"kind": "analysis"})
    assert resp.status_code == 401


async def test_summary_channel_id_scopes_group_totals(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    scoped = (await client.get(
        "/api/videos/failures", params={"channel_id": "ch-a"}
    )).json()["data"]
    by_kind = {g["kind"]: g for g in scoped["groups"]}
    # ch-a only: f-a1, f-a2 (transcript); f-a3 (analysis) -- f-b1 excluded
    assert by_kind["transcript"]["total"] == 2
    assert by_kind["analysis"]["total"] == 1
    assert scoped["total"] == 3

    unfiltered = (await client.get("/api/videos/failures")).json()["data"]
    by_kind_all = {g["kind"]: g for g in unfiltered["groups"]}
    assert by_kind_all["transcript"]["total"] == 2
    assert by_kind_all["analysis"]["total"] == 2


async def test_summary_channels_list_does_not_collapse_when_filtered(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    unfiltered = (await client.get("/api/videos/failures")).json()["data"]
    scoped = (await client.get(
        "/api/videos/failures", params={"channel_id": "ch-a"}
    )).json()["data"]
    assert scoped["channels"] == unfiltered["channels"]
    assert [c["id"] for c in scoped["channels"]] == ["ch-a", "ch-b"]


async def test_summary_retryable_matches_what_retry_actually_queues(api, sessionmaker):
    _, client = api
    await seed_failures(sessionmaker)

    summary = (await client.get(
        "/api/videos/failures", params={"channel_id": "ch-a", "max_attempts": 2}
    )).json()["data"]
    by_kind = {g["kind"]: g for g in summary["groups"]}
    retryable = by_kind["transcript"]["retryable"]  # f-a1 (1 attempt); f-a2 (5) excluded

    resp = await client.post(
        "/api/videos/failures/retry",
        json={"kind": "transcript", "channel_id": "ch-a", "max_attempts": 2},
    )
    assert resp.json()["data"]["queued"] == retryable
