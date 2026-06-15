# Stance Radar — developer helper commands
.PHONY: clean-docker clean-docker-all

# One-shot Docker space cleanup, especially after running E2E / when disk is stuck.
# Does three things, none of which touch the main DB volume (workspace_pgdata = your holdings and analysis data):
#   1. Tear down the whole E2E stack, including its throwaway pgdata test volume (-v)
#   2. Prune unused images (once the E2E stack is down, the stance-e2e-* images get swept)
#   3. Prune build cache
clean-docker:
	-docker compose -p stance-e2e down -v --remove-orphans
	docker image prune -af
	docker builder prune -af
	@echo "✅ Cleaned; the main DB volume (workspace_pgdata) was left untouched."
	@docker system df

# Nuclear: docker system prune -a --volumes.
# ⚠️ Deletes any volume NOT used by a running-or-created container——
#    if the main stack isn't running, workspace_pgdata (your holdings amounts and all analysis data) is permanently deleted.
# So it gates behind a manual confirm; only use this to wipe everything.
clean-docker-all:
	@echo "⚠️  About to run: docker system prune -a --volumes"
	@echo "⚠️  If the main stack isn't running, workspace_pgdata (holdings/analysis data) will be permanently deleted."
	@printf 'Sure? type yes to continue: ' && read ans && [ "$$ans" = yes ] || { echo "Cancelled"; exit 1; }
	docker system prune -a --volumes
