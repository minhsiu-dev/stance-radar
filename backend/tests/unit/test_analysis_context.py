from app.analysis.context import surrounding_segments
from app.transcripts.client import TranscriptSegment


def _seg(start: float, text: str) -> TranscriptSegment:
    return TranscriptSegment(start_seconds=start, text=text)


def test_returns_immediate_neighbours():
    segs = (
        _seg(0.0,  "Intro talk"),
        _seg(5.0,  "Quote anchor"),
        _seg(10.0, "Follow-up sentence"),
    )
    before, after = surrounding_segments(segs, start_seconds=5.0)
    assert before == "Intro talk"
    assert after == "Follow-up sentence"


def test_handles_anchor_at_start():
    segs = (_seg(0.0, "First"), _seg(4.0, "Second"))
    before, after = surrounding_segments(segs, start_seconds=0.0)
    assert before is None
    assert after == "Second"


def test_handles_anchor_at_end():
    segs = (_seg(0.0, "First"), _seg(4.0, "Second"))
    before, after = surrounding_segments(segs, start_seconds=4.0)
    assert before == "First"
    assert after is None


def test_anchor_between_segments_uses_nearest_preceding():
    segs = (
        _seg(0.0,  "First"),
        _seg(10.0, "Second"),
        _seg(20.0, "Third"),
    )
    before, after = surrounding_segments(segs, start_seconds=14.5)
    # Anchor falls within Second segment's window → before=First, after=Third
    assert before == "First"
    assert after == "Third"


def test_empty_segments_returns_pair_of_nones():
    assert surrounding_segments((), start_seconds=0.0) == (None, None)
