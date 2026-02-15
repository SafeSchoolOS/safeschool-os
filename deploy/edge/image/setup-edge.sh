#!/usr/bin/env bash
# ==============================================================================
# SafeSchool Edge -- Post-Install Setup Script
# ==============================================================================
# Run this after a fresh autoinstall to configure the edge device.
# Usage: sudo bash setup-edge.sh
# ==============================================================================
set -euo pipefail

INSTALL_DIR="/opt/safeschool"
EDGE_DIR="${INSTALL_DIR}/deploy/edge"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    fail "This script must be run as root (sudo bash setup-edge.sh)"
fi

echo ""
echo -e "${CYAN}${BOLD}====================================================${NC}"
echo -e "${CYAN}${BOLD}  SafeSchool Edge -- Post-Install Setup${NC}"
echo -e "${CYAN}${BOLD}====================================================${NC}"
echo ""

# -- Step 1: Install missing packages -----------------------------------------
log "Step 1/8: Installing packages..."
apt-get update -qq
apt-get install -y -qq docker-compose-v2 ufw fail2ban jq htop curl wget git \
    ca-certificates openssh-server sqlite3 logrotate net-tools > /dev/null 2>&1
usermod -aG docker safeschool
systemctl enable docker
ok "Packages installed."

# -- Step 2: Create directories ------------------------------------------------
log "Step 2/8: Creating directories..."
mkdir -p "$INSTALL_DIR" /etc/safeschool /var/log/safeschool
mkdir -p "${INSTALL_DIR}/backups/daily" "${INSTALL_DIR}/backups/weekly"
chown -R safeschool:safeschool "$INSTALL_DIR" /etc/safeschool /var/log/safeschool
ok "Directories created."

# -- Step 3: Clone repo or use embedded files ----------------------------------
log "Step 3/8: Getting SafeSchool files..."
if [ -d "${INSTALL_DIR}/deploy/edge/docker-compose.yml" ] || [ -f "${EDGE_DIR}/docker-compose.yml" ]; then
    ok "Deploy files already present."
