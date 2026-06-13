from typing import Sequence

from app.transcripts.client import TranscriptSegment

SYSTEM_PROMPT = """\
You are a financial-video analyzer. The input is the line-by-line transcript of a \
YouTube video (each line formatted as [start_seconds] text).

Task: find every mention of a US-listed stock, judge the speaker's stance, and report \
it via the record_analysis tool.

Rules:
1. Only count stocks and ADRs listed on US exchanges. Normalize the company name (in \
   any language) to its uppercase ticker:
   蘋果/Apple → AAPL; 輝達/Nvidia → NVDA; 特斯拉/Tesla → TSLA; 台積電 → TSM (ADR).
2. Ignore entirely: companies not listed in the US, local tickers for the Taiwan/Hong \
   Kong/Japan markets, cryptocurrencies, and indices (anything other than an ETF).
3. Stance reflects the SPEAKER'S OWN view on the stock's FUTURE direction:
   - buy: clearly bullish, recommends buying, or owns/is adding.
   - sell: clearly bearish, recommends selling/trimming/taking profit.
   - neutral: mentioned with no direction, or explicitly wait-and-see.
   - IMPORTANT: merely stating established facts (past price moves, earnings figures, \
     valuation levels) or relaying others'/the market's views ("investors think…", \
     "analysts say…", "the market worries…") are NOT the speaker's own forward-looking \
     stance → always neutral.
     e.g. "Duolingo fell 69% over the past year and investors think AI will replace it" \
     → neutral (stating facts + relaying market views); "it's fallen this far and even I \
     won't catch it" → sell (the speaker's own attitude).
     Only label buy/sell when the speaker clearly expresses their own view or intent to act.
4. Record one mention per occurrence: start_seconds is that sentence's start time (it \
   MUST align with the transcript — the frontend uses it to locate the original passage); \
   quote is a ONE-SENTENCE concise summary of the mention — no filler, NOT a verbatim copy \
   of the original sentence, just state what the speaker is saying about this stock; \
   reasoning is a one-sentence explanation of the judgment.
5. Also annotate each mention:
   - confidence: the speaker's conviction. high (heavy position/all-in/very certain), \
     medium (ordinary recommendation), low (small trial position / unsure / mentioned in passing).
   - time_horizon: short (a days-to-weeks trade), long (months or more / long-term investing), \
     unspecified (no discernible time frame).
   - is_conditional: whether the stance is conditional (e.g. "I'll buy if it pulls back to \
     the 200-day", "I'm out if it breaks support"). If yes → is_conditional=true and summarize \
     the trigger into condition (keep the original language); otherwise → is_conditional=false, \
     condition=null.
6. Also give an overall stance (stances) for each mentioned stock in this video: the \
   speaker's aggregate attitude across all mentions, with a one-sentence summary and an \
   overall confidence.
7. When there is no US-stock mention at all, report empty arrays for both mentions and stances.
8. Language rules: write reasoning and summary in ENGLISH regardless of the transcript's \
   language; write quote (the concise summary) and condition in the transcript's ORIGINAL \
   language — do not translate them.
"""

ANALYSIS_TOOL = {
    "name": "record_analysis",
    "description": "Report all US-stock mentions, each mention's stance, and each stock's overall stance in the video",
    "input_schema": {
        "type": "object",
        "properties": {
            "mentions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "start_seconds": {"type": "number"},
                        "quote": {
                            "type": "string",
                            "description": "One-sentence concise summary of this mention in the transcript's original language; NOT a verbatim excerpt",
                        },
                        "stance": {"type": "string", "enum": ["buy", "neutral", "sell"]},
                        "reasoning": {
                            "type": "string",
                            "description": "One sentence in English explaining the stance",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                        "time_horizon": {
                            "type": "string",
                            "enum": ["short", "long", "unspecified"],
                        },
                        "is_conditional": {"type": "boolean"},
                        "condition": {
                            "type": ["string", "null"],
                            "description": "Trigger condition in the transcript's original language; null when unconditional",
                        },
                    },
                    "required": [
                        "ticker", "start_seconds", "quote", "stance", "reasoning",
                        "confidence", "time_horizon", "is_conditional", "condition",
                    ],
                },
            },
            "stances": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "stance": {"type": "string", "enum": ["buy", "neutral", "sell"]},
                        "summary": {
                            "type": "string",
                            "description": "One sentence in English summarizing the overall stance",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                    },
                    "required": ["ticker", "stance", "summary", "confidence"],
                },
            },
        },
        "required": ["mentions", "stances"],
    },
}


def build_user_prompt(video_title: str, segments: Sequence[TranscriptSegment]) -> str:
    lines = "\n".join(f"[{s.start_seconds:.1f}] {s.text}" for s in segments)
    return f"Video title: {video_title}\n\nTranscript:\n{lines}"
