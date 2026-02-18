#!/usr/bin/env bash
set -euo pipefail

# SafeSchool OS — Edge Mini PC Database Restore Script
# Usage: sudo bash restore.sh <backup-file>
#
# Stops API and worker, restores the database, restarts, and verifies health.

INSTALL_DIR="${EDGE_INSTALL_DIR:-/opt/safeschool}"
COMPOSE_FILE="$INSTALL_DIR/deploy/edge/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/deploy/edge/.env"
BACKUP_DIR="${BACKUP_DIR:-/opt/safeschool/backups}"
LOG_FILE="${BACKUP_LOG:-/var/log/safeschool-backup.log}"

# Load DB_PASSWORD from .env if not already set
if [ -z "${DB_PASSWORD:-}" ] && [ -f "$ENV_FILE" ]; then
  DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || true)
fi

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file>"
  echo ""
  echo "Examples:"
  echo "  $0 /opt/safeschool/backups/daily/safeschool_20260209T020000Z.sql.gz"
  echo "  $0 safeschool_20260209T020000Z.sql.gz"
  echo ""
  echo "Available backups:"
  if [ -d "$BACKUP_DIR" ]; then
    echo "  Daily:"
    ls -1ht "$BACKUP_DIR/daily"/safeschool_*.sql.gz 2>/dev/null | while read -r f; do
      SIZE=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo "?")
      echo "    $(basename "$f")  ($SIZE bytes)"
    done
    echo "  Weekly:"
    ls -1ht "$BACKUP_DIR/weekly"/safeschool_weekly_*.sql.gz 2>/dev/null | while read -r f; do
      SIZE=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo "?")
      echo "    $(basename "$f")  ($SIZE bytes)"
    done
  fi
  exit 1
fi

BACKUP_INPUT="$1"

# --- Resolve backup file path ---
if [ -f "$BACKUP_INPUT" ]; then
  BACKUP_PATH="$BACKUP_INPUT"
elif [ -f "$BACKUP_DIR/daily/$BACKUP_INPUT" ]; then
  BACKUP_PATH="$BACKUP_DIR/daily/$BACKUP_INPUT"
elif [ -f "$BACKUP_DIR/weekly/$BACKUP_INPUT" ]; then
  BACKUP_PATH="$BACKUP_DIR/weekly/$BACKUP_INPUT"
else
  log_error "Backup file not found: $BACKUP_INPUT"
  log_error "Searched: $BACKUP_INPUT, $BACKUP_DIR/daily/$BACKUP_INPUT, $BACKUP_DIR/weekly/$BACKUP_INPUT"
  exit 1
fi

log "========================================"
log "  SafeSchool OS — Database Restore"
log "  Backup: $BACKUP_PATH"
log "========================================"

# --- Confirm if running interactively ---
if [ -t 0 ]; then
  FILESIZE=$(stat -c%s "$BACKUP_PATH" 2>/dev/null || stat -f%z "$BACKUP_PATH" 2>/dev/null || echo "unknown")
  echo ""
  echo "WARNING: This will REPLACE the current database with the backup."
  echo "  File: $(basename "$BACKUP_PATH")"
  echo "  Size: $FILESIZE bytes"
  echo ""
  read -rp "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

# --- Pre-restore: create a safety backup of current database ---
POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)
if [ -n "$POSTGRES_CONTAINER" ]; then
  PRE_RESTORE_FILE="$BACKUP_DIR/daily/safeschool_pre_restore_$(date -u '+%Y%m%dT%H%M%SZ').sql.gz"
  log "Creating pre-restore safety backup: $PRE_RESTORE_FILE"
  mkdir -p "$BACKUP_DIR/daily"
  docker exec "$POSTGRES_CONTAINER" pg_dump \
    -U safeschool \
    -d safeschool \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-acl \
    > "$PRE_RESTORE_FILE" 2>> "$LOG_FILE" || true
  if [ -s "$PRE_RESTORE_FILE" ]; then
    log "Pre-restore backup saved."
  else
    log "WARNING: Pre-restore backup failed or is empty. Continuing anyway."
    rm -f "$PRE_RESTORE_FILE"
  fi
