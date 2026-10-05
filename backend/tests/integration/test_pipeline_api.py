from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, update

from app.models import (
    ANALYSIS_LANE, TRANSCRIPT_LANE, Channel, PipelineLane, Stance, Video, VideoStance,
    VideoStatus, utcnow,
)
from app.pipeline import lane_store

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)
STORED = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}


def vid(vid_id, day, status, **kw) -> Video:
    return Video(
        id=vid_id, channel_id="ch", title=f"title {vid_id}",
        published_at=BASE + timedelta(days=day),
        thumbnail_url=f"https://img/{vid_id}.jpg", duration_seconds=600,
        status=status, **kw,
    )


async def seed(sessionmaker) -> None:
    now = utcnow()
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="Alpha", thumbnail_url="", uploads_playlist_id="UU"))
        s.add_all([
            vid("d1", 1, VideoStatus.discovered),
            vid("d2", 2, VideoStatus.discovered),
            vid("p-old", 3, VideoStatus.pending),
            vid("p-new", 4, VideoStatus.pending),
            vid("p-busy", 5, VideoStatus.pending, claimed_at=now - timedelta(seconds=4)),
            vid("t-queued", 6, VideoStatus.transcribed, transcript=STORED),
            vid("t-busy", 7, VideoStatus.transcribed, transcript=STORED,
                claimed_at=now - timedelta(seconds=72)),
            vid("f-fetch", 8, VideoStatus.failed),
            vid("f-llm", 9, VideoStatus.failed, transcript=STORED),
            vid("done-recent", 10, VideoStatus.analyzed, transcript=STORED,
                analyzed_at=now - timedelta(minutes=2)),
            vid("done-older", 11, VideoStatus.analyzed, transcript=STORED,
                analyzed_at=now - timedelta(hours=3)),
            vid("done-stale", 12, VideoStatus.analyzed, transcript=STORED,
                analyzed_at=now - timedelta(days=2)),
            vid("no-captions", 13, VideoStatus.no_transcript,
                last_attempt_at=now - timedelta(minutes=30)),
        ])
        await s.flush()
        s.add_all([
            VideoStance(video_id="done-recent", ticker="TSLA", stance=Stance.sell, summary="s"),
            VideoStance(video_id="done-recent", ticker="NVDA", stance=Stance.buy, summary="s"),
        ])
        await s.commit()


async def test_snapshot_counts_and_lists_every_stage(api, sessionmaker):
    _, client = api
    await seed(sessionmaker)

    resp = await client.get("/api/pipeline")
    assert resp.status_code == 200, resp.text
    stages = resp.json()["data"]["stages"]

    assert stages["select"] == {"total": 2}

    transcript = stages["transcript"]
    assert (transcript["queued"], transcript["failed"]) == (2, 1)
    assert [v["id"] for v in transcript["processing"]] == ["p-busy"]
    assert transcript["processing"][0]["claimed_at"] is not None
    assert [v["id"] for v in transcript["next"]] == ["p-new", "p-old"]  # claim order
    assert transcript["next"][0] == {
        "id": "p-new", "title": "title p-new", "thumbnail_url": "https://img/p-new.jpg",
        "channel": {"id": "ch", "title": "Alpha"},
        "published_at": (BASE + timedelta(days=4)).isoformat(),
        "duration_seconds": 600, "claimed_at": None,
    }

    analysis = stages["analysis"]
    assert (analysis["queued"], analysis["failed"]) == (1, 1)
    assert [v["id"] for v in analysis["processing"]] == ["t-busy"]
    assert [v["id"] for v in analysis["next"]] == ["t-queued"]

    done = stages["done"]
    assert done["total"] == 3  # done-stale is outside the 24h window
    assert [v["id"] for v in done["items"]] == ["done-recent", "no-captions", "done-older"]
    recent, captions, _ = done["items"]
    assert recent["status"] == "analyzed"
    assert recent["stances"] == [
        {"ticker": "NVDA", "stance": "buy"},
        {"ticker": "TSLA", "stance": "sell"},
    ]
    assert (captions["status"], captions["stances"]) == ("no_transcript", [])
    assert captions["finished_at"] is not None


