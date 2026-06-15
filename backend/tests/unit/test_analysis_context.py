from app.analysis.context import excerpt_around
from app.transcripts.client import TranscriptSegment


def _seg(start: float, text: str) -> TranscriptSegment:
    return TranscriptSegment(start_seconds=start, text=text)


def test_empty_segments_returns_none():
    assert excerpt_around((), start_seconds=0.0) is None


def test_includes_anchor_and_immediate_neighbours_merged():
    segs = (
        _seg(0.0, "Intro talk"),
        _seg(5.0, "Anchor sentence here"),
        _seg(10.0, "Follow-up sentence"),
    )
    out = excerpt_around(segs, start_seconds=5.0)
    # one continuous block of text: includes the anchor itself plus its neighbours
    assert out == "Intro talk Anchor sentence here Follow-up sentence"


def test_accumulates_short_segments_up_to_limit_each_side():
    segs = (
        _seg(0.0, "we were"),
        _seg(1.0, "talking about"),
        _seg(2.0, "big tech earnings"),
        _seg(3.0, "Nvidia is the anchor here"),
        _seg(4.0, "and the data"),
        _seg(5.0, "center demand"),
        _seg(6.0, "keeps growing fast"),
    )
    out = excerpt_around(segs, start_seconds=3.0, max_chars_each_side=40)
    assert "Nvidia is the anchor here" in out
    assert "big tech earnings" in out  # before side
    assert "center demand" in out  # after side


def test_caps_each_side_by_char_budget():
    segs = tuple(_seg(float(i), f"seg{i:02d}") for i in range(40))
    out = excerpt_around(segs, start_seconds=20.0, max_chars_each_side=10)
    # does not accumulate the entire transcript without limit
    assert "seg20" in out
    assert "seg00" not in out
    assert "seg39" not in out


def test_anchor_at_start_has_no_preceding():
    segs = (_seg(0.0, "First"), _seg(4.0, "Second"))
    out = excerpt_around(segs, start_seconds=0.0)
    assert out == "First Second"


def test_anchor_at_end_has_no_following():
    segs = (_seg(0.0, "First"), _seg(4.0, "Second"))
    out = excerpt_around(segs, start_seconds=4.0)
    assert out == "First Second"


def test_anchor_between_segments_uses_nearest_preceding():
    segs = (
        _seg(0.0, "First"),
        _seg(10.0, "Second"),
        _seg(20.0, "Third"),
    )
    out = excerpt_around(segs, start_seconds=14.5, max_chars_each_side=5)
    # anchor lands on Second: includes the preceding First and following Third
    assert out == "First Second Third"
