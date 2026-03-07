#!/bin/bash
# SafeSchoolOS One-Line Installer
# Installs SafeSchoolOS on any Ubuntu 22.04+ or Debian 12+ system.
#
# Usage:
#   curl -fsSL https://get.safeschool.org | bash
#   # or
#   wget -qO- https://get.safeschool.org | bash
#
# What it does:
#   1. Installs Docker if not present
#   2. Downloads SafeSchoolOS docker-compose stack
#   3. Generates secrets (DB password, JWT secret)
#   4. Starts all services
#   5. Sets up systemd service for auto-start on boot

set -euo pipefail

SAFESCHOOL_DIR="/opt/safeschoolos"
SAFESCHOOL_VERSION="${SAFESCHOOL_VERSION:-latest}"
GITHUB_RAW="https://raw.githubusercontent.com/SafeSchoolOS/safeschool-os/main"
EDGERUNTIME_RAW="https://raw.githubusercontent.com/bwattendorf/EdgeRuntime/master/deploy/safeschoolos/ubuntu-appliance"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║         SafeSchoolOS Installer           ║"
echo "║   Free school safety for every school    ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}ERROR: Please run as root (sudo)${NC}"
  echo "  curl -fsSL https://get.safeschool.org | sudo bash"
  exit 1
fi

# Check OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo -e "${GREEN}OS: $PRETTY_NAME${NC}"
else
  echo -e "${YELLOW}WARNING: Cannot detect OS. Continuing anyway...${NC}"
fi

# Step 1: Install Docker
echo ""
echo -e "${BLUE}[1/5] Installing Docker...${NC}"
if command -v docker &>/dev/null; then
  echo -e "${GREEN}  Docker already installed: $(docker --version)${NC}"
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}  Docker installed successfully${NC}"
fi

# Ensure docker compose plugin
if ! docker compose version &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
fi
echo -e "${GREEN}  Docker Compose: $(docker compose version --short)${NC}"

# Step 2: Create directory structure
echo ""
echo -e "${BLUE}[2/5] Setting up SafeSchoolOS...${NC}"
mkdir -p "$SAFESCHOOL_DIR"/{backups,data}
cd "$SAFESCHOOL_DIR"

# Download deployment files
echo "  Downloading configuration files..."
curl -fsSL "$EDGERUNTIME_RAW/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$EDGERUNTIME_RAW/Caddyfile" -o Caddyfile
curl -fsSL "$EDGERUNTIME_RAW/.env.example" -o .env.example
curl -fsSL "$EDGERUNTIME_RAW/first-boot.sh" -o first-boot.sh
chmod +x first-boot.sh

# Download overlay files
mkdir -p overlay/etc/systemd/system overlay/usr/local/bin
curl -fsSL "$EDGERUNTIME_RAW/overlay/etc/systemd/system/safeschoolos.service" -o /etc/systemd/system/safeschoolos.service
curl -fsSL "$EDGERUNTIME_RAW/overlay/usr/local/bin/safeschool" -o /usr/local/bin/safeschool
chmod +x /usr/local/bin/safeschool

echo -e "${GREEN}  Files downloaded${NC}"

# Step 3: Generate secrets
echo ""
echo -e "${BLUE}[3/5] Generating secrets...${NC}"
if [ ! -f .env ]; then
  cp .env.example .env

  # Generate DB password
  DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASSWORD/" .env

  # Generate JWT secret
  JWT_SECRET=$(head -c 36 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env

  echo -e "${GREEN}  Secrets generated and saved to .env${NC}"
else
  echo -e "${YELLOW}  .env already exists, keeping existing secrets${NC}"
fi

# Step 4: Pull and start
echo ""
echo -e "${BLUE}[4/5] Pulling Docker images (this may take a few minutes)...${NC}"
docker compose pull 2>&1 | grep -E "Pull|Downloaded|Already" || true

echo ""
echo -e "${BLUE}[5/5] Starting SafeSchoolOS...${NC}"
docker compose up -d

# Enable systemd service
systemctl daemon-reload
systemctl enable safeschoolos.service 2>/dev/null || true

# Wait for health
echo ""
echo -n "  Waiting for services to start"
for i in $(seq 1 60); do
  if curl -sf http://localhost:8470/health >/dev/null 2>&1; then
    echo ""
    echo -e "${GREEN}  Services are healthy!${NC}"
    break
  fi
  echo -n "."
  sleep 5
done

# Get IP
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    SafeSchoolOS installed successfully!  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard:  ${BLUE}https://${LOCAL_IP}${NC}"
echo -e "  Kiosk:      ${BLUE}https://${LOCAL_IP}:8443${NC}"
echo -e "  API:        ${BLUE}https://${LOCAL_IP}:3443/api${NC}"
echo ""
echo -e "  Login:      ${YELLOW}admin@safeschool.local${NC} / ${YELLOW}safeschool123${NC}"
echo -e "  ${RED}(Change this password immediately!)${NC}"
echo ""
echo -e "  CLI:        ${BLUE}safeschool status${NC}"
echo -e "  Logs:       ${BLUE}safeschool logs${NC}"
echo -e "  Update:     ${BLUE}safeschool update${NC}"
echo ""
