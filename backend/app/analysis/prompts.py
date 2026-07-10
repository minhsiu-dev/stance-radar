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
     A video whose SUBJECT is another investor's or institution's positions, where the \
     speaker only relays that party's bullish/bearish view (e.g. "Michael Burry is \
     shorting Oracle", "Buffett has been buying Apple"), is NOT the speaker's own \
     forward-looking stance → neutral, unless the speaker separately states their own view.
     Only label buy/sell when the speaker clearly expresses their own view or intent to act.
   - CONDITIONAL / NOT-ACTING-NOW: buy/sell requires the speaker to be CURRENTLY ACTIONABLE — \
     buying / owns / is adding now (buy), or selling / trimming / taking profit now (sell). A \
     directional view GATED behind a future trigger the speaker is waiting for and is NOT acting \
     on now ("I'd buy at lower levels", "waiting for a pullback before I'd touch it", "if it \
     drops to $X I'd start buying") is NOT an actionable buy/sell → neutral; set \
     is_conditional=true and put the trigger in condition. A CURRENT action that merely ADDS a \
     conditional ("I'm buying here and would add lower", "long but I'm out if it breaks support") \
     keeps the current action's stance (buy/sell) with is_conditional=true. \
     e.g. "I really like SHOP but I'd only start buying at lower levels" → neutral, \
     is_conditional=true, condition="would buy at lower price levels"; "I'm buying SHOP here and \
     will add if it dips" → buy, is_conditional=true, condition="add on a dip". \
     (condition stays in the transcript's original language, per rule 8.)
4. Record one mention per occurrence: start_seconds is that sentence's start time (it \
   MUST align with the transcript — the frontend uses it to locate the original passage); \
   quote is the original sentence quoted VERBATIM from the transcript (may truncate to \
   about 100 chars), do NOT paraphrase or summarize; \
   reasoning is a one-sentence explanation of the judgment.
5. Also annotate each mention:
   - confidence: the speaker's conviction. high (heavy position/all-in/very certain), \
     medium (ordinary recommendation), low (small trial position / unsure / mentioned in passing).
   - time_horizon: short (a days-to-weeks trade), long (months or more / long-term investing), \
     unspecified (no discernible time frame).
   - is_conditional: whether the stance carries a conditional trigger (e.g. "I'll buy if it \
     pulls back to the 200-day", "I'm out if it breaks support", "would buy at lower levels"). \
     If yes → is_conditional=true and summarize the trigger into condition (keep the original \
     language). This applies BOTH to a neutral stance (a purely-conditional waiting view, per \
     rule 3) AND to a buy/sell that adds a conditional. Otherwise → is_conditional=false, \
     condition=null.
6. Also give an overall stance (stances) for each mentioned stock in this video: the \
   speaker's aggregate attitude across all mentions, with a one-sentence summary, an \
   overall confidence, and is_conditional (true when the action driving the label is \
   gated on a future trigger the speaker is not acting on now — e.g. an exit plan to \
   trim only if the price reaches a higher level, while the speaker still holds now).
7. When there is no US-stock mention at all, report empty arrays for both mentions and stances.
8. Language rules: write reasoning and summary in ENGLISH regardless of the transcript's \
   language; quote (the verbatim original sentence) and condition stay in the transcript's \
   ORIGINAL language — do not translate them.
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
                            "description": "The original sentence quoted verbatim from the transcript (may truncate to ~100 chars) in its original language; do NOT paraphrase or summarize",
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
                        "is_conditional": {
                            "type": "boolean",
                            "description": "True when the action driving this overall stance is gated on a future trigger the speaker is not acting on now (e.g. an exit plan at a higher price)",
                        },
                    },
                    "required": ["ticker", "stance", "summary", "confidence", "is_conditional"],
                },
            },
        },
        "required": ["mentions", "stances"],
    },
}


def build_user_prompt(video_title: str, segments: Sequence[TranscriptSegment]) -> str:
    lines = "\n".join(f"[{s.start_seconds:.1f}] {s.text}" for s in segments)
    return f"Video title: {video_title}\n\nTranscript:\n{lines}"
