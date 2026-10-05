# CLAUDE.md

Guidance for agents working in this repo. For the feature-level picture see
`README.md`; this file only records things to watch out for during development /
testing.

## Architecture

Five containers: Next.js (:3000) → FastAPI (:8000) + two workers (`worker`,
`worker-analyze`) → Postgres (:5432), defined in `docker-compose.yml`.

The `api` container serves HTTP and never runs pipeline work. It enqueues
discover / load_older jobs (a `jobs` row, `status=running`, `claimed_at` NULL) and
re-statuses videos. Transcripts and analysis are **not** jobs: the video `status` is
the queue (spec: `docs/superpowers/specs/2026-10-04-two-lane-pipeline-design.md`).

- `worker` (`python -m app.worker fetch`) claims jobs with `FOR UPDATE SKIP LOCKED`,
  runs the auto-refresh scheduler, and runs the **transcript lane**: it claims
  `pending` videos and stores their transcript → `transcribed`.
- `worker-analyze` (`python -m app.worker analyze`) runs only the **analysis lane**:
  it claims `transcribed` videos and spawns the `claude` CLI → `analyzed`. It is the
  only container that mounts `~/.claude`.

Lanes (`backend/app/pipeline/lanes.py`) claim per video via `videos.claimed_at`, run
`TRANSCRIPT_CONCURRENCY` / `ANALYSIS_CONCURRENCY` slots, and pause themselves after
`TRANSCRIPT_PAUSE_AFTER_FAILURES` (5) / `ANALYSIS_PAUSE_AFTER_FAILURES` (1) failures in
a row. Pause flags, heartbeats and the last error live in `pipeline_lanes` and show on
`/pipeline`. Both workers have `restart: unless-stopped`; `worker-analyze` exits
non-zero on an `AnalysisInfrastructureError` (a `claude` child killed by a signal)
instead of retrying in-process, and only it restarts.

This split exists because a long-lived uvicorn process was observed degrading
until every child it forked died with SIGSEGV before `exec` — reproduced even
with `/bin/true`, so it wasn't the `claude` binary's fault, just something about
that process after enough time/forks. The failure latches: once it starts, every
subsequent spawn dies until the process restarts, and it burned 159 videos in 6
minutes before this was caught. Keeping the process that spawns `claude` separate
from the one that loads heavy native extensions (pandas/numpy/scipy-OpenBLAS/lxml,
pulled in by the market-data layer) was the fix, and `restart: unless-stopped`
turns a recurrence into a clean restart instead of a wedge that silently fails
every job. **Standing constraint: `app/worker.py` and everything it imports must
never import yfinance** (or pandas/numpy/scipy/lxml transitively) — ticker
validation in the analysis lane goes over HTTP to the api (`HttpTickerValidator`)
instead of touching the market client directly. If you add an import to
`app/worker.py` or its dependency chain (including `app/pipeline/*`), check that both
`docker compose exec worker python -c "import sys, app.worker; print([m for m in ('pandas','numpy','scipy','yfinance','lxml') if m in sys.modules])"`
and the same command against `worker-analyze` still print `[]`.

**Known limitation: no recovery path for an unclaimed `running` job if `worker` can't
start.** Its `fail_orphan_jobs` only touches rows with `claimed_at IS NOT NULL` (an
unclaimed row is enqueued work waiting for a worker, not a crash), and there is no
cancel/clear endpoint, so every new discover trigger returns `created=False` until a
healthy `worker` claims the row. `/pipeline` shows the transcript lane as offline in
that state, which is how you notice. **The fix is `docker compose restart worker`**,
once whatever makes it crash-loop is fixed. If `worker-analyze` is the one
crash-looping (usually a broken `claude` install or `~/.claude` mount),
`/pipeline` shows the analysis lane offline and `transcribed` videos pile up;
`docker compose restart worker-analyze` after fixing the cause. A timeout-based
staleness sweep for jobs is still deferred as a design decision.

The api's healthcheck (`GET /api/health`) only turns healthy once its lifespan
(`Base.metadata.create_all` + `run_startup_migrations`) has finished — ASGI
servers hold off accepting connections until `lifespan.startup` completes. Both
workers depend on `api: condition: service_healthy` (not the default
`service_started`) specifically so a cold stack (fresh volume) doesn't crash-loop
them against a not-yet-created `jobs` / `pipeline_lanes` table.

External services (YouTube Data API / youtube-transcript-api / Claude Code CLI /
yfinance) all go through an adapter interface. The api wires up its adapters in
`build_adapters()` in `backend/app/main.py`; the workers wire up their own
(pandas-free) set per role in `build_worker_adapters(settings, role)` in `backend/app/worker.py`. When
`USE_FAKE_ADAPTERS=true` both are swapped for deterministic fake data
(`FakeYouTubeClient` / `FakeTranscriptClient` / `FakeLLMClient` /
`FakeMarketClient`), otherwise the real clients are used. Both the tests and
playing around with fake data rely on this switch.

## Backend test flow

The backend code is `COPY`-ed into the image at build time (see
`backend/Dockerfile`, there is **no** source bind-mount), so after changing code
you must **rebuild first** before running the tests. `api`, `worker` and `worker-analyze` share the
same image (`build: ./backend`), so rebuild all three:

