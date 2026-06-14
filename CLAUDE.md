# CLAUDE.md

給在這個 repo 工作的 agent 的指引。功能面看 `README.md`,這裡只記開發 / 測試
要注意的地方。

## 架構

三容器:Next.js(:3000)→ FastAPI(:8000)→ Postgres(:5432),定義在
`docker-compose.yml`。

外部服務(YouTube Data API / youtube-transcript-api / Claude Code CLI / yfinance)
都走 adapter 介面,注入點在 `backend/app/main.py` 的 `build_adapters()`:
`USE_FAKE_ADAPTERS=true` 時換成確定性假資料(`FakeYouTubeClient` /
`FakeTranscriptClient` / `FakeLLMClient` / `FakeMarketClient`),否則用真實 client。
測試與假資料試玩都靠這個開關。

## 後端測試流程

後端程式碼是在 build 時 `COPY` 進 image 的(見 `backend/Dockerfile`,**沒有**
source bind-mount),所以改完 code 一定要**先 rebuild** 再跑測試:

```bash
cd /workspace
docker compose build api && docker compose up -d api
docker exec -w /srv \
  -e TEST_DATABASE_URL=postgresql+asyncpg://stance:stance@db:5432/stance_radar_test \
  workspace-api-1 sh -c 'unset BACKFILL_LIMIT && python -m pytest tests/ -q --no-cov'
```

可把 `tests/` 換成單一檔案或路徑只跑那部分。

注意事項:

- **`BACKFILL_LIMIT` 不要留在 `.env`**:`.env` 會被 compose 帶進容器環境,而
  `tests/unit/test_config.py::test_defaults` 斷言預設值 `backfill_limit == 30`,
  環境裡有這個變數就會讓該測試失敗。上面指令的 `unset BACKFILL_LIMIT` 就是為此。
- **已知 flake**:`tests/integration/test_refresh_api.py::test_trigger_refresh_and_poll_until_done`
  在跑全套時偶爾受排序影響而失敗,單獨跑會過(pre-existing,非新 bug)。

conftest(`backend/tests/conftest.py`)會自動建 `stance_radar_test` 資料庫,
`api` fixture 用假 adapter + test db 起完整 ASGI app。

## 前端測試

在 host 跑(不進容器):

```bash
cd /workspace/frontend && npx vitest run && npm run build
```

注意:host 上的 `npm run build` 只是**驗證能不能編譯**,不會更新跑在 :3000 的容器。
frontend 跟 backend 一樣是 `build:` 進 image、**沒有** source bind-mount(見
`docker-compose.yml`),所以改完前端要 reflect 到 :3000 一定要 rebuild image 再重啟:

```bash
docker compose build frontend && docker compose up -d frontend
```

## E2E

預設流程(host 跑 Playwright):

```bash
docker compose -p stance-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
cd e2e && npm test
```

磁碟受限環境(如 CI 沙箱)用 opt-in 的 `docker-compose.e2e.lowdisk.yml`:它把
frontend 改用 `frontend/Dockerfile.e2e`(打包 host 已 build 好的 `.next/standalone`,
跳過容器內 ~1GB npm ci),搭配 `e2e/Dockerfile.testrunner`(容器內跑 Playwright)。

```bash
cd frontend && API_URL=http://api:8000 npm run build && cd ..
docker compose -p stance-e2e \
  -f docker-compose.yml -f docker-compose.e2e.yml -f docker-compose.e2e.lowdisk.yml \
  up -d --build
```

一般情況不需要——細節見 `docker-compose.e2e.lowdisk.yml` 頂端註解。

## Migration 規則

啟動時 `Base.metadata.create_all` 只**建缺少的 table**,不會改既有 type / column。
要改既有 table(加 enum 值、加欄位)寫在 `backend/app/db_migrations.py` 的
`_STATEMENTS`,每條必須冪等(`IF NOT EXISTS`),在 `create_all` 之後執行:全新 DB
這裡全是 no-op,舊 DB 才靠這裡補上。

## i18n 規則

每個 UI 字串都要**同時**進 `frontend/messages/zh-TW.json` 與
`frontend/messages/en.json`。少了任一邊就算沒寫完。

## 市場資料層

- **日 K 線**:`backend/app/market/store.py` 的 `PriceStore` 把日 K 增量落地到
  Postgres(`price_bars` / `price_coverage`),DB 為準、只對缺口批次打 yfinance,
  並會偵測分割 / 除權息造成的序列重新調整而整檔重抓。記分板、圖表的歷史價走這裡。
- **其餘**:即時報價、盤中、搜尋、財報、分析師資料只用記憶體 TTL 快取
  (`backend/app/market/client.py` 的 `YFinanceMarketClient`,各自不同 TTL),
  不落地 DB。

## spec / plan 位置

- 設計 spec:`docs/superpowers/specs/`
- 實作計畫:`docs/superpowers/plans/`

## 磁碟 / Docker 空間

開發是 Docker-in-Docker:image layers、container overlay、build cache 全部存在
daemon 容器的 `/var/lib/docker`,跟 repo 共用同一顆 backing disk(`df /` 看到的
~79G overlay)。從 workspace 容器內 `du` 只看得到自己約 2G,docker 那塊要用
`docker` CLI 看(`docker system df`),不是 `du`。

吃空間的兩個來源:每次 `docker compose build` 累積的 image layer / build cache,
以及 **E2E 會另外 build 一整套 `stance-e2e-*` image(~2–3G)**。跑完 E2E 或空間
吃緊時一鍵清:

```bash
make clean-docker      # 拆 E2E stack(含其拋棄式 pgdata)+ prune image/cache;不碰主 DB
```

`make clean-docker` 不會動 `workspace_pgdata`(你的持股/分析資料)。要連 volume 全清
(會刪掉主 DB)才用 `make clean-docker-all`,它會先要你打 `yes` 確認。
（沒裝 make 時等價於 `docker compose -p stance-e2e down -v --remove-orphans &&
docker image prune -af && docker builder prune -af`。)

**磁碟滿(100%)會害死 Postgres**:它 WAL redo 完、寫 end-of-recovery checkpoint
時 `No space left on device` → PANIC → 重啟 → 無限迴圈,`db` 變 unhealthy、所有
`/api/portfolio/*` 回 500(`CannotConnectNowError: ... in recovery mode`)。
資料沒壞(redo 已完成),只是寫不進去。處理:先清出空間(上面的 prune),再
`docker compose restart db`,幾秒就會 healthy。

79G 大半是 host 共用、非我們可控;真正能回收的只有上面那些 docker artifact。要更大
空間得在開這個 sandbox 的那層(雲端 workspace 磁碟設定 / VM volume / Docker Desktop
的 virtual disk limit)調,容器內無法改。
