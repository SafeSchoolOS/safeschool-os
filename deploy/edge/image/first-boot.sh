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
# Step 1: Wait for network connectivity
# ==============================================================================
log_section "Step 1/17: Waiting for network connectivity"

MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if ping -c 1 -W 3 github.com &>/dev/null; then
        log "Network is available."
        break
    fi
    log "Waiting for network... (${WAITED}s/${MAX_WAIT}s)"
    sleep 5
    WAITED=$((WAITED + 5))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    log_error "Network connectivity timeout. Continuing anyway..."
    log "DNS resolv.conf:"
    cat /etc/resolv.conf || true
    log "IP addresses:"
    ip addr show || true
fi

# ==============================================================================
# Step 2: Clone SafeSchool repository
# ==============================================================================
log_section "Step 2/17: Cloning SafeSchool repository"

if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Repository already exists at ${INSTALL_DIR}. Pulling latest..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin main || log "Git pull failed. Using existing code."
else
    log "Cloning ${SAFESCHOOL_REPO} to ${INSTALL_DIR}..."
    # Ensure directory exists but is empty for clone
    if [ -d "$INSTALL_DIR" ]; then
        # Preserve any files placed during autoinstall (first-boot.sh, motd, etc.)
        TEMP_PRESERVE=$(mktemp -d)
        cp -a "${INSTALL_DIR}"/* "$TEMP_PRESERVE/" 2>/dev/null || true
        rm -rf "${INSTALL_DIR}"
    fi

    git clone "$SAFESCHOOL_REPO" "$INSTALL_DIR"

    # Restore preserved files
    if [ -d "${TEMP_PRESERVE:-}" ]; then
        cp -a "$TEMP_PRESERVE"/* "${INSTALL_DIR}/" 2>/dev/null || true
        rm -rf "$TEMP_PRESERVE"
    fi
fi

cd "$INSTALL_DIR"
log "Repository cloned. Current commit: $(git log --oneline -1)"

# ==============================================================================
# Step 3: Generate .env with secure random values
# ==============================================================================
log_section "Step 3/17: Generating environment configuration"

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
    CLOUD_SYNC_KEY=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)

    # Replace placeholder values
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
    sed -i "s|^CLOUD_SYNC_KEY=.*|CLOUD_SYNC_KEY=${CLOUD_SYNC_KEY}|" "$ENV_FILE"

    log "Generated secure secrets for DB_PASSWORD, JWT_SECRET, CLOUD_SYNC_KEY."
fi

# ==============================================================================
# Step 4: Set OPERATING_MODE=edge
# ==============================================================================
log_section "Step 4/17: Setting operating mode"

if grep -q "^OPERATING_MODE=" "$ENV_FILE"; then
    sed -i "s|^OPERATING_MODE=.*|OPERATING_MODE=edge|" "$ENV_FILE"
else
    echo "OPERATING_MODE=edge" >> "$ENV_FILE"
fi
log "OPERATING_MODE set to 'edge'."

# ==============================================================================
# Step 5: Set SITE_ID placeholder
# ==============================================================================
log_section "Step 5/17: Setting SITE_ID placeholder"

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

# ==============================================================================
# Step 6: Docker compose pull + build
# ==============================================================================
log_section "Step 6/17: Pulling and building Docker images"

cd "$INSTALL_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull --ignore-pull-failures 2>&1 || true
log "Docker pull complete."

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build 2>&1
log "Docker build complete."

# ==============================================================================
# Step 7: Docker compose up
# ==============================================================================
log_section "Step 7/17: Starting SafeSchool services"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d 2>&1
log "Docker Compose up complete."

# Wait for services to become healthy
log "Waiting for services to become healthy..."
MAX_HEALTH_WAIT=180
HEALTH_WAITED=0
while [ $HEALTH_WAITED -lt $MAX_HEALTH_WAIT ]; do
    if curl -sf http://localhost:3000/health &>/dev/null; then
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
log_section "Step 8/17: Creating systemd service"

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
ExecReload=/usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} pull && /usr/bin/docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d
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
log_section "Step 9/17: Enabling systemd service"

systemctl enable safeschool.service
log "safeschool.service enabled -- will start on boot."

# ==============================================================================
# Step 10: Set up daily backup cron job (2 AM UTC)
# ==============================================================================
log_section "Step 10/17: Setting up daily backup cron"

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
log_section "Step 11/17: Configuring logrotate"

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
log_section "Step 12/17: Hardening SSH configuration"

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
log_section "Step 13/17: Verifying UFW firewall rules"

# UFW should already be configured by autoinstall late-commands, but verify
if command -v ufw &>/dev/null; then
    ufw status | tee -a "$LOG_FILE"
    # Ensure rules are present
    ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
    ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true
    ufw allow 443/tcp comment 'HTTPS - Dashboard' 2>/dev/null || true
    ufw allow 3443/tcp comment 'HTTPS - API' 2>/dev/null || true
    ufw allow 8443/tcp comment 'HTTPS - Kiosk' 2>/dev/null || true
    echo "y" | ufw enable 2>/dev/null || true
    log "UFW firewall rules verified."
else
    log "WARNING: UFW not found."
fi

# ==============================================================================
# Step 14: Configure fail2ban
# ==============================================================================
log_section "Step 14/17: Configuring fail2ban"

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
# Step 15: Set the MOTD with status info
# ==============================================================================
log_section "Step 15/17: Installing MOTD"

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
echo "  Dashboard: https://${IP}"
echo "  Kiosk:     https://${IP}:8443"
echo "  API:       https://${IP}:3443"
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
# Step 16: Create /usr/local/bin/safeschool CLI helper
# ==============================================================================
log_section "Step 16/17: Installing safeschool CLI helper"

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
    if curl -sf http://localhost:3000/health &>/dev/null; then
        local health
        health=$(curl -sf http://localhost:3000/health)
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
    echo "  Dashboard: https://${ip}"
    echo "  Kiosk:     https://${ip}:8443"
    echo "  API:       https://${ip}:3443"
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
    if curl -sf http://localhost:3000/health; then
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

# -- Main dispatch ---
case "${1:-help}" in
    status)    cmd_status ;;
    logs)      cmd_logs "${2:-}" ;;
    update)    cmd_update ;;
    backup)    cmd_backup ;;
    restore)   cmd_restore "${2:-}" ;;
    config)    cmd_config ;;
    restart)   cmd_restart ;;
    stop)      cmd_stop ;;
    start)     cmd_start ;;
    ps)        cmd_ps ;;
    version)   cmd_version ;;
    health)    cmd_health ;;
    harden-ssh) cmd_harden_ssh ;;
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
# Step 17: Disable first-boot service (self-removal)
# ==============================================================================
log_section "Step 17/17: Disabling first-boot service"

systemctl disable safeschool-first-boot.service 2>/dev/null || true
rm -f /opt/safeschool/first-boot.sh
log "First-boot service disabled. It will not run again."

# ==============================================================================
# Complete
# ==============================================================================
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

log_section "SafeSchool Edge -- First Boot Complete"
log ""
log "  Dashboard:  https://${IP}"
log "  Kiosk:      https://${IP}:8443"
log "  API:        https://${IP}:3443"
log "  Admin:      http://localhost:9090 (local access only)"
log ""
log "  Username:   safeschool"
log "  CLI:        safeschool status"
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
