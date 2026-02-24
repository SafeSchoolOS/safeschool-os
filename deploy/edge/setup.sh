#!/usr/bin/env bash
set -euo pipefail

# SafeSchool OS — Edge Mini PC Setup Script
# Tested on Ubuntu 22.04 LTS / Debian 12
# Run as root: sudo bash setup.sh

INSTALL_DIR="/opt/safeschool"
COMPOSE_FILE="deploy/edge/docker-compose.yml"
SERVICE_NAME="safeschool"

echo "========================================"
echo "  SafeSchool OS — Edge Setup"
echo "========================================"

# --- Preflight checks ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: Run this script as root (sudo bash setup.sh)"
  exit 1
fi

# --- Install Docker ---
if ! command -v docker &>/dev/null; then
  echo "[1/6] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed."
else
  echo "[1/6] Docker already installed."
fi

# --- Install Docker Compose plugin ---
if ! docker compose version &>/dev/null; then
  echo "[2/6] Installing Docker Compose plugin..."
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
  echo "Docker Compose plugin installed."
else
  echo "[2/6] Docker Compose plugin already installed."
fi

# --- Clone or update repository ---
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[3/6] Updating SafeSchool repository..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin main
else
  echo "[3/6] Cloning SafeSchool repository..."
  git clone https://github.com/bwattendorf/safeSchool.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# --- Generate .env if not present ---
ENV_FILE="$INSTALL_DIR/deploy/edge/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[4/6] Generating .env from template..."
  cp "$INSTALL_DIR/deploy/edge/.env.example" "$ENV_FILE"

  # Generate secure random passwords
  DB_PASS=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)
  JWT_SEC=$(openssl rand -base64 48 | tr -d '=/+' | head -c 48)

  sed -i "s/DB_PASSWORD=changeme_generate_random/DB_PASSWORD=$DB_PASS/" "$ENV_FILE"
  sed -i "s/JWT_SECRET=changeme_generate_random/JWT_SECRET=$JWT_SEC/" "$ENV_FILE"

  # Prompt for admin account
  echo ""
  echo "--- Admin Account Setup ---"
  read -p "Admin email address: " ADMIN_EMAIL
  while true; do
    read -s -p "Admin password (min 8 chars): " ADMIN_PASS
    echo ""
    if [ ${#ADMIN_PASS} -ge 8 ]; then break; fi
    echo "Password must be at least 8 characters."
  done
  read -s -p "Confirm password: " ADMIN_PASS_CONFIRM
  echo ""
  if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
    echo "Passwords do not match. You can set ADMIN_EMAIL and ADMIN_PASSWORD in $ENV_FILE manually."
  else
    sed -i "s/ADMIN_EMAIL=.*/ADMIN_EMAIL=$ADMIN_EMAIL/" "$ENV_FILE"
    sed -i "s/ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$ADMIN_PASS/" "$ENV_FILE"
    echo "Admin account configured: $ADMIN_EMAIL"
  fi

  echo ""
  echo "Generated .env with secure secrets."
  echo "IMPORTANT: Edit $ENV_FILE to set SITE_NAME and integration keys."
else
  echo "[4/6] .env already exists, skipping."
fi

# --- Create systemd service ---
echo "[5/6] Creating systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service <<SVCEOF
[Unit]
Description=SafeSchool OS Edge Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d
ExecStop=/usr/bin/docker compose -f $COMPOSE_FILE --env-file $ENV_FILE down
ExecReload=/usr/bin/docker compose -f $COMPOSE_FILE --env-file $ENV_FILE pull && /usr/bin/docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}.service

# --- Pull and start services ---
echo "[6/6] Pulling and starting SafeSchool services..."
docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$ENV_FILE" pull
docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo ""
echo "========================================"
echo "  SafeSchool OS Edge — Setup Complete"
echo "========================================"
echo ""
echo "Dashboard:  http://$(hostname -I | awk '{print $1}'):80"
echo "Kiosk:      http://$(hostname -I | awk '{print $1}'):8080"
echo "API:        http://$(hostname -I | awk '{print $1}'):3000"
echo "Admin:      http://$(hostname -I | awk '{print $1}'):9090"
echo ""
echo "Next steps:"
echo "  1. Edit $ENV_FILE with your SITE_ID, SITE_NAME, and integration keys"
echo "  2. Restart: systemctl restart $SERVICE_NAME"
echo "  3. Check status: docker compose -f $INSTALL_DIR/$COMPOSE_FILE ps"
echo "  4. View logs: docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f"
echo ""
echo "To update later: sudo bash $INSTALL_DIR/deploy/edge/update.sh"
