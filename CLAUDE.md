# CLAUDE.md

Guidance for agents working in this repo. For the feature-level picture see
`README.md`; this file only records things to watch out for during development /
testing.

## Architecture

Three containers: Next.js (:3000) → FastAPI (:8000) → Postgres (:5432), defined in
`docker-compose.yml`.

External services (YouTube Data API / youtube-transcript-api / Claude Code CLI /
yfinance) all go through an adapter interface, wired up in `build_adapters()` in
`backend/app/main.py`: when `USE_FAKE_ADAPTERS=true` they are swapped for
deterministic fake data (`FakeYouTubeClient` / `FakeTranscriptClient` /
`FakeLLMClient` / `FakeMarketClient`), otherwise the real clients are used. Both
the tests and playing around with fake data rely on this switch.

## Backend test flow

The backend code is `COPY`-ed into the image at build time (see
`backend/Dockerfile`, there is **no** source bind-mount), so after changing code
you must **rebuild first** before running the tests:

```bash
cd /workspace
docker compose build api && docker compose up -d api
docker exec -w /srv \
  -e TEST_DATABASE_URL=postgresql+asyncpg://stance:stance@db:5432/stance_radar_test \
  workspace-api-1 sh -c 'unset BACKFILL_LIMIT && python -m pytest tests/ -q --no-cov'
```

You can replace `tests/` with a single file or path to run only that part.

Things to note:

- **Do not leave `BACKFILL_LIMIT` in `.env`**: `.env` is pulled into the container
  environment by compose, and `tests/unit/test_config.py::test_defaults` asserts
  the default value `backfill_limit == 30`, so having this variable in the
  environment makes that test fail. The `unset BACKFILL_LIMIT` in the command
  above is exactly for this reason.
- **Known flake**: `tests/integration/test_refresh_api.py::test_trigger_refresh_and_poll_until_done`
  occasionally fails when running the whole suite due to ordering effects, but
  passes when run on its own (pre-existing, not a new bug).

conftest (`backend/tests/conftest.py`) automatically creates the
`stance_radar_test` database, and the `api` fixture brings up the full ASGI app
with fake adapters + the test db.

## Frontend test flow

Run on the host (not inside the container):

```bash
cd /workspace/frontend && npx vitest run && npm run build
```

Note: `npm run build` on the host only **verifies that it compiles**, it does not
update the container running on :3000. Like the backend, the frontend is built
via `build:` into the image with **no** source bind-mount (see
`docker-compose.yml`), so to reflect frontend changes on :3000 you must rebuild
the image and restart:

```bash
docker compose build frontend && docker compose up -d frontend
```

## E2E

Default flow (run Playwright on the host):

```bash
docker compose -p stance-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
cd e2e && npm test
```

For disk-constrained environments (e.g. a CI sandbox), use the opt-in
`docker-compose.e2e.lowdisk.yml`: it switches the frontend to
`frontend/Dockerfile.e2e` (which packages the `.next/standalone` already built on
the host, skipping the ~1GB `npm ci` inside the container), paired with
`e2e/Dockerfile.testrunner` (running Playwright inside a container).

```bash
cd frontend && API_URL=http://api:8000 npm run build && cd ..
docker compose -p stance-e2e \
  -f docker-compose.yml -f docker-compose.e2e.yml -f docker-compose.e2e.lowdisk.yml \
  up -d --build
```

You normally do not need this — see the comment at the top of
`docker-compose.e2e.lowdisk.yml` for details.

## Migration rules

At startup `Base.metadata.create_all` only **creates missing tables**; it does not
change existing types / columns. To change an existing table (add an enum value,
add a column) write it in `_STATEMENTS` in `backend/app/db_migrations.py`; each
statement must be idempotent (`IF NOT EXISTS`) and runs after `create_all`: on a
brand-new DB these are all no-ops, and only an older DB relies on them to be
backfilled.

## i18n rules

Every UI string must go into **both** `frontend/messages/zh-TW.json` **and**
`frontend/messages/en.json`. Missing either side counts as unfinished.

## Market data layer

- **Daily K-line (candles)**: `PriceStore` in `backend/app/market/store.py`
  incrementally persists daily candles to Postgres (`price_bars` /
  `price_coverage`), with the DB as the source of truth, only batching calls to
  yfinance for gaps, and detecting series re-adjustments caused by splits /
  dividends and re-fetching the whole symbol. The scoreboard and chart historical
  prices go through this.
- **Everything else**: real-time quotes, intraday, search, financials, and analyst
  data use only an in-memory TTL cache (`YFinanceMarketClient` in
  `backend/app/market/client.py`, each with its own TTL); they are not persisted
  to the DB.

## Spec / plan location

Design specs and implementation plans live under `docs/superpowers/` (`specs/` and
`plans/`). This directory is git-ignored and kept local-only — it is not published.

## Disk / Docker space

Development runs Docker-in-Docker: image layers, container overlay, and build cache
all live in `/var/lib/docker` of the daemon container, sharing the same backing
disk as the repo (the ~79G overlay you see with `df /`). From inside the workspace
container `du` only sees its own ~2G; the docker portion has to be inspected with
the `docker` CLI (`docker system df`), not `du`.

There are two things that eat space: the image layers / build cache accumulated by
each `docker compose build`, and the fact that **E2E builds a whole separate set
of `stance-e2e-*` images (~2–3G)**. After running E2E or when space is tight,
clean up in one shot:

```bash
make clean-docker      # tear down the E2E stack (incl. its throwaway pgdata) + prune images/cache; leaves the main DB alone
```

`make clean-docker` does not touch `workspace_pgdata` (your holdings / analysis
data). To wipe everything including volumes (which deletes the main DB) use
`make clean-docker-all`, which first asks you to type `yes` to confirm.
(Without make installed this is equivalent to `docker compose -p stance-e2e down
-v --remove-orphans && docker image prune -af && docker builder prune -af`.)

**A full (100%) disk will kill Postgres**: when it finishes WAL redo and writes the
end-of-recovery checkpoint it hits `No space left on device` → PANIC → restart →
infinite loop, `db` goes unhealthy, and all `/api/portfolio/*` return 500
(`CannotConnectNowError: ... in recovery mode`). The data is not corrupted (redo
already completed), it just can't write. To fix: free up space first (the prune
above), then `docker compose restart db`, and it will be healthy within seconds.

Most of the 79G is shared by the host and outside our control; the only thing
actually reclaimable is the docker artifacts above. For more space you have to
adjust it at the layer that opens this sandbox (cloud workspace disk settings / VM
volume / Docker Desktop's virtual disk limit); it cannot be changed from inside
the container.
