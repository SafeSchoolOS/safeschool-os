#!/usr/bin/env bash
# ==============================================================================
# SafeSchool OS -- First Boot Provisioning Script
# ==============================================================================
# Copyright (c) 2026 SafeSchool. All rights reserved.
# Licensed under the SafeSchool Platform License.
#
# This script runs once on the first boot after Ubuntu autoinstall completes.
# It clones the SafeSchool repository, generates secrets, starts Docker
# services, configures systemd, hardens SSH, and sets up monitoring.
#
# Managed by: safeschool-first-boot.service (systemd)
# ==============================================================================
set -euo pipefail

# -- Configuration ------------------------------------------------------------
SAFESCHOOL_REPO="https://github.com/bwattendorf/safeSchool.git"
INSTALL_DIR="/opt/safeschool"
EDGE_DIR="${INSTALL_DIR}/deploy/edge"
COMPOSE_FILE="${EDGE_DIR}/docker-compose.yml"
ENV_FILE="${EDGE_DIR}/.env"
LOG_FILE="/var/log/safeschool/first-boot.log"
BACKUP_DIR="${INSTALL_DIR}/backups"

# -- Logging ------------------------------------------------------------------
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_section() {
    echo ""
    echo "========================================"
    echo "  $*"
    echo "========================================"
}

log_error() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# -- Banner -------------------------------------------------------------------
log_section "SafeSchool Edge -- First Boot Provisioning"
log "Starting first-boot provisioning at $(date -u)"
log "Hostname: $(hostname)"
log "Kernel: $(uname -r)"

# ==============================================================================
# Step 0: Fix user/group setup deferred from autoinstall late-commands
# ==============================================================================
# The safeschool user is created by cloud-init on first boot, AFTER late-commands
# run. So docker group membership and file ownership must be done here.
log_section "Step 0/20: Finalizing user and ownership setup"
usermod -aG docker safeschool 2>/dev/null && log "Added safeschool to docker group" || log "safeschool already in docker group or user missing"
chown -R safeschool:safeschool /opt/safeschool 2>/dev/null || true
chown -R safeschool:safeschool /etc/safeschool 2>/dev/null || true
chown -R safeschool:safeschool /var/log/safeschool 2>/dev/null || true

# ==============================================================================
# Step 1: Wait for network connectivity (DHCP is active during first boot)
# ==============================================================================
log_section "Step 1/20: Waiting for network connectivity"

# First boot uses DHCP so the mini PC works on any network.
# Static IP (192.168.0.250) is applied at the END of first-boot after everything is set up.
DHCP_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$DHCP_IP" ]; then
    log "Current IP (DHCP): ${DHCP_IP}"
else
    log "No IP assigned yet. Waiting for DHCP..."
fi

MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if ping -c 1 -W 3 github.com &>/dev/null; then
        log "Network is available (internet reachable)."
        DHCP_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        log "DHCP IP: ${DHCP_IP}"
        break
    fi
    # Check if we at least have a local IP (offline deployment)
    if [ $WAITED -eq 30 ]; then
        DHCP_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        if [ -n "$DHCP_IP" ]; then
            log "Local IP assigned: ${DHCP_IP} (no internet — offline boot)"
        fi
    fi
    log "Waiting for network... (${WAITED}s/${MAX_WAIT}s)"
    sleep 5
    WAITED=$((WAITED + 5))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    log "Network connectivity timeout (no internet). Continuing with offline boot..."
    log "DNS resolv.conf:"
    cat /etc/resolv.conf || true
    log "IP addresses:"
    ip addr show || true
fi

# ==============================================================================
# Step 2: Clone SafeSchool repository (non-fatal — embedded files are sufficient)
# ==============================================================================
log_section "Step 2/20: Cloning SafeSchool repository"

GIT_CLONE_OK=false

