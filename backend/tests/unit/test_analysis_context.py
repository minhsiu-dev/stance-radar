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


def test_accumulates_short_segments_for_coherent_context():
    # YouTube 自動字幕的 segment 很短;單一 segment 當 context 會支離破碎。
    segs = (
        _seg(0.0,  "we were"),
        _seg(1.0,  "talking about"),
        _seg(2.0,  "big tech earnings"),
        _seg(3.0,  "Nvidia is the anchor here"),
        _seg(4.0,  "and the data"),
        _seg(5.0,  "center demand"),
        _seg(6.0,  "keeps growing fast"),
    )
    before, after = surrounding_segments(segs, start_seconds=3.0)
    assert before == "we were talking about big tech earnings"
    assert after == "and the data center demand keeps growing fast"


def test_caps_context_length():
    segs = tuple(_seg(float(i), f"sentence number {i} padding words") for i in range(40))
    before, after = surrounding_segments(segs, start_seconds=20.0, max_chars=60)
    assert before is not None and after is not None
    # 至少一個 segment,且不會無限制累積
    assert len(before) <= 60 + len("sentence number 00 padding words")
    assert len(after) <= 60 + len("sentence number 00 padding words")


def test_skips_segments_covered_by_quote():
    # quote 橫跨多個 segment 時,context_after 不應重複 quote 內容。
    segs = (
        _seg(0.0,  "先講一下背景"),
        _seg(5.0,  "輝達這季財報很強"),
        _seg(8.0,  "我會繼續加碼買進"),
        _seg(12.0, "接下來看特斯拉"),
    )
    before, after = surrounding_segments(
        segs, start_seconds=5.0, quote="輝達這季財報很強,我會繼續加碼買進",
    )
    assert before == "先講一下背景"
    assert after == "接下來看特斯拉"


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
