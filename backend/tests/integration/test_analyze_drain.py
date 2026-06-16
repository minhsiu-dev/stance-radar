from sqlalchemy import select

from app.models import Job, Video, VideoStatus
from tests.conftest import wait_refresh


async def test_analyze_folds_in_videos_queued_mid_run(api, session, monkeypatch):
    """A video set to `pending` while an analyze job is running is processed by the
    SAME job (drain loop), and the final progress counter reflects both."""
    app, client = api
    # Discover ingests alpha_vid_1/2/3 as `discovered` (alpha_short is filtered).
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    runner = app.state.runner
    original = runner._process_video
    state = {"injected": False}

    async def patched(video_id: str) -> None:
        # On the first processed video, queue a second one mid-run.
        if not state["injected"]:
            state["injected"] = True
            async with runner._deps.sessionmaker() as s:
                v = await s.get(Video, "alpha_vid_2")
                v.status = VideoStatus.pending
                await s.commit()
        await original(video_id)

    monkeypatch.setattr(runner, "_process_video", patched)

    # Queue only alpha_vid_3; alpha_vid_2 is queued mid-run by the patch.
    await client.post("/api/videos/analyze", json={"video_ids": ["alpha_vid_3"]})
    await wait_refresh(app)

    v2 = await session.get(Video, "alpha_vid_2")
    v3 = await session.get(Video, "alpha_vid_3")
    await session.refresh(v2)
    await session.refresh(v3)
    assert v3.status == VideoStatus.analyzed
    assert v2.status == VideoStatus.analyzed  # the mid-run arrival got processed

    analyze_jobs = (await session.execute(
        select(Job).where(Job.kind == "analyze")
    )).scalars().all()
    assert len(analyze_jobs) == 1  # one job handled both, not a second job
    prog = analyze_jobs[0].progress
    assert prog["videos_done"] == 2
    assert prog["videos_total"] == 2  # counter grew to include the late arrival