if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Repository already exists at ${INSTALL_DIR}. Pulling latest..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin main && GIT_CLONE_OK=true || log "Git pull failed. Using existing code."
else
    log "Cloning ${SAFESCHOOL_REPO} to ${INSTALL_DIR}..."
    # Ensure directory exists but is empty for clone
    if [ -d "$INSTALL_DIR" ]; then
        # Preserve any files placed during autoinstall (first-boot.sh, motd, docker-images, deploy, etc.)
        TEMP_PRESERVE=$(mktemp -d)
        cp -a "${INSTALL_DIR}"/* "$TEMP_PRESERVE/" 2>/dev/null || true
        rm -rf "${INSTALL_DIR}"
    fi

    if git clone "$SAFESCHOOL_REPO" "$INSTALL_DIR" 2>&1; then
        GIT_CLONE_OK=true
    else
        log "WARNING: Git clone failed (no network or private repo). Using embedded files."
        # Recreate the directory and restore preserved files
        mkdir -p "$INSTALL_DIR"
    fi

    # Restore preserved files (first-boot.sh, motd, docker-images, deploy/edge, etc.)
    if [ -d "${TEMP_PRESERVE:-}" ]; then
        cp -a "$TEMP_PRESERVE"/* "${INSTALL_DIR}/" 2>/dev/null || true
        rm -rf "$TEMP_PRESERVE"
    fi
fi

cd "$INSTALL_DIR"
if [ "$GIT_CLONE_OK" = "true" ] && [ -d "${INSTALL_DIR}/.git" ]; then
    log "Repository ready. Current commit: $(git log --oneline -1)"
else
    log "Running from embedded deploy files (no git repo). Git clone can be done later when network is available."
fi

# ==============================================================================
# Step 3: Generate .env with secure random values
# ==============================================================================
log_section "Step 3/20: Generating environment configuration"

if [ -f "$ENV_FILE" ]; then
    log ".env already exists. Skipping generation."
else
    if [ ! -f "${EDGE_DIR}/.env.example" ]; then
        log_error ".env.example not found at ${EDGE_DIR}/.env.example"
        exit 1
    fi

    cp "${EDGE_DIR}/.env.example" "$ENV_FILE"

    # Generate secure random secrets
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)
    JWT_SECRET=$(openssl rand -base64 48 | tr -d '=/+' | head -c 48)

    # Replace placeholder values
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"

    log "Generated secure secrets for DB_PASSWORD, JWT_SECRET."
fi

# ==============================================================================
# Step 4: Set OPERATING_MODE=edge
# ==============================================================================
log_section "Step 4/20: Setting operating mode"

if grep -q "^OPERATING_MODE=" "$ENV_FILE"; then
    sed -i "s|^OPERATING_MODE=.*|OPERATING_MODE=edge|" "$ENV_FILE"
else
    echo "OPERATING_MODE=edge" >> "$ENV_FILE"
fi
log "OPERATING_MODE set to 'edge'."

# ==============================================================================
# Step 5: Set SITE_ID placeholder
# ==============================================================================
log_section "Step 5/20: Setting SITE_ID placeholder"

# Load site.conf if it has values
SITE_CONF="/etc/safeschool/site.conf"
if [ -f "$SITE_CONF" ]; then
    SITE_ID_CONF=$(grep -E '^SITE_ID=' "$SITE_CONF" | cut -d= -f2- || true)
    SITE_NAME_CONF=$(grep -E '^SITE_NAME=' "$SITE_CONF" | cut -d= -f2- || true)

    if [ -n "$SITE_ID_CONF" ]; then
        sed -i "s|^SITE_ID=.*|SITE_ID=${SITE_ID_CONF}|" "$ENV_FILE"
        log "SITE_ID loaded from site.conf: ${SITE_ID_CONF}"
    fi
    if [ -n "$SITE_NAME_CONF" ]; then
        sed -i "s|^SITE_NAME=.*|SITE_NAME=${SITE_NAME_CONF}|" "$ENV_FILE"
        log "SITE_NAME loaded from site.conf: ${SITE_NAME_CONF}"
    fi
fi

log "SITE_ID placeholder set. Configure with: sudo safeschool config"

# Secure the .env file
chmod 600 "$ENV_FILE"

# Write version.json for the admin UI version display
VERSION_FILE="/etc/safeschool/version.json"
ISO_BUILD_TAG="${ISO_VERSION:-unknown}"
# Try to extract commit from tag like "edge-20260215-abc1234"
ISO_COMMIT=$(echo "$ISO_BUILD_TAG" | grep -oP '[a-f0-9]{7}$' || echo "")
cat > "$VERSION_FILE" <<VEOF
{
  "version": "${ISO_BUILD_TAG}",
  "tag": "${ISO_BUILD_TAG}",
  "commit": "${ISO_COMMIT}",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
VEOF
chmod 644 "$VERSION_FILE"
log "Version file written: ${VERSION_FILE} (${ISO_BUILD_TAG})"

# ==============================================================================
# Step 6: Load Docker images (embedded tars first, then pull as fallback)
# ==============================================================================
log_section "Step 6/20: Loading Docker images"

cd "$INSTALL_DIR"
EMBEDDED_IMAGES_DIR="${INSTALL_DIR}/docker-images"

if [ -d "$EMBEDDED_IMAGES_DIR" ] && ls "$EMBEDDED_IMAGES_DIR"/*.tar.gz 1>/dev/null 2>&1; then
    log "Found embedded Docker images. Loading from tarballs..."
    for tarball in "$EMBEDDED_IMAGES_DIR"/*.tar.gz; do
        IMAGE_NAME=$(basename "$tarball" .tar.gz)
        log "Loading ${IMAGE_NAME}..."
        if docker load < "$tarball" 2>&1; then
            log "${IMAGE_NAME} loaded successfully."
        else
            log_error "Failed to load ${IMAGE_NAME} from tarball."
        fi
    done

    # Clean up tarballs to free disk space (~500MB-1GB)
    log "Cleaning up embedded image tarballs to free disk space..."
    FREED_SIZE=$(du -sh "$EMBEDDED_IMAGES_DIR" | cut -f1)
    rm -rf "$EMBEDDED_IMAGES_DIR"
    log "Freed ${FREED_SIZE} of disk space."
else
    log "No embedded images found. Pulling from GHCR..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull 2>&1 || log_error "Docker pull failed. Services may not start."
fi
log "Docker images ready."

# ==============================================================================
# Step 7: Docker compose up
# ==============================================================================
log_section "Step 7/20: Starting SafeSchool services"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d 2>&1
log "Docker Compose up complete."

# Wait for services to become healthy
log "Waiting for services to become healthy..."
MAX_HEALTH_WAIT=180
HEALTH_WAITED=0
while [ $HEALTH_WAITED -lt $MAX_HEALTH_WAIT ]; do
    if curl -sf http://127.0.0.1:3443/health &>/dev/null; then
        log "API health check passed."
        break
    fi
    sleep 10
    HEALTH_WAITED=$((HEALTH_WAITED + 10))
    log "Waiting for API... (${HEALTH_WAITED}s/${MAX_HEALTH_WAIT}s)"
done

if [ $HEALTH_WAITED -ge $MAX_HEALTH_WAIT ]; then
    log "WARNING: API health check timed out. Services may still be starting."
    log "Check with: docker compose -f ${COMPOSE_FILE} ps"
fi

# ==============================================================================
# Step 8: Create systemd service
# ==============================================================================
log_section "Step 8/20: Creating systemd service"

cat > /etc/systemd/system/safeschool.service <<SVCEOF
[Unit]
Description=SafeSchool OS Edge Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d
ExecStop=/usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} down
ExecReload=/bin/bash -c '/usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} pull && /usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d'
TimeoutStartSec=300
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
log "Systemd service file created."

# ==============================================================================
# Step 9: Enable the systemd service
# ==============================================================================
log_section "Step 9/20: Enabling systemd service"

systemctl enable safeschool.service
log "safeschool.service enabled -- will start on boot."

# ==============================================================================
# Step 10: Set up daily backup cron job (2 AM UTC)
# ==============================================================================
log_section "Step 10/20: Setting up daily backup cron"

BACKUP_SCRIPT="${EDGE_DIR}/backup.sh"
if [ -f "$BACKUP_SCRIPT" ]; then
    chmod +x "$BACKUP_SCRIPT"

    # Create cron entry
    CRON_LINE="0 2 * * * /usr/bin/bash ${BACKUP_SCRIPT} >> /var/log/safeschool/backup-cron.log 2>&1"

    # Add to root's crontab if not already present
    (crontab -l 2>/dev/null | grep -v "backup.sh" || true; echo "$CRON_LINE") | crontab -
    log "Daily backup cron job set for 2:00 AM UTC."
else
    log "WARNING: backup.sh not found at ${BACKUP_SCRIPT}."
fi

# Create backup directories
mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"
chown -R safeschool:safeschool "${BACKUP_DIR}"
log "Backup directories created at ${BACKUP_DIR}."

# ==============================================================================
# Step 11: Set up logrotate
# ==============================================================================
log_section "Step 11/20: Configuring logrotate"

cat > /etc/logrotate.d/safeschool <<'LOGROTATE'
/var/log/safeschool/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 safeschool safeschool
    sharedscripts
    postrotate
        # Signal Docker containers to reopen log files if needed
        /usr/bin/docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml kill -s USR1 api 2>/dev/null || true
    endscript
}
LOGROTATE

log "Logrotate configured for /var/log/safeschool/*.log (14 days, compressed)."

# ==============================================================================
# Step 12: Harden SSH
# ==============================================================================
log_section "Step 12/20: Hardening SSH configuration"

SSHD_CONFIG="/etc/ssh/sshd_config"

# Create a SafeSchool-specific SSH config drop-in
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-safeschool.conf <<'SSHCONF'
# SafeSchool Edge -- SSH Hardening
# Applied by first-boot provisioning

# Disable root login
PermitRootLogin no

# Limit authentication attempts
MaxAuthTries 3

# Disable empty passwords
PermitEmptyPasswords no

# Disable X11 forwarding (not needed on edge device)
X11Forwarding no

# Set idle timeout (15 minutes)
ClientAliveInterval 300
ClientAliveCountMax 3

# Disable TCP forwarding (security hardening)
AllowTcpForwarding no

# Log level for audit trail
LogLevel VERBOSE

# NOTE: PasswordAuthentication is left enabled for initial setup.
# After adding SSH keys, run: safeschool harden-ssh
# This will disable password authentication entirely.
SSHCONF

# Restart SSH to apply changes
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true
log "SSH hardened: root login disabled, MaxAuthTries 3, idle timeout 15min."

# ==============================================================================
# Step 13: Configure UFW firewall
# ==============================================================================
log_section "Step 13/20: Verifying UFW firewall rules"

# UFW should already be configured by autoinstall late-commands, but verify
if command -v ufw &>/dev/null; then
    ufw status | tee -a "$LOG_FILE"
    # Ensure rules are present
    ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
    ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true
    ufw allow 443/tcp comment 'HTTPS - Dashboard' 2>/dev/null || true
    ufw allow 3443/tcp comment 'HTTPS - API' 2>/dev/null || true
    ufw allow 8443/tcp comment 'HTTPS - Kiosk' 2>/dev/null || true
    ufw allow 9090/tcp comment 'Network Admin UI' 2>/dev/null || true
    echo "y" | ufw enable 2>/dev/null || true
    log "UFW firewall rules verified."
else
    log "WARNING: UFW not found."
fi

# ==============================================================================
# Step 14: Configure fail2ban
# ==============================================================================
log_section "Step 14/20: Configuring fail2ban"

if command -v fail2ban-client &>/dev/null; then
    cat > /etc/fail2ban/jail.local <<'FAIL2BAN'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime  = 7200
FAIL2BAN

    systemctl enable fail2ban
    systemctl restart fail2ban
    log "fail2ban configured: SSH brute-force protection enabled."
else
    log "WARNING: fail2ban not installed."
fi

# ==============================================================================
# Step 15/20: Generate admin token for Network Admin web UI
# ==============================================================================
log_section "Step 15/20: Generating admin token"

ADMIN_TOKEN_FILE="/etc/safeschool/admin-token"
if [ ! -f "$ADMIN_TOKEN_FILE" ]; then
    ADMIN_TOKEN=$(openssl rand -hex 8)
    mkdir -p /etc/safeschool
    echo "$ADMIN_TOKEN" > "$ADMIN_TOKEN_FILE"
    chmod 600 "$ADMIN_TOKEN_FILE"
    chown root:root "$ADMIN_TOKEN_FILE"
    log "Admin token generated and saved to ${ADMIN_TOKEN_FILE}"
    log "Token: ${ADMIN_TOKEN} (also shown in MOTD and via 'safeschool admin-token')"
else
    ADMIN_TOKEN=$(cat "$ADMIN_TOKEN_FILE")
    log "Admin token already exists: ${ADMIN_TOKEN_FILE}"
fi

# ==============================================================================
# Step 16/20: Install Network Admin web UI service
# ==============================================================================
log_section "Step 16/20: Installing Network Admin web UI"

NETWORK_ADMIN_SCRIPT="/opt/safeschool/network-admin.py"
if [ -f "$NETWORK_ADMIN_SCRIPT" ]; then
    chmod +x "$NETWORK_ADMIN_SCRIPT"

    cat > /etc/systemd/system/safeschool-network-admin.service <<'NASVC'
[Unit]
Description=SafeSchool Network Admin Web UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/safeschool/network-admin.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
NASVC

    systemctl daemon-reload
    systemctl enable safeschool-network-admin.service
    systemctl start safeschool-network-admin.service

    # Verify it started
    sleep 2
    if curl -sf http://127.0.0.1:9090/ &>/dev/null; then
        log "Network Admin web UI is running on port 9090."
    else
        log "WARNING: Network Admin web UI may not have started yet."
    fi
else
    log "WARNING: network-admin.py not found at ${NETWORK_ADMIN_SCRIPT}."
fi

# ==============================================================================
# Step 17/20: Set the MOTD with status info
# ==============================================================================
log_section "Step 17/20: Installing MOTD"

MOTD_SCRIPT="/opt/safeschool/safeschool-motd.sh"
MOTD_TARGET="/etc/update-motd.d/99-safeschool"

if [ -f "$MOTD_SCRIPT" ]; then
    cp "$MOTD_SCRIPT" "$MOTD_TARGET"
    chmod +x "$MOTD_TARGET"
    log "Dynamic MOTD installed at ${MOTD_TARGET}."
else
    log "WARNING: safeschool-motd.sh not found. Using default MOTD."
    cat > "$MOTD_TARGET" <<'MOTD_FALLBACK'
#!/bin/bash
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
echo ""
echo "  ======================================"
echo "  SafeSchool Edge"
echo "  ======================================"
echo "  Hostname: $(hostname)"
echo "  IP:       ${IP}"
echo "  Uptime:   $(uptime -p)"
echo ""
echo "  Dashboard: http://${IP}"
echo "  Kiosk:     http://${IP}:8443"
echo "  API:       http://${IP}:3443"
echo ""
echo "  Run 'safeschool status' for service info."
echo "  ======================================"
echo ""
# SSH hardening reminder
if grep -q "PasswordAuthentication yes" /etc/ssh/sshd_config.d/99-safeschool.conf 2>/dev/null || \
   ! grep -q "PasswordAuthentication no" /etc/ssh/sshd_config.d/99-safeschool.conf 2>/dev/null; then
  echo "  WARNING: SSH password auth is still enabled."
  echo "  Add SSH keys, then run: safeschool harden-ssh"
  echo ""
fi
MOTD_FALLBACK
    chmod +x "$MOTD_TARGET"
fi

# ==============================================================================
# Step 18/20: Create /usr/local/bin/safeschool CLI helper
# ==============================================================================
log_section "Step 18/20: Installing safeschool CLI helper"

cat > /usr/local/bin/safeschool <<'CLIMAIN'
#!/usr/bin/env bash
# ==============================================================================
# SafeSchool OS -- Edge CLI Helper
# ==============================================================================
# Copyright (c) 2026 SafeSchool. All rights reserved.
# Usage: safeschool <command> [args]
# ==============================================================================

set -euo pipefail

INSTALL_DIR="/opt/safeschool"
EDGE_DIR="${INSTALL_DIR}/deploy/edge"
COMPOSE_FILE="${EDGE_DIR}/docker-compose.yml"
ENV_FILE="${EDGE_DIR}/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
    echo ""
    echo -e "${CYAN}${BOLD}SafeSchool Edge CLI${NC}"
    echo ""
    echo "Usage: safeschool <command> [args]"
    echo ""
    echo "Commands:"
    echo -e "  ${BOLD}status${NC}            Show service status"
    echo -e "  ${BOLD}logs${NC} [service]     Show logs (optional: api, worker, dashboard, postgres, redis)"
    echo -e "  ${BOLD}update${NC}            Pull latest code and restart services"
    echo -e "  ${BOLD}backup${NC}            Run a database backup now"
    echo -e "  ${BOLD}restore${NC} [file]     Restore database from backup"
    echo -e "  ${BOLD}config${NC}            Edit the .env configuration file"
    echo -e "  ${BOLD}restart${NC}           Restart all SafeSchool services"
    echo -e "  ${BOLD}stop${NC}              Stop all SafeSchool services"
    echo -e "  ${BOLD}start${NC}             Start all SafeSchool services"
    echo -e "  ${BOLD}ps${NC}                Show running containers"
    echo -e "  ${BOLD}version${NC}           Show version information"
    echo -e "  ${BOLD}health${NC}            Check API health endpoint"
    echo -e "  ${BOLD}network${NC} [cmd]     Network config (show, set, dhcp, test)"
    echo -e "  ${BOLD}admin-token${NC}       Display the admin token for web UI"
    echo -e "  ${BOLD}harden-ssh${NC}        Disable SSH password auth (after adding keys)"
    echo -e "  ${BOLD}help${NC}              Show this help message"
    echo ""
}

cmd_status() {
    echo ""
    echo -e "${CYAN}${BOLD}SafeSchool Edge -- Service Status${NC}"
    echo ""

    # System info
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
    echo -e "${BOLD}System:${NC}"
    echo "  Hostname: $(hostname)"
    echo "  IP:       ${ip}"
    echo "  Uptime:   $(uptime -p)"
    echo ""

    # Systemd service
    echo -e "${BOLD}Systemd Service:${NC}"
    if systemctl is-active safeschool.service &>/dev/null; then
        echo -e "  safeschool.service: ${GREEN}active${NC}"
    else
        echo -e "  safeschool.service: ${RED}inactive${NC}"
    fi
    echo ""

    # Docker containers
    echo -e "${BOLD}Docker Containers:${NC}"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps 2>/dev/null || echo "  (unable to query Docker)"
    echo ""

    # API health
    echo -e "${BOLD}API Health:${NC}"
    if curl -sf http://127.0.0.1:3443/health &>/dev/null; then
        local health
        health=$(curl -sf http://127.0.0.1:3443/health)
        echo -e "  ${GREEN}Healthy${NC}: ${health}"
    else
        echo -e "  ${RED}Unhealthy or unreachable${NC}"
    fi
    echo ""

    # Disk usage
    echo -e "${BOLD}Disk Usage:${NC}"
    df -h / | tail -1 | awk '{printf "  Used: %s / %s (%s)\n", $3, $2, $5}'
    echo ""

    # URLs
    echo -e "${BOLD}URLs:${NC}"
    echo "  Dashboard: http://${ip}"
    echo "  Kiosk:     http://${ip}:8443"
    echo "  API:       http://${ip}:3443"
    echo ""
}

cmd_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f --tail=100 "$service"
    else
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f --tail=100
    fi
}

cmd_update() {
    local update_script="${EDGE_DIR}/update.sh"
    if [ -f "$update_script" ]; then
        echo "Running SafeSchool update..."
        sudo bash "$update_script"
    else
        echo -e "${RED}update.sh not found at ${update_script}${NC}"
        exit 1
    fi
}

cmd_backup() {
    local backup_script="${EDGE_DIR}/backup.sh"
    if [ -f "$backup_script" ]; then
        echo "Running database backup..."
        sudo bash "$backup_script"
    else
        echo -e "${RED}backup.sh not found at ${backup_script}${NC}"
        exit 1
    fi
}

cmd_restore() {
    local restore_script="${EDGE_DIR}/restore.sh"
    local backup_file="${1:-}"
    if [ -f "$restore_script" ]; then
        if [ -n "$backup_file" ]; then
            sudo bash "$restore_script" "$backup_file"
        else
            sudo bash "$restore_script"
        fi
    else
        echo -e "${RED}restore.sh not found at ${restore_script}${NC}"
        exit 1
    fi
}

cmd_config() {
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}.env file not found at ${ENV_FILE}${NC}"
        exit 1
    fi

    local editor="${EDITOR:-nano}"
    echo "Opening ${ENV_FILE} with ${editor}..."
    echo -e "${YELLOW}After editing, run 'safeschool restart' to apply changes.${NC}"
    sudo "$editor" "$ENV_FILE"
}

cmd_restart() {
    echo "Restarting SafeSchool services..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    echo -e "${GREEN}Services restarted.${NC}"
}

cmd_stop() {
    echo "Stopping SafeSchool services..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    echo -e "${YELLOW}Services stopped.${NC}"
}

cmd_start() {
    echo "Starting SafeSchool services..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    echo -e "${GREEN}Services started.${NC}"
}

cmd_ps() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
}

cmd_version() {
    echo ""
    echo -e "${CYAN}${BOLD}SafeSchool Edge${NC}"
    cd "$INSTALL_DIR" 2>/dev/null || true
    if [ -d "${INSTALL_DIR}/.git" ]; then
        echo "  Commit:  $(git -C "$INSTALL_DIR" log --oneline -1 2>/dev/null || echo 'unknown')"
        echo "  Branch:  $(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
        echo "  Date:    $(git -C "$INSTALL_DIR" log -1 --format=%ci 2>/dev/null || echo 'unknown')"
    else
        echo "  Version: unknown (not a git repository)"
    fi
    echo "  OS:      $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || echo 'unknown')"
    echo "  Docker:  $(docker --version 2>/dev/null | head -1 || echo 'not installed')"
    echo ""
}

cmd_health() {
    echo "Checking API health..."
    if curl -sf http://127.0.0.1:3443/health; then
        echo ""
        echo -e "${GREEN}API is healthy.${NC}"
    else
        echo -e "${RED}API is not responding.${NC}"
        exit 1
    fi
}

cmd_harden_ssh() {
    echo -e "${BOLD}SSH Hardening — Disable Password Authentication${NC}"
    echo ""

    # Check if SSH keys are installed for the safeschool user
    local auth_keys="/home/safeschool/.ssh/authorized_keys"
    if [ ! -f "$auth_keys" ] || [ ! -s "$auth_keys" ]; then
        echo -e "${RED}ERROR: No SSH keys found for the safeschool user.${NC}"
        echo ""
        echo "You must add at least one SSH key before disabling password auth."
        echo "Add your key with:"
        echo "  ssh-copy-id safeschool@$(hostname -I 2>/dev/null | awk '{print $1}')"
        echo ""
        echo "Then run this command again."
        exit 1
    fi

    local key_count
    key_count=$(grep -cE '^ssh-' "$auth_keys" 2>/dev/null || echo "0")
    echo -e "Found ${GREEN}${key_count}${NC} SSH key(s) in ${auth_keys}"
    echo ""

    # Confirm
    echo -e "${YELLOW}WARNING: After this change, you can ONLY log in via SSH key.${NC}"
    echo -e "${YELLOW}Make sure you have tested your SSH key login before proceeding.${NC}"
    echo ""
    read -rp "Disable password authentication? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 0
    fi

    # Add PasswordAuthentication no to the SafeSchool SSH config
    local ssh_conf="/etc/ssh/sshd_config.d/99-safeschool.conf"
    if grep -q "PasswordAuthentication" "$ssh_conf" 2>/dev/null; then
        sudo sed -i 's/.*PasswordAuthentication.*/PasswordAuthentication no/' "$ssh_conf"
    else
        echo "PasswordAuthentication no" | sudo tee -a "$ssh_conf" > /dev/null
    fi

    # Also disable challenge-response auth
    if ! grep -q "ChallengeResponseAuthentication" "$ssh_conf" 2>/dev/null; then
        echo "ChallengeResponseAuthentication no" | sudo tee -a "$ssh_conf" > /dev/null
    fi

    # Disable keyboard-interactive
    if ! grep -q "KbdInteractiveAuthentication" "$ssh_conf" 2>/dev/null; then
        echo "KbdInteractiveAuthentication no" | sudo tee -a "$ssh_conf" > /dev/null
    fi

    sudo systemctl restart sshd 2>/dev/null || sudo systemctl restart ssh 2>/dev/null || true

    echo ""
    echo -e "${GREEN}SSH password authentication disabled.${NC}"
    echo "Only SSH key authentication is now allowed."
    echo ""
    echo -e "${YELLOW}IMPORTANT: Keep this terminal open and test SSH key login in another window before closing.${NC}"
}

