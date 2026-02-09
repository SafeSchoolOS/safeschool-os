#!/usr/bin/env bash
set -euo pipefail

# SafeSchool OS — Edge Mini PC Database Backup Script
# Run as root: sudo bash backup.sh
# Cron: 0 2 * * * /opt/safeschool/deploy/edge/backup.sh
#
# Keeps 7 daily backups and 4 weekly backups (Sundays).
# Optionally uploads to S3 if AWS_BACKUP_BUCKET is set.

INSTALL_DIR="${EDGE_INSTALL_DIR:-/opt/safeschool}"
COMPOSE_FILE="$INSTALL_DIR/deploy/edge/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/deploy/edge/.env"
BACKUP_DIR="${BACKUP_DIR:-/opt/safeschool/backups}"
LOG_FILE="${BACKUP_LOG:-/var/log/safeschool-backup.log}"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
DAY_OF_WEEK=$(date '+%u')  # 1=Monday, 7=Sunday

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

# --- Ensure backup directory exists ---
mkdir -p "$BACKUP_DIR/daily"
mkdir -p "$BACKUP_DIR/weekly"

log "========================================"
log "  SafeSchool OS — Database Backup"
log "========================================"

# --- Determine postgres container name ---
POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)
if [ -z "$POSTGRES_CONTAINER" ]; then
  log_error "PostgreSQL container is not running. Cannot perform backup."
  exit 1
fi

# --- Perform pg_dump inside the container ---
BACKUP_FILE="safeschool_${TIMESTAMP}.sql.gz"
DAILY_PATH="$BACKUP_DIR/daily/$BACKUP_FILE"

log "Starting pg_dump of safeschool database..."

if docker exec "$POSTGRES_CONTAINER" pg_dump \
  -U safeschool \
  -d safeschool \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  > "$DAILY_PATH" 2>> "$LOG_FILE"; then
  FILESIZE=$(stat -c%s "$DAILY_PATH" 2>/dev/null || stat -f%z "$DAILY_PATH" 2>/dev/null || echo "unknown")
  log "Backup complete: $DAILY_PATH ($FILESIZE bytes)"
else
  log_error "pg_dump failed. Check postgres container health."
  rm -f "$DAILY_PATH"
  exit 1
fi

# --- Verify backup is not empty ---
if [ ! -s "$DAILY_PATH" ]; then
  log_error "Backup file is empty. Aborting."
  rm -f "$DAILY_PATH"
  exit 1
fi

# --- Copy to weekly on Sundays (day 7) ---
if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEKLY_FILE="safeschool_weekly_${TIMESTAMP}.sql.gz"
  cp "$DAILY_PATH" "$BACKUP_DIR/weekly/$WEEKLY_FILE"
  log "Weekly backup saved: $BACKUP_DIR/weekly/$WEEKLY_FILE"
fi

# --- Rotate daily backups: keep only 7 ---
log "Rotating daily backups (keeping 7)..."
DAILY_COUNT=$(ls -1t "$BACKUP_DIR/daily"/safeschool_*.sql.gz 2>/dev/null | wc -l)
if [ "$DAILY_COUNT" -gt 7 ]; then
  ls -1t "$BACKUP_DIR/daily"/safeschool_*.sql.gz | tail -n +"8" | while read -r old_file; do
    log "Removing old daily backup: $old_file"
    rm -f "$old_file"
  done
fi

# --- Rotate weekly backups: keep only 4 ---
log "Rotating weekly backups (keeping 4)..."
WEEKLY_COUNT=$(ls -1t "$BACKUP_DIR/weekly"/safeschool_weekly_*.sql.gz 2>/dev/null | wc -l)
if [ "$WEEKLY_COUNT" -gt 4 ]; then
  ls -1t "$BACKUP_DIR/weekly"/safeschool_weekly_*.sql.gz | tail -n +"5" | while read -r old_file; do
    log "Removing old weekly backup: $old_file"
    rm -f "$old_file"
  done
fi

# --- Optional S3 upload ---
if [ -n "${AWS_BACKUP_BUCKET:-}" ]; then
  if command -v aws &>/dev/null; then
    S3_PREFIX="${AWS_BACKUP_PREFIX:-safeschool/edge}"
    log "Uploading to s3://${AWS_BACKUP_BUCKET}/${S3_PREFIX}/daily/${BACKUP_FILE}..."
    if aws s3 cp "$DAILY_PATH" "s3://${AWS_BACKUP_BUCKET}/${S3_PREFIX}/daily/${BACKUP_FILE}" 2>> "$LOG_FILE"; then
      log "S3 upload complete."

      # Upload weekly too if applicable
      if [ "$DAY_OF_WEEK" = "7" ]; then
        aws s3 cp "$BACKUP_DIR/weekly/$WEEKLY_FILE" \
          "s3://${AWS_BACKUP_BUCKET}/${S3_PREFIX}/weekly/${WEEKLY_FILE}" 2>> "$LOG_FILE"
        log "Weekly S3 upload complete."
      fi
    else
      log_error "S3 upload failed. Backup is still available locally at $DAILY_PATH"
    fi
  else
    log "AWS_BACKUP_BUCKET is set but 'aws' CLI is not installed. Skipping S3 upload."
    log "Install: apt-get install awscli  or  pip install awscli"
  fi
fi

log "========================================"
log "  Backup Complete"
log "  Daily backups: $(ls -1 "$BACKUP_DIR/daily"/safeschool_*.sql.gz 2>/dev/null | wc -l)/7"
log "  Weekly backups: $(ls -1 "$BACKUP_DIR/weekly"/safeschool_weekly_*.sql.gz 2>/dev/null | wc -l)/4"
log "========================================"
