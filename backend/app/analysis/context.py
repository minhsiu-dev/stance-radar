"""Derive surrounding context for a mention from transcript segments."""
import re

from app.transcripts.client import TranscriptSegment

DEFAULT_MAX_CHARS = 160


def _normalize(text: str) -> str:
    return re.sub(r"[^\w]", "", text, flags=re.UNICODE).lower()


def _collect(
    segments: tuple[TranscriptSegment, ...],
    indices: range,
    max_chars: int,
) -> str | None:
    parts: list[str] = []
    total = 0
    for i in indices:
        parts.append(segments[i].text)
        total += len(segments[i].text)
        if total >= max_chars:
            break
    if not parts:
        return None
    ordered = list(reversed(parts)) if indices.step < 0 else parts
    return " ".join(ordered)


def _quote_end_index(
    segments: tuple[TranscriptSegment, ...],
    anchor_idx: int,
    quote: str,
) -> int:
    """Quote 可能橫跨多個 segment;回傳 quote 涵蓋的最後一個 segment index。"""
    normalized_quote = _normalize(quote)
    end = anchor_idx
    while end + 1 < len(segments):
        seg_text = _normalize(segments[end + 1].text)
        if len(seg_text) >= 2 and seg_text in normalized_quote:
            end += 1
        else:
            break
    return end


def surrounding_segments(
    segments: tuple[TranscriptSegment, ...],
    *,
    start_seconds: float,
    quote: str = "",
    max_chars: int = DEFAULT_MAX_CHARS,
) -> tuple[str | None, str | None]:
    """Return (text_before, text_after) surrounding the quoted mention.

    Anchor segment = the last segment whose start_seconds <= start_seconds.
    Segments covered by the quote itself are excluded so the "after" context
    doesn't repeat quote text. Each side accumulates whole segments until
    ~max_chars so short auto-caption fragments form coherent context.
    """
    if not segments:
        return None, None
    anchor_idx = 0
    for i, seg in enumerate(segments):
        if seg.start_seconds <= start_seconds:
            anchor_idx = i
        else:
            break
    end_idx = _quote_end_index(segments, anchor_idx, quote) if quote else anchor_idx
    before = _collect(segments, range(anchor_idx - 1, -1, -1), max_chars)
    after = _collect(segments, range(end_idx + 1, len(segments)), max_chars)
    return before, after
