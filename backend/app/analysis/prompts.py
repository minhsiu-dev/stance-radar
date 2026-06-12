from typing import Sequence

from app.transcripts.client import TranscriptSegment

SYSTEM_PROMPT = """\
你是財經影片分析器。輸入是一部 YouTube 影片的逐句 transcript(每行格式 [起始秒數] 文字)。

任務:找出所有「美股」的提及,判斷說話者立場,並用 record_analysis 工具回報。

規則:
1. 只認在美國交易所上市的股票與 ADR。把公司名(任何語言)正規化為大寫 ticker:
   蘋果/Apple → AAPL;輝達/Nvidia → NVDA;特斯拉/Tesla → TSLA;台積電 → TSM(ADR)。
2. 沒有美股上市的公司、台股/港股/日股本地代號、加密貨幣、ETF 以外的指數 → 一律忽略。
3. stance 判斷依據是說話者對該股票「後市」的態度:
   - buy:明確看多、建議買進、自己有買/加碼
   - sell:明確看空、建議賣出/減碼/獲利了結
   - neutral:提及但無方向性,或明確觀望
4. 每一次提及都要記錄一筆 mention:start_seconds 用該句的起始秒數,
   quote 摘錄原句(可截斷至約 100 字),reasoning 用一句話解釋判斷。
5. 另外為每一檔被提及的股票,給出這部影片的「整體立場」(stances):
   綜合所有提及後,說話者對它的總體態度,加一句總結。
6. 完全沒有美股提及時,mentions 與 stances 都回報空陣列。
"""

ANALYSIS_TOOL = {
    "name": "record_analysis",
    "description": "回報影片中所有美股提及、逐筆立場與每檔股票的整體立場",
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
                        "quote": {"type": "string"},
                        "stance": {"type": "string", "enum": ["buy", "neutral", "sell"]},
                        "reasoning": {"type": "string"},
                    },
                    "required": ["ticker", "start_seconds", "quote", "stance", "reasoning"],
                },
            },
            "stances": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "stance": {"type": "string", "enum": ["buy", "neutral", "sell"]},
                        "summary": {"type": "string"},
                    },
                    "required": ["ticker", "stance", "summary"],
                },
            },
        },
        "required": ["mentions", "stances"],
    },
}


def build_user_prompt(video_title: str, segments: Sequence[TranscriptSegment]) -> str:
    lines = "\n".join(f"[{s.start_seconds:.1f}] {s.text}" for s in segments)
    return f"影片標題:{video_title}\n\nTranscript:\n{lines}"
