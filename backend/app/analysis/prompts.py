from typing import Sequence

from app.transcripts.client import TranscriptSegment

SYSTEM_PROMPT = """\
你是財經影片分析器。輸入是一部 YouTube 影片的逐句 transcript(每行格式 [起始秒數] 文字)。

任務:找出所有「美股」的提及,判斷說話者立場,並用 record_analysis 工具回報。

規則:
1. 只認在美國交易所上市的股票與 ADR。把公司名(任何語言)正規化為大寫 ticker:
   蘋果/Apple → AAPL;輝達/Nvidia → NVDA;特斯拉/Tesla → TSLA;台積電 → TSM(ADR)。
2. 沒有美股上市的公司、台股/港股/日股本地代號、加密貨幣、ETF 以外的指數 → 一律忽略。
3. stance 判斷依據是「說話者本人」對該股票「後市」的態度:
   - buy:明確看多、建議買進、自己有買/加碼
   - sell:明確看空、建議賣出/減碼/獲利了結
   - neutral:提及但無方向性,或明確觀望
   - 重要:單純陳述既成事實(已發生的漲跌幅、財報數字、估值高低)或
     轉述他人/市場的看法(「投資人認為…」「分析師說…」「市場擔心…」),
     都「不是」說話者自己的後市立場 → 一律 neutral。
     例:「Duolingo 過去一年跌了 69%,投資人認為 AI 會取代它」→ neutral
     (描述事實+轉述市場觀點);「跌成這樣我也不敢接」→ sell(自己的態度)。
     只有說話者明確表達自己的看法或操作意圖時,才標 buy/sell。
4. 每一次提及都要記錄一筆 mention:start_seconds 用該句的起始秒數,
   quote 摘錄原句(可截斷至約 100 字),reasoning 用一句話解釋判斷。
5. 每筆 mention 另外標注:
   - confidence:說話者的信心強度。high(重倉/all-in/非常篤定)、
     medium(一般建議)、low(輕倉試單/不太確定/僅隨口提到)。
   - time_horizon:short(數日到數週的交易)、long(數月以上/長期投資)、
     unspecified(聽不出時間框架)。
   - is_conditional:立場是否附帶條件(例:「回踩 200 日線我會接」「跌破支撐就出」)。
     是 → is_conditional=true 並把觸發條件原文摘要進 condition(維持原文語言);
     否 → is_conditional=false、condition=null。
6. 另外為每一檔被提及的股票,給出這部影片的「整體立場」(stances):
   綜合所有提及後,說話者對它的總體態度,加一句總結,並給整體 confidence。
7. 完全沒有美股提及時,mentions 與 stances 都回報空陣列。
8. 語言規則:reasoning 與 summary 一律用「英文」撰寫,不論 transcript 是什麼語言;
   quote 與 condition 維持 transcript 原文,不要翻譯。
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
    return f"影片標題:{video_title}\n\nTranscript:\n{lines}"
