from datetime import datetime, timezone

from app.models import Video, VideoStatus
from app.scripts.reanalyze_stale import reanalyze_stale
from app.transcripts.client import TranscriptNotAvailable
from tests.conftest import wait_refresh

OLD = datetime(2020, 1, 1, tzinfo=timezone.utc)
RECENT = datetime(2026, 6, 1, tzinfo=timezone.utc)
CUTOFF = datetime(2026, 1, 1, tzinfo=timezone.utc)


async def _analyze_alpha(app, client):
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    await client.post("/api/videos/analyze",
                      json={"video_ids": ["alpha_vid_2", "alpha_vid_3"]})
    await wait_refresh(app)


async def test_selects_only_stale_analyzed_and_is_resumable(api, session):
    app, client = api
    await _analyze_alpha(app, client)
    runner = app.state.runner

    v3 = await session.get(Video, "alpha_vid_3")
    v2 = await session.get(Video, "alpha_vid_2")
    v3.analyzed_at = OLD        # stale -> should be re-analyzed
    v2.analyzed_at = RECENT     # fresh -> left alone
    await session.commit()

    counts = await reanalyze_stale(runner, before=CUTOFF, limit=None, sleep=0.0)
    assert counts["ok"] == 1

    await session.refresh(v3)
    await session.refresh(v2)
    assert v3.analyzed_at > CUTOFF          # advanced past the cutoff -> left the set
    assert v2.analyzed_at == RECENT         # untouched

    # Resumable / idempotent: a second run now selects nothing.
    again = await reanalyze_stale(runner, before=CUTOFF, limit=None, sleep=0.0)
    assert again == {"ok": 0, "no_transcript": 0, "failed": 0, "retry_later": 0}


async def test_transient_failure_leaves_video_stale(api, session, monkeypatch):
    app, client = api
    await _analyze_alpha(app, client)
    runner = app.state.runner

    v3 = await session.get(Video, "alpha_vid_3")
    v3.analyzed_at = OLD
    v3.transcript = None        # simulate a pre-persistence video -> forces a fetch
    await session.commit()

    async def blocked(video_id):
        raise RuntimeError("simulated rate-limit block")

    monkeypatch.setattr(runner._deps.transcripts, "fetch", blocked)
    counts = await reanalyze_stale(runner, before=CUTOFF, limit=None, sleep=0.0)

    assert counts["retry_later"] == 1
    await session.refresh(v3)
    assert v3.status == VideoStatus.analyzed     # not marked failed/no_transcript
    assert v3.analyzed_at == OLD                 # unchanged -> still selectable next run


async def test_permanent_no_transcript_exits_the_set(api, session, monkeypatch):
    app, client = api
    await _analyze_alpha(app, client)
    runner = app.state.runner

    v3 = await session.get(Video, "alpha_vid_3")
    v3.analyzed_at = OLD
    v3.transcript = None
    await session.commit()

    async def gone(video_id):
        raise TranscriptNotAvailable(video_id)

    monkeypatch.setattr(runner._deps.transcripts, "fetch", gone)
    counts = await reanalyze_stale(runner, before=CUTOFF, limit=None, sleep=0.0)

    assert counts["no_transcript"] == 1
    await session.refresh(v3)
    assert v3.status == VideoStatus.no_transcript   # status changed -> left the set