fi

# --- Stop API and worker containers ---
log "Stopping API and worker containers..."
docker compose -f "$COMPOSE_FILE" stop api worker 2>> "$LOG_FILE"
log "API and worker stopped."

# --- Wait for active connections to drain ---
sleep 2

# --- Restore the database ---
POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)
if [ -z "$POSTGRES_CONTAINER" ]; then
  log_error "PostgreSQL container is not running. Cannot restore."
  log "Restarting API and worker..."
  docker compose -f "$COMPOSE_FILE" start api worker 2>> "$LOG_FILE"
  exit 1
fi

log "Dropping and recreating safeschool database..."
docker exec "$POSTGRES_CONTAINER" psql -U safeschool -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'safeschool' AND pid <> pg_backend_pid();" \
  >> "$LOG_FILE" 2>&1 || true

docker exec "$POSTGRES_CONTAINER" psql -U safeschool -d postgres -c \
  "DROP DATABASE IF EXISTS safeschool;" >> "$LOG_FILE" 2>&1

docker exec "$POSTGRES_CONTAINER" psql -U safeschool -d postgres -c \
  "CREATE DATABASE safeschool OWNER safeschool;" >> "$LOG_FILE" 2>&1

log "Restoring from backup..."
if docker exec -i "$POSTGRES_CONTAINER" pg_restore \
  -U safeschool \
  -d safeschool \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  < "$BACKUP_PATH" 2>> "$LOG_FILE"; then
  log "Database restore complete."
else
  # pg_restore returns non-zero for warnings too, check if DB has tables
  TABLE_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U safeschool -d safeschool -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
  if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
    log "pg_restore completed with warnings ($TABLE_COUNT tables restored)."
  else
    log_error "Database restore failed. Attempting to restore from pre-restore backup..."
    if [ -n "${PRE_RESTORE_FILE:-}" ] && [ -s "${PRE_RESTORE_FILE:-}" ]; then
      docker exec -i "$POSTGRES_CONTAINER" pg_restore \
        -U safeschool -d safeschool --no-owner --no-acl \
        < "$PRE_RESTORE_FILE" 2>> "$LOG_FILE" || true
      log "Pre-restore backup applied."
    fi
    docker compose -f "$COMPOSE_FILE" start api worker 2>> "$LOG_FILE"
    exit 1
  fi
fi

# --- Restart API and worker containers ---
log "Starting API and worker containers..."
docker compose -f "$COMPOSE_FILE" start api worker 2>> "$LOG_FILE"

# --- Wait for health checks ---
log "Waiting for services to become healthy..."
MAX_WAIT=90
WAITED=0
ALL_HEALTHY=false

while [ $WAITED -lt $MAX_WAIT ]; do
  sleep 5
  WAITED=$((WAITED + 5))

  API_HEALTH=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Health}}' api 2>/dev/null || echo "unknown")
  if [ "$API_HEALTH" = "healthy" ]; then
    ALL_HEALTHY=true
    break
  fi
  echo -n "."
done
echo ""

# --- Verify health ---
if [ "$ALL_HEALTHY" = true ]; then
  log "API is healthy."
else
  API_STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Status}}' api 2>/dev/null || echo "unknown")
  log "WARNING: API health check timed out (status: $API_STATUS)."
  log "Check manually: docker compose -f $COMPOSE_FILE ps"
fi

# --- Final verification ---
TABLE_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U safeschool -d safeschool -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
log "Database tables: ${TABLE_COUNT:-unknown}"

log "========================================"
log "  Restore Complete"
log "  Source: $(basename "$BACKUP_PATH")"
log "  Tables: ${TABLE_COUNT:-unknown}"
if [ -n "${PRE_RESTORE_FILE:-}" ] && [ -s "${PRE_RESTORE_FILE:-}" ]; then
  log "  Rollback available: $(basename "$PRE_RESTORE_FILE")"
fi
log "========================================"
