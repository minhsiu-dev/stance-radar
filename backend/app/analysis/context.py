"""Build a transcript excerpt around a mention's timestamp for hover display.

`quote` 現在是模型寫的「精簡摘要」(不是逐字原句),所以前端 hover 要能看到實際
講了什麼。這裡用模型回報的 start_seconds 當錨點,往前後各收約 80 字的原始字幕,
合成「一整段連續文字」——不斷句、不分 before/after、不做重疊裁切(摘要與原文是
兩種文本,沒有重複問題)。
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
