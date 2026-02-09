#!/usr/bin/env bash
set -euo pipefail

# SafeSchool OS — Edge Mini PC Update Script
# Run as root: sudo bash update.sh
# Can be triggered via admin dashboard POST /api/v1/admin/update or cron

INSTALL_DIR="/opt/safeschool"
COMPOSE_FILE="deploy/edge/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/deploy/edge/.env"
LOG_FILE="/var/log/safeschool-update.log"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: Run this script as root (sudo bash update.sh)"
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "Error: SafeSchool not installed at $INSTALL_DIR. Run setup.sh first."
  exit 1
fi

log "========================================"
log "  SafeSchool OS — Update Starting"
log "========================================"

cd "$INSTALL_DIR"

# --- Check for updates ---
log "Fetching latest changes..."
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Already up to date ($LOCAL)."
  exit 0
fi

log "Update available: $LOCAL -> $REMOTE"
log "Current version: $(git log --oneline -1)"

# --- Pull latest code ---
log "Pulling latest code..."
if ! git pull --ff-only origin main; then
  log "ERROR: git pull failed. Local changes may conflict."
  log "Fix: cd $INSTALL_DIR && git stash && git pull && git stash pop"
  exit 1
fi

log "New version: $(git log --oneline -1)"

# --- Run database migrations ---
log "Running database migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm migrate

# --- Rebuild and restart services ---
log "Rebuilding and restarting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# --- Wait for health checks ---
log "Waiting for services to become healthy..."
sleep 10

HEALTHY=true
for service in api dashboard; do
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Health}}' "$service" 2>/dev/null || echo "unknown")
  if [ "$STATUS" != "healthy" ]; then
    log "WARNING: $service is $STATUS"
    HEALTHY=false
  else
    log "$service is healthy"
  fi
done

# --- Cleanup old images ---
log "Cleaning up old Docker images..."
docker image prune -f >> "$LOG_FILE" 2>&1

log "========================================"
if [ "$HEALTHY" = true ]; then
  log "  Update Complete — All services healthy"
else
  log "  Update Complete — Some services may need attention"
  log "  Check: docker compose -f $COMPOSE_FILE ps"
fi
log "========================================"