elif ping -c 1 -W 3 github.com &>/dev/null; then
    log "Cloning repository..."
    TEMP_PRESERVE=$(mktemp -d)
    cp -a "${INSTALL_DIR}"/* "$TEMP_PRESERVE/" 2>/dev/null || true
    if git clone https://github.com/bwattendorf/safeSchool.git "${INSTALL_DIR}-git" 2>&1; then
        cp -a "${INSTALL_DIR}-git"/* "${INSTALL_DIR}/" 2>/dev/null || true
        cp -a "${INSTALL_DIR}-git"/.git "${INSTALL_DIR}/" 2>/dev/null || true
        rm -rf "${INSTALL_DIR}-git"
        ok "Repository cloned."
    else
        warn "Git clone failed (private repo?). Need deploy files manually."
    fi
    cp -a "$TEMP_PRESERVE"/* "${INSTALL_DIR}/" 2>/dev/null || true
    rm -rf "$TEMP_PRESERVE"
else
    warn "No internet. Need deploy files manually."
fi
chown -R safeschool:safeschool "$INSTALL_DIR"

# -- Step 4: Generate .env ----------------------------------------------------
log "Step 4/8: Generating environment config..."
ENV_FILE="${EDGE_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
    ok ".env already exists."
elif [ -f "${EDGE_DIR}/.env.example" ]; then
    cp "${EDGE_DIR}/.env.example" "$ENV_FILE"
    DB_PASS=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)
    JWT_SEC=$(openssl rand -base64 48 | tr -d '=/+' | head -c 48)
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SEC}|" "$ENV_FILE"
    if grep -q "^OPERATING_MODE=" "$ENV_FILE"; then
        sed -i "s|^OPERATING_MODE=.*|OPERATING_MODE=edge|" "$ENV_FILE"
    else
        echo "OPERATING_MODE=edge" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    ok ".env generated with secure secrets."
else
    warn "No .env.example found. Skipping .env generation."
fi

# -- Step 5: Load Docker images -----------------------------------------------
log "Step 5/8: Loading Docker images..."
IMAGES_DIR="${INSTALL_DIR}/docker-images"
if [ -d "$IMAGES_DIR" ] && ls "$IMAGES_DIR"/*.tar.gz 1>/dev/null 2>&1; then
    for tarball in "$IMAGES_DIR"/*.tar.gz; do
        IMAGE_NAME=$(basename "$tarball" .tar.gz)
        log "  Loading ${IMAGE_NAME}..."
        docker load < "$tarball" 2>&1 | tail -1
    done
    FREED=$(du -sh "$IMAGES_DIR" | cut -f1)
    rm -rf "$IMAGES_DIR"
    ok "Docker images loaded. Freed ${FREED}."
elif [ -f "${EDGE_DIR}/docker-compose.yml" ] && [ -f "$ENV_FILE" ]; then
    log "  Pulling images from registry..."
    docker compose -f "${EDGE_DIR}/docker-compose.yml" --env-file "$ENV_FILE" pull 2>&1 || warn "Pull failed."
    ok "Docker images pulled."
else
    warn "No docker images or compose file found. Skipping."
fi

# -- Step 6: Start services ---------------------------------------------------
log "Step 6/8: Starting SafeSchool services..."
if [ -f "${EDGE_DIR}/docker-compose.yml" ] && [ -f "$ENV_FILE" ]; then
    docker compose -f "${EDGE_DIR}/docker-compose.yml" --env-file "$ENV_FILE" up -d 2>&1
    ok "Services started."

    # Create systemd service for auto-start on boot
    cat > /etc/systemd/system/safeschool.service <<SVCEOF
[Unit]
Description=SafeSchool Edge Platform
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/docker compose -f ${EDGE_DIR}/docker-compose.yml --env-file ${ENV_FILE} up -d
ExecStop=/usr/bin/docker compose -f ${EDGE_DIR}/docker-compose.yml --env-file ${ENV_FILE} down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    systemctl enable safeschool.service
    ok "Systemd service created and enabled."
else
    warn "No compose file or .env. Skipping service start."
fi

# -- Step 7: Configure firewall ------------------------------------------------
log "Step 7/8: Configuring firewall..."
ufw allow 22/tcp   > /dev/null 2>&1
ufw allow 80/tcp   > /dev/null 2>&1
ufw allow 443/tcp  > /dev/null 2>&1
ufw allow 3443/tcp > /dev/null 2>&1
ufw allow 8443/tcp > /dev/null 2>&1
ufw allow 9090/tcp > /dev/null 2>&1
echo "y" | ufw enable > /dev/null 2>&1
ok "Firewall configured (SSH, HTTP, HTTPS, API, Kiosk, Admin)."

# -- Step 8: Install safeschool CLI -------------------------------------------
log "Step 8/8: Installing safeschool CLI..."
cat > /usr/local/bin/safeschool <<'CLIMAIN'
#!/usr/bin/env bash
set -euo pipefail
DIR="/opt/safeschool"
EDGE="${DIR}/deploy/edge"
COMPOSE="${EDGE}/docker-compose.yml"
ENV="${EDGE}/.env"
case "${1:-help}" in
  status)
    echo ""; echo "=== SafeSchool Edge Status ==="
    echo "Hostname: $(hostname)"
    echo "IP:       $(hostname -I 2>/dev/null | awk '{print $1}')"
    echo "Uptime:   $(uptime -p)"
    echo ""; docker compose -f "$COMPOSE" --env-file "$ENV" ps 2>/dev/null
    echo ""; curl -sf http://localhost:3000/health && echo "" || echo "API: not responding"
    echo "";;
  logs)    docker compose -f "$COMPOSE" --env-file "$ENV" logs -f --tail=100 ${2:-} ;;
  restart) docker compose -f "$COMPOSE" --env-file "$ENV" down && docker compose -f "$COMPOSE" --env-file "$ENV" up -d ;;
  stop)    docker compose -f "$COMPOSE" --env-file "$ENV" down ;;
  start)   docker compose -f "$COMPOSE" --env-file "$ENV" up -d ;;
  ps)      docker compose -f "$COMPOSE" --env-file "$ENV" ps ;;
  config)  sudo ${EDITOR:-nano} "$ENV" ;;
  update)  [ -f "${EDGE}/update.sh" ] && sudo bash "${EDGE}/update.sh" || echo "update.sh not found" ;;
  *)
    echo "Usage: safeschool {status|logs|restart|stop|start|ps|config|update}"
    echo "";;
esac
CLIMAIN
chmod +x /usr/local/bin/safeschool
ok "CLI installed: run 'safeschool status' to check."

# -- Done ----------------------------------------------------------------------
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo -e "${GREEN}${BOLD}====================================================${NC}"
echo -e "${GREEN}${BOLD}  Setup Complete!${NC}"
echo -e "${GREEN}${BOLD}====================================================${NC}"
echo ""
echo -e "  Dashboard: ${BOLD}http://${IP}${NC}"
echo -e "  API:       ${BOLD}http://${IP}:3443${NC}"
echo -e "  Kiosk:     ${BOLD}http://${IP}:8443${NC}"
echo ""
echo -e "  CLI:       ${BOLD}safeschool status${NC}"
echo -e "  Config:    ${BOLD}safeschool config${NC}"
echo ""
