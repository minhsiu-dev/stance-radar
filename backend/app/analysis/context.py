"""Build a transcript excerpt around a mention's timestamp for hover display.

`quote` is the model's verbatim excerpt of the original sentence (may be truncated);
on hover we show a fuller context. Here we use the model-reported start_seconds as the
anchor, collect roughly 80 characters of raw captions on each side, and merge them into
a single continuous passage -- no sentence splitting, no before/after split, no overlap
trimming.
"""
from app.transcripts.client import TranscriptSegment

DEFAULT_MAX_CHARS_EACH_SIDE = 80


def excerpt_around(
    segments: tuple[TranscriptSegment, ...],
    *,
    start_seconds: float,
    max_chars_each_side: int = DEFAULT_MAX_CHARS_EACH_SIDE,
) -> str | None:
    """Return one continuous transcript passage around the mention.

    Anchor = the last segment whose start_seconds <= start_seconds. The anchor
    segment is included (so the actual spoken words are shown), then we expand
    outward collecting whole raw caption segments until ~max_chars_each_side on
    each side, and join everything into a single string.
    """
    if not segments:
        return None
    anchor_idx = 0
    for i, seg in enumerate(segments):
        if seg.start_seconds <= start_seconds:
            anchor_idx = i
        else:
            break

    start_idx = anchor_idx
    total = 0
    while start_idx - 1 >= 0 and total < max_chars_each_side:
        start_idx -= 1
        total += len(segments[start_idx].text)

    end_idx = anchor_idx
    total = 0
    while end_idx + 1 < len(segments) and total < max_chars_each_side:
        end_idx += 1
        total += len(segments[end_idx].text)

    merged = " ".join(segments[i].text for i in range(start_idx, end_idx + 1)).strip()
    return merged or None