async def test_next_is_capped_but_queued_counts_everything(api, sessionmaker):
    _, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="Alpha", thumbnail_url="", uploads_playlist_id="UU"))
        s.add_all([vid(f"p{i:02d}", i, VideoStatus.pending) for i in range(25)])
        await s.commit()

    transcript = (await client.get("/api/pipeline")).json()["data"]["stages"]["transcript"]
    assert transcript["queued"] == 25
    assert len(transcript["next"]) == 20


async def test_snapshot_reports_lane_health(api, sessionmaker):
    _, client = api
    now = utcnow()
    async with sessionmaker() as s:
        await s.execute(
            update(PipelineLane).where(PipelineLane.lane == TRANSCRIPT_LANE)
            .values(last_heartbeat_at=now, concurrency=1)
        )
        await s.execute(
            update(PipelineLane).where(PipelineLane.lane == ANALYSIS_LANE)
            .values(
                last_heartbeat_at=now - timedelta(minutes=5), concurrency=5,
                paused=True, pause_reason="auto", consecutive_failures=1,
                last_error="usage limit reached", last_error_at=now,
            )
        )
        await s.commit()

    lanes = (await client.get("/api/pipeline")).json()["data"]["lanes"]
    assert lanes["transcript"]["online"] is True
    assert (lanes["transcript"]["paused"], lanes["transcript"]["concurrency"]) == (False, 1)
    analysis = lanes["analysis"]
    assert analysis["online"] is False  # heartbeat older than lane_offline_seconds
    assert (analysis["paused"], analysis["pause_reason"]) == (True, "auto")
    assert analysis["last_error"] == "usage limit reached"
    assert analysis["last_heartbeat_at"] is not None


async def test_snapshot_survives_missing_lane_rows(api, sessionmaker):
    _, client = api
    async with sessionmaker() as s:
        await s.execute(delete(PipelineLane))
        await s.commit()

    resp = await client.get("/api/pipeline")
    assert resp.status_code == 200
    for lane in resp.json()["data"]["lanes"].values():
        assert lane == {
            "paused": False, "pause_reason": None, "online": False, "concurrency": None,
            "consecutive_failures": 0, "last_error": None, "last_error_at": None,
            "last_heartbeat_at": None,
        }


async def test_pause_then_resume_a_lane(api, sessionmaker):
    _, client = api
    resp = await client.post("/api/pipeline/lanes/analysis/pause")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == {"lane": "analysis", "paused": True}
    async with sessionmaker() as s:
        row = await s.get(PipelineLane, ANALYSIS_LANE)
        assert (row.paused, row.pause_reason) == (True, "manual")

    await lane_store.record_failure(sessionmaker, ANALYSIS_LANE, "quota", pause_after=1)
    resp = await client.post("/api/pipeline/lanes/analysis/resume")
    assert resp.json()["data"] == {"lane": "analysis", "paused": False}
    async with sessionmaker() as s:
        row = await s.get(PipelineLane, ANALYSIS_LANE)
    assert (row.paused, row.pause_reason, row.consecutive_failures) == (False, None, 0)
    assert row.last_error == "quota"


async def test_an_unknown_lane_is_404(api):
    _, client = api
    resp = await client.post("/api/pipeline/lanes/bogus/pause")
    assert resp.status_code == 404
    assert "bogus" in resp.json()["error"]


async def test_lane_controls_require_admin(locked_api):
    _, client = locked_api
    for action in ("pause", "resume"):
        resp = await client.post(f"/api/pipeline/lanes/transcript/{action}")
        assert resp.status_code == 401


async def test_the_snapshot_is_readable_without_unlocking(locked_api):
    _, client = locked_api
    assert (await client.get("/api/pipeline")).status_code == 200
