# Stance Radar — 開發輔助指令
.PHONY: clean-docker clean-docker-all

# 一鍵清 Docker 空間,尤其「跑完 E2E / 磁碟卡住」時用。
# 做三件事,全部不碰主資料庫 volume(workspace_pgdata = 你的持股與分析資料):
#   1. 拆掉整套 E2E stack,連它自己用完即丟的 pgdata 測試 volume 一起(-v)
#   2. 清未使用的 image(E2E 拆完後 stance-e2e-* image 就會被掃掉)
#   3. 清 build cache
clean-docker:
	-docker compose -p stance-e2e down -v --remove-orphans
	docker image prune -af
	docker builder prune -af
	@echo "✅ 已清理;主資料庫 volume (workspace_pgdata) 未動。"
	@docker system df

# 核彈級:docker system prune -a --volumes。
# ⚠️ 會刪掉「沒有被任何容器(執行中或已建立)使用」的 volume——
#    若主 stack 不在跑,workspace_pgdata(你的持股金額與全部分析資料)會被永久刪除。
# 因此先擋一道手動確認;真要全清才用這個。
clean-docker-all:
	@echo "⚠️  即將執行:docker system prune -a --volumes"
	@echo "⚠️  若主 stack 沒在跑,workspace_pgdata(持股/分析資料)會被永久刪除。"
	@printf '確定?輸入 yes 繼續:' && read ans && [ "$$ans" = yes ] || { echo "已取消"; exit 1; }
	docker system prune -a --volumes
