from sqlalchemy import select

from app.models import Job, JobStatus, Video, VideoStatus
from tests.conftest import wait_refresh


async def _analyze_job(session) -> Job:
    return (await session.execute(
        select(Job).where(Job.kind == "analyze")
    )).scalars().one()


async def test_job_marked_failed_when_every_video_fails(api, session, monkeypatch):
    """A run where nothing succeeded is a failed run, not a silent `done`."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    runner = app.state.runner

    async def always_fail(video_id: str) -> None:
        raise RuntimeError("claude exited 1: boom")

    monkeypatch.setattr(runner, "_process_video", always_fail)

    await client.post("/api/videos/analyze", json={"video_ids": ["alpha_vid_3"]})
    await wait_refresh(app)

    job = await _analyze_job(session)
    assert job.status == JobStatus.failed
    # the real per-video cause has to reach the job, not be replaced by a generic message
    assert "claude exited 1: boom" in (job.error_message or "")


async def test_partial_failure_keeps_job_done_and_counts_it(api, session, monkeypatch):
    """One bad video among several is normal: the job stays `done` but says so."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    runner = app.state.runner
    original = runner._process_video

    async def fail_only_vid_2(video_id: str) -> None:
        if video_id == "alpha_vid_2":
            raise RuntimeError("claude exited 1: boom")
        await original(video_id)

    monkeypatch.setattr(runner, "_process_video", fail_only_vid_2)

    await client.post(
        "/api/videos/analyze",
        json={"video_ids": ["alpha_vid_1", "alpha_vid_2", "alpha_vid_3"]},
    )
    await wait_refresh(app)

    job = await _analyze_job(session)
    assert job.status == JobStatus.done
    assert job.progress["videos_done"] == 3
    assert job.progress["videos_failed"] == 1


async def test_no_transcript_is_not_a_failure(api, session):
    """`no_transcript` is a legitimate outcome; it must not mark the run failed."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_beta"})
    await wait_refresh(app)

    await client.post("/api/videos/analyze", json={"video_ids": ["beta_vid_1"]})
    await wait_refresh(app)

    v = await session.get(Video, "beta_vid_1")
    await session.refresh(v)
    assert v.status == VideoStatus.no_transcript

    job = await _analyze_job(session)
    assert job.status == JobStatus.done
    assert job.progress["videos_failed"] == 0