```bash
cd /workspace
docker compose build api worker worker-analyze && docker compose up -d api worker worker-analyze
docker exec -w /srv \
  -e TEST_DATABASE_URL=postgresql+asyncpg://stance:stance@db:5432/stance_radar_test \
  workspace-api-1 sh -c 'unset BACKFILL_LIMIT ANALYSIS_CONCURRENCY AUTO_REFRESH_MINUTES SHORTS_MAX_SECONDS ADMIN_SESSION_MINUTES ADMIN_COOKIE_SECURE ADMIN_PASSWORD CLAUDE_MODEL CLAUDE_BIN && python -m pytest tests/ -q --no-cov'
```

You can replace `tests/` with a single file or path to run only that part.

Things to note:

- **Any Settings-backed var in `.env` breaks `test_config.py::test_defaults`**:
  `.env` is pulled into the container environment by compose, and that test
  asserts every default value (e.g. `backfill_limit == 30`), so ANY overridden
  setting left in the environment makes it fail. The long `unset` list in the
  command above covers everything `.env` sets today — when you add a var to
  `.env`, add it to the list too.
- **`ADMIN_COOKIE_SECURE=true` in `.env` breaks admin-gated tests**: it makes the
  `sr_admin` cookie `Secure`, which httpx silently drops over the plain-http ASGI
  test transport, so every test that seeds channels via `POST /api/channels` gets
  a 401 (~6 failures in `test_stocks_api.py` alone). Hence `unset
  ADMIN_COOKIE_SECURE` in the command above.
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

## Visual verification of the frontend (Playwright screenshots / measurements)

To actually *see* a UI change on the running app (`:3000`) — and to iterate on CSS/layout —
drive it with Playwright. This container can't launch Chromium directly (it's the `node` user,
no root to `apt-get` the libs), **but** the browsers are already downloaded
(`~/.cache/ms-playwright`) and the workspace can reach `http://localhost:3000`. So run
Playwright inside the official image with `--network host`, moving files in/out with
`docker cp` — **dind volume mounts do NOT work** (`-v` paths resolve on the docker *daemon*
host, not this container), and the workspace itself can't `apt` the libs.

```bash
# version that matches the downloaded browsers (e.g. 1.60.0):
VER=$(node -e "console.log(require('./e2e/node_modules/playwright/package.json').version)")

# one host-network "shooter" container (the image ships matching browsers at /ms-playwright,
# with PLAYWRIGHT_BROWSERS_PATH preset; it does NOT ship the playwright npm package, so cp ours in):
docker rm -f shooter 2>/dev/null
docker create --network host --name shooter mcr.microsoft.com/playwright:v${VER}-noble sleep 1800 >/dev/null
docker start shooter >/dev/null
docker exec shooter mkdir -p /app/node_modules /shots
docker cp e2e/node_modules/playwright      shooter:/app/node_modules/playwright
docker cp e2e/node_modules/playwright-core  shooter:/app/node_modules/playwright-core

# per iteration: a script that require('playwright'), goto a http://localhost:3000/zh-TW/... URL,
# waitForTimeout(~4000) (pages are client-rendered via SWR — the SSR HTML is just a skeleton),
# then screenshot to /shots/*.png:
docker cp /tmp/shot.js shooter:/app/shot.js
docker exec -w /app shooter node shot.js
docker cp shooter:/shots/. /tmp/shots/      # then Read /tmp/shots/*.png
```

- **Rebuild the `frontend` image first** (the snippet above) so `:3000` reflects your change
  before shooting.
- For pixel-precise CSS debugging, `page.evaluate(() => el.getBoundingClientRect())` +
  `getComputedStyle(el).boxShadow` beats eyeballing faint 1px lines (this is how a `ring-1`
  outset overflowing a sticky element was confirmed). Mobile: `deviceScaleFactor: 3` + a `clip`
  makes thin borders legible; tabs/data load after the ~4s wait.
- **Headless Chromium in the shooter does NOT paint lightweight-charts canvases** (screenshots
  show an empty chart area): run `docker exec -w /app shooter xvfb-run -a node shot.js` with
  `chromium.launch({ headless: false })` instead. Canvas pixels can be read back via
  `getContext("2d").getImageData(...)` in `page.evaluate` (same-origin) — handy for asserting
  exact series colors. Theme is not OS-driven (`enableSystem={false}`): to shoot dark mode, set
  `localStorage["stance-radar-theme"]="dark"` via `page.addInitScript` before `goto`.
- Disk: the playwright image is ~1.5 GB and this env is disk-constrained — `docker rm -f shooter`
  when done, and `docker rmi mcr.microsoft.com/playwright:v${VER}-noble` if space is tight.
  Frequent `frontend` rebuilds also pile up dangling images; `docker image prune -f` reclaims
  them (it freed ~22 GB once here).

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
of `stance-e2e-*` images (~2–3G)**. Frequently rebuilding the api / frontend
images during development (e.g. the rebuild-before-pytest loop) also accumulates
layers and can fill the disk on its own, so run `make clean-docker` periodically
even without E2E. After running E2E or when space is tight, clean up in one shot:

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
