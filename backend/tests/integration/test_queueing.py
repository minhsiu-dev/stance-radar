from datetime import datetime, timezone

from app.models import Channel, Video, VideoStatus
from app.pipeline.queueing import requeue_ids

STORED = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}


async def test_requeue_routes_by_transcript_presence_and_clears_errors(sessionmaker):
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        for vid_id, transcript in (("bare", None), ("stored", STORED), ("untouched", None)):
            s.add(Video(
                id=vid_id, channel_id="ch", title=vid_id,
                published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
                thumbnail_url="", status=VideoStatus.failed,
                transcript=transcript, error_message="boom",
            ))
        await s.commit()

    async with sessionmaker() as s:
        await requeue_ids(s, ["bare", "stored"])
        await s.commit()

    async with sessionmaker() as s:
        bare = await s.get(Video, "bare")
        stored = await s.get(Video, "stored")
        untouched = await s.get(Video, "untouched")
    assert (bare.status, bare.error_message) == (VideoStatus.pending, None)
    assert (stored.status, stored.error_message) == (VideoStatus.transcribed, None)
    assert (untouched.status, untouched.error_message) == (VideoStatus.failed, "boom")
