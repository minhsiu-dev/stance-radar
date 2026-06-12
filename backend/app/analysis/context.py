"""Derive surrounding context for a mention from transcript segments."""
import re

from app.transcripts.client import TranscriptSegment

DEFAULT_MAX_CHARS = 160


def _normalize(text: str) -> str:
    return re.sub(r"[^\w]", "", text, flags=re.UNICODE).lower()


# 裁切門檻:單一主題詞在句界自然重複(「…we mention Duolingo.」+ quote
# 「Duolingo is down…」)不該被砍,所以拉丁文字要求片語等級的重疊;
# CJK 沒有空格、單字資訊量高,門檻較低(如「我會買」)。
_MIN_OVERLAP_LATIN = 10
_MIN_OVERLAP_CJK = 3


def _overlap_long_enough(overlap: str) -> bool:
    has_cjk = any("一" <= ch <= "鿿" for ch in overlap)
    return len(overlap) >= (_MIN_OVERLAP_CJK if has_cjk else _MIN_OVERLAP_LATIN)


def _normalize_with_map(text: str) -> tuple[str, list[int]]:
    """回傳 (正規化字串, 各字元在原文的 index),供重疊裁切換算位置。"""
    chars: list[str] = []
    index_map: list[int] = []
    for i, ch in enumerate(text):
        if re.match(r"\w", ch, flags=re.UNICODE):
            chars.append(ch.lower())
            index_map.append(i)
    return "".join(chars), index_map


def _trim_quote_overlap(
    before: str | None, after: str | None, quote: str
) -> tuple[str | None, str | None]:
    """auto-caption 的 segment 邊界常與 quote 對不齊,造成 quote 開頭重複出現在
    before 結尾、或 quote 結尾重複出現在 after 開頭;把重疊部分裁掉。"""
    normalized_quote = _normalize(quote)
    if not normalized_quote:
        return before, after

    if before:
        nb, bmap = _normalize_with_map(before)
        max_k = min(len(nb), len(normalized_quote))
        for k in range(max_k, 0, -1):  # 只看「最長」的重疊,短的視為巧合
            if normalized_quote[:k] == nb[len(nb) - k:]:
                if _overlap_long_enough(normalized_quote[:k]):
                    before = (
                        before[: bmap[len(nb) - k]].rstrip(" ,.;:!?、,。;:!?")
                        or None
                    )
                break

    if after:
        na, amap = _normalize_with_map(after)
        max_k = min(len(na), len(normalized_quote))
        for k in range(max_k, 0, -1):
            if normalized_quote[-k:] == na[:k]:
                if _overlap_long_enough(normalized_quote[-k:]):
                    after = after[amap[k - 1] + 1:].lstrip(" ,.;:!?、,。;:!?") or None
                break

    return before, after


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
    if quote:
        before, after = _trim_quote_overlap(before, after, quote)
    return before, after
