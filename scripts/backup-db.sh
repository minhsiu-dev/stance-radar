#!/usr/bin/env bash
# Dump the main Postgres DB (stance_radar) to a local, timestamped file and prune old ones.
#
# Runs pg_dump *inside* the db container (no Postgres client needed on this machine) and
# streams the dump out over stdout, so the file always lands on the machine running this
# script. Works from either place:
#   - inside the sandbox (the `claude` container): talks to the stack's `db` directly.
#   - on the host (e.g. your Mac): the stack lives inside the docker:27-dind container, so
#     the host's docker can't see `db`; it hops through `dind` instead
#     (docker compose -f sandbox/docker-compose.yml exec dind docker exec workspace-db-1 ...).
#
#   scripts/backup-db.sh                 # -> backups/stance_radar-YYYYMMDD-HHMMSS.dump
#   BACKUP_DIR=/some/dir KEEP_DAYS=30 scripts/backup-db.sh
#
# Output is pg_dump custom format (compressed). Restore with:
#   scripts/backup-db.sh --restore backups/<file>.dump
set -euo pipefail

# cron/launchd run with a minimal PATH; make sure docker is findable (incl. Docker Desktop
# on macOS, Intel and Apple Silicon Homebrew).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_NAME="stance_radar"
DB_USER="stance"
# Name of the db container *inside* dind. The sandbox mounts the repo at /workspace, so
# compose's project name there is always "workspace".
DB_CONTAINER="${DB_CONTAINER:-workspace-db-1}"
STACK_COMPOSE="$REPO_DIR/docker-compose.yml"
SANDBOX_COMPOSE="$REPO_DIR/sandbox/docker-compose.yml"

log() { echo "[$(date '+%F %T')] $*"; }

# db_exec CMD... runs CMD in the db container with stdin/stdout passed through.
if [ -n "$(docker compose -f "$STACK_COMPOSE" ps -q db 2>/dev/null)" ]; then
  db_exec() { docker compose -f "$STACK_COMPOSE" exec -T db "$@"; }
elif [ -n "$(docker compose -f "$SANDBOX_COMPOSE" ps -q dind 2>/dev/null)" ]; then
  db_exec() { docker compose -f "$SANDBOX_COMPOSE" exec -T dind docker exec -i "$DB_CONTAINER" "$@"; }
else
  log "ERROR: can't find the db: neither the stack's db service nor the sandbox's dind container is running"
  exit 1
fi

if ! db_exec pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  log "ERROR: db container is not running/ready"
  exit 1
fi

if [ "${1:-}" = "--restore" ]; then
  file="${2:?usage: $0 --restore <file.dump>}"
  [ -f "$file" ] || { log "ERROR: no such file: $file"; exit 1; }
  log "restoring $file into $DB_NAME (replaces current data)"
  db_exec pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner <"$file"
  log "restore OK"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

# Don't let two runs (e.g. cron + manual) write at the same time. mkdir is atomic and,
# unlike flock(1), exists on macOS too. A lock left by a killed run is reclaimed once its
# PID is gone.
lock="$BACKUP_DIR/.lock"
if ! mkdir "$lock" 2>/dev/null; then
  if kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null; then
    log "another backup is running; skipping"
    exit 0
  fi
  rm -rf "$lock" && mkdir "$lock"
fi
echo $$ >"$lock/pid"
tmp=""
trap 'rm -f "$tmp"; rm -rf "$lock"' EXIT

out="$BACKUP_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M%S).dump"
tmp="$out.partial"

db_exec pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner >"$tmp"

# Sanity-check the archive is readable before keeping it (a truncated dump would fail here).
if ! db_exec pg_restore --list <"$tmp" >/dev/null; then
  log "ERROR: dump failed verification; discarded"
  exit 1
fi

mv "$tmp" "$out"
log "backup OK: $out ($(du -h "$out" | cut -f1))"

# Retention: delete dumps older than KEEP_DAYS, but never the newest one.
find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump" -mtime +"$KEEP_DAYS" \
  ! -newer "$out" -print -delete | sed 's/^/pruned: /'
