# Stance Radar

追蹤你訂閱的 YouTube 財經頻道:自動抓影片 transcript,用 Claude 判讀美股
提及與立場(buy / neutral / sell),在 K 線圖上標記、逐筆列出原句與秒數。

## 需要準備

- Docker(含 compose)
- [YouTube Data API v3 key](https://developers.google.com/youtube/v3/getting-started)
- 本機已 `claude login` 過的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart)(分析走 `claude -p`,不需 API key)

## 啟動

```bash
cp .env.example .env   # 填入 YOUTUBE_API_KEY
docker compose up -d --build
```

開 <http://localhost:3000> → 「頻道管理」→ 貼上 channel ID(可一次多個,
換行或逗號分隔)→ 系統自動抓最近 30 部影片並分析(`BACKFILL_LIMIT` 可調)。

容器透過 docker volume mount(`${HOME}/.claude:/root/.claude:ro`)讀本機的
Claude Code 認證,所以一定要先在本機 `claude login` 過。

### 不用真金鑰試玩(假資料模式)

```bash
USE_FAKE_ADAPTERS=true docker compose up -d --build
# 頻道管理頁貼:UC_fake_alpha UC_fake_beta
```

## 開發與測試

```bash
# 後端(需先 docker compose up -d db)
cd backend && python3.12 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]' && pytest

# 前端
cd frontend && npm install && npm test && npm run dev

# E2E
docker compose -p stance-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
cd e2e && npm install && npx playwright install chromium && npm test
```

## 架構

三容器:Next.js(:3000)→ FastAPI(:8000)→ Postgres(:5432)。
外部服務(YouTube Data API / youtube-transcript-api / Claude Code CLI / yfinance)
皆走 adapter 介面,`USE_FAKE_ADAPTERS=true` 時注入確定性假資料。
設計細節見 `docs/superpowers/specs/`,實作計畫見 `docs/superpowers/plans/`。
