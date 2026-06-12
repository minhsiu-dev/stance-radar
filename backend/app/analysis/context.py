"""Derive surrounding-sentence context for a mention from transcript segments."""
from app.transcripts.client import TranscriptSegment


def surrounding_segments(
    segments: tuple[TranscriptSegment, ...],
    *,
    start_seconds: float,
) -> tuple[str | None, str | None]:
    """Return (text_before, text_after) for the segment containing start_seconds.

    Anchor segment = the last segment whose start_seconds <= start_seconds.
    "before" is the segment immediately before the anchor (None if anchor is first).
    "after"  is the segment immediately after  the anchor (None if anchor is last).
    """
    if not segments:
        return None, None
    anchor_idx = 0
    for i, seg in enumerate(segments):
        if seg.start_seconds <= start_seconds:
            anchor_idx = i
        else:
            break
    before = segments[anchor_idx - 1].text if anchor_idx > 0 else None
    after = segments[anchor_idx + 1].text if anchor_idx + 1 < len(segments) else None
    return before, after