cmd_admin_token() {
    local token_file="/etc/safeschool/admin-token"
    if [ -f "$token_file" ]; then
        local token
        token=$(sudo cat "$token_file" 2>/dev/null)
        if [ -n "$token" ]; then
            echo ""
            echo -e "${CYAN}${BOLD}SafeSchool Edge -- Admin Token${NC}"
            echo ""
            echo -e "  Token:  ${BOLD}${token}${NC}"
            echo ""
            echo -e "  Use this token to log in to the Network Admin web UI:"
            local ip
            ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "192.168.0.250")
            echo -e "  ${BOLD}http://${ip}:9090${NC}"
            echo ""
        else
            echo -e "${RED}Cannot read admin token. Try with sudo.${NC}"
        fi
    else
        echo -e "${RED}Admin token not found at ${token_file}${NC}"
        echo "The token is generated during first boot."
    fi
}

cmd_network() {
    local subcmd="${1:-show}"
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

    case "$subcmd" in
        show)
            echo ""
            echo -e "${CYAN}${BOLD}SafeSchool Edge -- Network Configuration${NC}"
            echo ""
            echo -e "${BOLD}Interface:${NC}"
            ip -br addr show 2>/dev/null | grep -v "^lo" || ip addr show
            echo ""
            echo -e "${BOLD}Default Route:${NC}"
            ip route show default 2>/dev/null || echo "  (none)"
            echo ""
            echo -e "${BOLD}DNS:${NC}"
            grep "^nameserver" /etc/resolv.conf 2>/dev/null || echo "  (none)"
            echo ""
            echo -e "${BOLD}Netplan Config:${NC}"
            for f in /etc/netplan/*.yaml /etc/netplan/*.yml; do
                if [ -f "$f" ]; then
                    echo "  --- $f ---"
                    sudo cat "$f" 2>/dev/null
                    echo ""
                fi
            done
            echo -e "${BOLD}Network Admin UI:${NC}  http://${ip}:9090"
            echo ""
            ;;
        set)
            echo ""
            echo -e "${CYAN}${BOLD}SafeSchool Edge -- Set Static IP${NC}"
            echo ""
            # Detect default interface
            local iface
            iface=$(ip -j route show default 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['dev'])" 2>/dev/null || echo "")
            if [ -z "$iface" ]; then
                iface=$(ip -br link show | grep -v "^lo" | head -1 | awk '{print $1}')
            fi
            echo "Detected interface: ${iface}"
            echo ""

            read -rp "IP Address [${ip}]: " new_ip
            new_ip="${new_ip:-$ip}"
            read -rp "CIDR prefix [24]: " new_cidr
            new_cidr="${new_cidr:-24}"
            read -rp "Gateway [$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)]: " new_gw
            new_gw="${new_gw:-$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)}"
            read -rp "DNS Primary [8.8.8.8]: " new_dns1
            new_dns1="${new_dns1:-8.8.8.8}"
            read -rp "DNS Secondary [1.1.1.1]: " new_dns2
            new_dns2="${new_dns2:-1.1.1.1}"

            echo ""
            echo "New configuration:"
            echo "  IP:      ${new_ip}/${new_cidr}"
            echo "  Gateway: ${new_gw}"
            echo "  DNS:     ${new_dns1}, ${new_dns2}"
            echo "  Iface:   ${iface}"
            echo ""
            read -rp "Apply this configuration? (yes/no): " confirm
            if [ "$confirm" != "yes" ]; then
                echo "Aborted."
                return 0
            fi

            # Write netplan
            sudo bash -c "cat > /etc/netplan/99-safeschool-static.yaml" <<NETPLAN_EOF
# SafeSchool Edge -- Static IP (set via CLI)
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${new_ip}/${new_cidr}
      routes:
        - to: default
          via: ${new_gw}
      nameservers:
        addresses: [${new_dns1}, ${new_dns2}]
NETPLAN_EOF

            # Remove old configs
            for f in /etc/netplan/00-installer-config.yaml /etc/netplan/50-cloud-init.yaml; do
                sudo rm -f "$f" 2>/dev/null
            done

            sudo netplan apply
            echo -e "${GREEN}Network configuration applied.${NC}"
            echo "New IP: $(hostname -I 2>/dev/null | awk '{print $1}')"
            ;;
        dhcp)
            echo "Switching to DHCP..."
            local iface
            iface=$(ip -j route show default 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['dev'])" 2>/dev/null || echo "")
            if [ -z "$iface" ]; then
                iface=$(ip -br link show | grep -v "^lo" | head -1 | awk '{print $1}')
            fi

            sudo bash -c "cat > /etc/netplan/99-safeschool-static.yaml" <<DHCP_EOF
# SafeSchool Edge -- DHCP (set via CLI)
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: true
      dhcp6: false
DHCP_EOF

            for f in /etc/netplan/00-installer-config.yaml /etc/netplan/50-cloud-init.yaml; do
                sudo rm -f "$f" 2>/dev/null
            done

            sudo netplan apply
            echo -e "${GREEN}Switched to DHCP.${NC}"
            sleep 3
            echo "New IP: $(hostname -I 2>/dev/null | awk '{print $1}')"
            ;;
        test)
            echo "Running netplan try (auto-reverts in 120s if not confirmed)..."
            sudo netplan try
            ;;
        *)
            echo "Usage: safeschool network {show|set|dhcp|test}"
            ;;
    esac
}

# -- Main dispatch ---
case "${1:-help}" in
    status)       cmd_status ;;
    logs)         cmd_logs "${2:-}" ;;
    update)       cmd_update ;;
    backup)       cmd_backup ;;
    restore)      cmd_restore "${2:-}" ;;
    config)       cmd_config ;;
    restart)      cmd_restart ;;
    stop)         cmd_stop ;;
    start)        cmd_start ;;
    ps)           cmd_ps ;;
    version)      cmd_version ;;
    health)       cmd_health ;;
    network)      cmd_network "${2:-}" ;;
    admin-token)  cmd_admin_token ;;
    harden-ssh)   cmd_harden_ssh ;;
    help|--help|-h) usage ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        usage
        exit 1
        ;;
esac
CLIMAIN

chmod +x /usr/local/bin/safeschool
log "safeschool CLI installed at /usr/local/bin/safeschool."

# ==============================================================================
# Step 19/20: Switch from DHCP to static IP (192.168.0.250)
# ==============================================================================
log_section "Step 19/20: Switching to static IP"

PENDING_NETPLAN="/etc/netplan/99-safeschool-static.yaml.pending"
STATIC_NETPLAN="/etc/netplan/99-safeschool-static.yaml"

if [ -f "$PENDING_NETPLAN" ]; then
    DHCP_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    log "Current DHCP IP: ${DHCP_IP:-unknown}"
    log "Switching to static IP: 192.168.0.250"

    # Activate the static config
    mv "$PENDING_NETPLAN" "$STATIC_NETPLAN"

    # Remove DHCP configs
    rm -f /etc/netplan/00-installer-config.yaml 2>/dev/null || true
    rm -f /etc/netplan/50-cloud-init.yaml 2>/dev/null || true

    # Disable cloud-init network management so it doesn't revert on next boot
    mkdir -p /etc/cloud/cloud.cfg.d
    echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg

    # Apply the static IP
    netplan apply 2>&1 || log "netplan apply returned non-zero"
    sleep 3

    NEW_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    log "Static IP applied. New IP: ${NEW_IP:-192.168.0.250}"
    log ""
    log "NOTE: If you were connected via SSH on the DHCP IP (${DHCP_IP:-unknown}),"
    log "      reconnect using: ssh safeschool@192.168.0.250"
else
    log "No pending static IP config found. Network unchanged."
    log "Set static IP later with: safeschool network set"
fi

# ==============================================================================
# Step 20/20: Disable first-boot service (self-removal)
# ==============================================================================
log_section "Step 20/20: Disabling first-boot service"

systemctl disable safeschool-first-boot.service 2>/dev/null || true
rm -f /opt/safeschool/first-boot.sh
log "First-boot service disabled. It will not run again."

# ==============================================================================
# Complete
# ==============================================================================
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

ADMIN_TOKEN_DISPLAY=$(cat /etc/safeschool/admin-token 2>/dev/null || echo "unknown")

log_section "SafeSchool Edge -- First Boot Complete"
log ""
log "  Dashboard:     http://${IP}"
log "  Kiosk:         http://${IP}:8443"
log "  API:           http://${IP}:3443"
log "  Network Admin: http://${IP}:9090"
log ""
log "  Admin Token:   ${ADMIN_TOKEN_DISPLAY}"
log "  (use this token to log in to the Network Admin web UI)"
log ""
log "  Username:      safeschool"
log "  CLI:           safeschool status"
log ""
log "  IMPORTANT: Run 'sudo safeschool config' to set:"
log "    - SITE_ID (from SafeSchool cloud)"
log "    - SITE_NAME (your school name)"
log "    - CLOUD_TLS_FINGERPRINT (for cert pinning)"
log "    - Integration API keys"
log ""
log "  SECURITY: After adding SSH keys, run:"
log "    safeschool harden-ssh"
log ""
log "  Then run: safeschool restart"
log ""
log "  Full log: ${LOG_FILE}"
log ""
