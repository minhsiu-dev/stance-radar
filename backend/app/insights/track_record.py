"""頻道戰績走勢圖的資料層。

立場語意（與 ticker_perf.py 刻意不同）：方向性發言 carry-forward，neutral 完全
忽略。buy 之後一路算 buy，直到出現 sell 為止；neutral 既不開始也不結束區段，
同向重複發言也不切段。ticker_perf.py 那邊 neutral 是平倉，兩套並存於同一個 tab。
"""
from dataclasses import dataclass
from datetime import date

TRACK_RECORD_TOP_N = 10


@dataclass(frozen=True)
class Call:
    """一次方向性發言。stance 只會是 "buy" / "sell"（neutral 由呼叫端濾掉）。"""

    ticker: str
    stance: str
    day: date
    video_id: str
    video_title: str


def rank_tickers(calls: list[Call], top_n: int = TRACK_RECORD_TOP_N) -> list[str]:
    """前 N 支股票，依方向性發言次數 desc、ticker asc。全時間統計，不隨觀察窗改變，
    這樣切 range 時 chip 順序與配色都不會跳。"""
    counts: dict[str, int] = {}
    for call in calls:
        counts[call.ticker] = counts.get(call.ticker, 0) + 1
    return sorted(counts, key=lambda t: (-counts[t], t))[:top_n]


def build_runs(calls: list[Call], start: date) -> tuple[list[dict], list[dict]]:
    """把一支股票的方向性發言攤成 [start, today] 上的狀態區段 + 轉折 marker。

    `calls` 必須是同一支股票、依日期遞增、每天最多一筆（由 load_calls 收斂）。
    回傳 (runs, markers)：runs 首段的 from 恆等於 start、末段 to 為 None；相鄰段的
    to 與下一段的 from 是同一天（邊界日共用）。markers 只含窗內的轉折——窗起點之前
    的發言只用來決定首段的 carried state，不產生 marker。
    """
    state = "idle"
    transitions: list[Call] = []
    for call in calls:
        if call.stance != state:
            state = call.stance
            transitions.append(call)

    carried = "idle"
    for call in transitions:
        if call.day <= start:
            carried = call.stance
    in_window = [call for call in transitions if call.day > start]

    runs: list[dict] = [{"state": carried, "from": start.isoformat(), "to": None}]
    markers: list[dict] = []
    for call in in_window:
        runs[-1]["to"] = call.day.isoformat()
        runs.append({"state": call.stance, "from": call.day.isoformat(), "to": None})
        markers.append({
            "date": call.day.isoformat(),
            "stance": call.stance,
            "video_id": call.video_id,
            "video_title": call.video_title,
        })
    return runs, markers
