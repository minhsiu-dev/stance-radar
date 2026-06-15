# Stance Radar

Track US-stock stances across the YouTube finance channels you follow. Stance
Radar pulls each video's transcript, uses Claude to read US-stock mentions and
their stance (buy / neutral / sell — with confidence, time frame, and
conditional-order flags), marks them on the price chart, and lists every quote
with its timestamp.

## ⚠️ Disclaimer

- **Not financial advice.** Stance Radar is for personal research and educational
  use only. Nothing it produces is investment advice or a recommendation to buy
  or sell any security. Do your own research.
- **Your responsibility.** You are responsible for complying with
  [YouTube's Terms of Service](https://www.youtube.com/t/terms) and applicable
  copyright law. This tool grants you no rights to the content it accesses.
- **No warranty.** This software is provided "AS IS", without warranty of any
  kind. Use at your own risk; the author is not liable for any loss arising from
  its use.

## Features

- **Stance detection** — per-video US-stock mentions and stance (buy / neutral /
  sell) with confidence, time frame, and conditional-order annotations, marked on
  the price chart and listed quote-by-quote with timestamps.
- **Stance-flip detection** — when a channel's stance on a stock reverses
  (especially buy ↔ sell), it surfaces in the homepage "Stance flips" section.
- **Channel scoreboard** — actual price change 7 / 30 / 90 days after each
  buy/sell call, with excess return vs the market; per-channel detail plus a
  cross-channel leaderboard.
- **Portfolio** — record buy/sell transactions; it computes holdings (shares /
  cost / market value / unrealized P&L / weight) and benchmarks total return
  against VOO and QQQ.
- **Homepage performance cards** — portfolio vs VOO / QQQ return across several
  ranges (1d / 5d / 1m / 3m / 6m / ytd / 1y).
- **Privacy mask** — a gear-menu toggle hides portfolio amounts (value, shares,
  cost) while keeping public market prices visible. The gear menu also holds dark
  mode and language switching.
- **Feed filtering** — filter the homepage video feed by channel / stock / stance.
- **Stock fundamentals** — latest-quarter revenue / margin growth, a margin-trend
  chart, and analyst targets (low / mean / high, upside, rating distribution).
- **Channel pages** — "Videos" and "Scoreboard" tabs, a most-mentioned-stocks
  table, and an infinite-scrolling video list.
- **Auto-scheduling** — set `AUTO_REFRESH_MINUTES` to periodically check for new
  videos; channels with "auto-analyze" enabled analyze new uploads automatically.
- **Responsive** — works in a mobile browser.

## Requirements

- Docker (with Compose)
- A [YouTube Data API v3 key](https://developers.google.com/youtube/v3/getting-started)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart) logged
  in locally (`claude login`). Analysis runs through the Claude Code CLI
  (`claude -p`) — no `ANTHROPIC_API_KEY` is required. The api container mounts
  `~/.claude` read-only to reuse your local login.

## Quick start

```bash
cp .env.example .env   # fill in YOUTUBE_API_KEY
docker compose up -d --build
```

Open <http://localhost:3000> → **Channel Management** → paste one or more channel
IDs (newline- or comma-separated). Stance Radar fetches each channel's most recent
videos (`BACKFILL_LIMIT`, default 30) for you to pick from; only the videos you
select get analyzed. Later, **Check for new videos** lists new uploads per channel
for you to pick the same way; skipped videos can be re-analyzed from the channel
page at any time.

The api container reads your local Claude Code credentials via a read-only mount
(`~/.claude`), so you must `claude login` on the host first.

### Try it without real keys (fake-data mode)

```bash
USE_FAKE_ADAPTERS=true docker compose up -d --build
# In Channel Management, paste: UC_fake_alpha UC_fake_beta
```

This swaps every external service (YouTube / transcripts / Claude / market data)
for deterministic fake data — no keys or Claude login needed.

## Development & testing

```bash
# Backend (start the db first: docker compose up -d db)
cd backend && python3.12 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]' && pytest

# Frontend
cd frontend && npm install && npm test && npm run dev

# End-to-end (Playwright)
docker compose -p stance-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
cd e2e && npm install && npx playwright install chromium && npm test
```

## Architecture

Three containers: Next.js (`:3000`) → FastAPI (`:8000`) → Postgres (`:5432`).
External services (YouTube Data API, youtube-transcript-api, the Claude Code CLI,
yfinance) all sit behind an adapter interface; `USE_FAKE_ADAPTERS=true` injects
deterministic fakes for tests and demos. Daily candles are persisted incrementally
to Postgres (yfinance is only hit for gaps); real-time quotes, intraday, search,
financials, and analyst data use in-memory TTL caches.

## License

[MIT](LICENSE) — Copyright (c) 2026 Min Hsiu
