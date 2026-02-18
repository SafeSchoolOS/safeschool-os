#!/bin/bash
set -euo pipefail

# === SafeSchool OS — Edge Installer ===

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${INSTALL_DIR}/.env"

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║                                                  ║${NC}"
  echo -e "${CYAN}${BOLD}║          SafeSchool OS Edge Installer            ║${NC}"
  echo -e "${CYAN}${BOLD}║          On-Site Mini PC Deployment              ║${NC}"
  echo -e "${CYAN}${BOLD}║                                                  ║${NC}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

prompt_input() {
  local prompt="$1"
  local default="${2:-}"
  local result

  if [ -n "$default" ]; then
    read -rp "$(echo -e "${BOLD}${prompt}${NC} [${default}]: ")" result
    echo "${result:-$default}"
  else
    read -rp "$(echo -e "${BOLD}${prompt}${NC}: ")" result
    echo "$result"
  fi
}

prompt_menu() {
  local prompt="$1"
  shift
  local options=("$@")

  echo -e "\n${BOLD}${prompt}${NC}"
  for i in "${!options[@]}"; do
    echo -e "  ${CYAN}$((i+1)))${NC} ${options[$i]}"
  done

  local choice
  while true; do
    read -rp "$(echo -e "${BOLD}Select [1-${#options[@]}]${NC}: ")" choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#options[@]}" ]; then
      echo "${options[$((choice-1))]}"
      return
    fi
    echo -e "${RED}Invalid selection. Try again.${NC}"
  done
}

generate_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [ -f /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    # Fallback: generate using openssl
    openssl rand -hex 16 | sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)\(.\{12\}\)/\1-\2-\3-\4-\5/'
  fi
}

generate_secret() {
  openssl rand -hex 32
}

# === Prerequisite Checks ===

check_prerequisites() {
  log_info "Checking prerequisites..."
  echo ""

  # Check Linux x86_64
  local arch
  arch=$(uname -m)
  if [ "$arch" != "x86_64" ]; then
    log_warn "Expected x86_64 architecture, detected: $arch"
    log_warn "SafeSchool OS is tested on x86_64. Proceed at your own risk."
  else
    log_success "Architecture: x86_64"
  fi

  # Check Docker
  if ! command -v docker &>/dev/null; then
    log_warn "Docker is not installed."
    echo ""
    local install_docker
    read -rp "$(echo -e "${BOLD}Install Docker now? (y/n)${NC}: ")" install_docker
    if [[ "$install_docker" =~ ^[Yy]$ ]]; then
      log_info "Installing Docker..."
      curl -fsSL https://get.docker.com | sh
      sudo systemctl enable docker
      sudo systemctl start docker
      # Add current user to docker group
      sudo usermod -aG docker "$USER"
      log_success "Docker installed. You may need to log out and back in for group changes."
    else
      log_error "Docker is required. Install it and re-run this script."
      exit 1
    fi
  else
    log_success "Docker: $(docker --version | head -1)"
  fi

  # Check Docker Compose
  if docker compose version &>/dev/null; then
    log_success "Docker Compose: $(docker compose version --short)"
  elif command -v docker-compose &>/dev/null; then
    log_success "Docker Compose (standalone): $(docker-compose --version | head -1)"
  else
    log_error "Docker Compose is required but not found."
    log_info "Install with: sudo apt-get install docker-compose-plugin"
    exit 1
  fi

  # Check openssl
  if ! command -v openssl &>/dev/null; then
    log_error "openssl is required for secret generation."
    exit 1
  else
    log_success "openssl: available"
  fi

  echo ""
  log_success "All prerequisites met."
}

# === Configuration Prompts ===

configure_site() {
  echo ""
  echo -e "${BOLD}${CYAN}=== Site Configuration ===${NC}"
  echo ""

  SITE_NAME=$(prompt_input "Site name (school name)" "My School")

  local site_id_input
  site_id_input=$(prompt_input "Site ID (leave blank to auto-generate)" "")
  if [ -z "$site_id_input" ]; then
    SITE_ID=$(generate_uuid)
    log_info "Generated Site ID: $SITE_ID"
  else
    SITE_ID="$site_id_input"
  fi
}

configure_cloud_sync() {
  echo ""
  echo -e "${BOLD}${CYAN}=== Cloud Sync Configuration ===${NC}"
  echo ""
  log_info "Cloud sync connects this edge device to the central SafeSchool OS cloud."
  log_info "Leave blank to run in standalone mode (no cloud sync)."
  echo ""

  CLOUD_SYNC_URL=$(prompt_input "Cloud sync URL" "")
  CLOUD_SYNC_KEY=$(prompt_input "Cloud sync key" "")

  if [ -z "$CLOUD_SYNC_URL" ]; then
    log_info "Running in standalone mode (no cloud sync)."
  fi
}

configure_dispatch() {
  echo ""
  echo -e "${BOLD}${CYAN}=== 911 Dispatch Adapter ===${NC}"
  echo ""

  DISPATCH_ADAPTER=$(prompt_menu "Select 911 dispatch adapter:" "console" "rapidsos" "rave-911" "sip-direct" "cellular")

  RAPIDSOS_CLIENT_ID=""
  RAPIDSOS_CLIENT_SECRET=""
  RAVE_API_KEY=""
  RAVE_ORGANIZATION_ID=""
  SIP_TRUNK_HOST=""
  SIP_LOCAL_DOMAIN=""
  CELLULAR_DEVICE_PATH=""

  case "$DISPATCH_ADAPTER" in
    rapidsos)
      RAPIDSOS_CLIENT_ID=$(prompt_input "RapidSOS Client ID")
      RAPIDSOS_CLIENT_SECRET=$(prompt_input "RapidSOS Client Secret")
      ;;
    rave-911)
      RAVE_API_KEY=$(prompt_input "Rave 911 API Key")
      RAVE_ORGANIZATION_ID=$(prompt_input "Rave Organization ID")
      ;;
    sip-direct)
      SIP_TRUNK_HOST=$(prompt_input "SIP Trunk Host")
      SIP_LOCAL_DOMAIN=$(prompt_input "SIP Local Domain")
      ;;
    cellular)
      CELLULAR_DEVICE_PATH=$(prompt_input "Cellular Device Path" "/dev/ttyUSB0")
      ;;
  esac
}

configure_access_control() {
  echo ""
  echo -e "${BOLD}${CYAN}=== Access Control Adapter ===${NC}"
  echo ""

  ACCESS_CONTROL_ADAPTER=$(prompt_menu "Select access control adapter:" "mock" "sicunet" "genetec" "brivo" "verkada")

  AC_API_URL=""
  AC_API_KEY=""

  if [ "$ACCESS_CONTROL_ADAPTER" != "mock" ]; then
    AC_API_URL=$(prompt_input "Access Control API URL")
    AC_API_KEY=$(prompt_input "Access Control API Key")
  fi
}

configure_notifications() {
  echo ""
  echo -e "${BOLD}${CYAN}=== Notification Adapter ===${NC}"
  echo ""

  NOTIFICATION_ADAPTER=$(prompt_menu "Select notification adapter:" "console" "twilio" "sendgrid")

  TWILIO_ACCOUNT_SID=""
  TWILIO_AUTH_TOKEN=""
  TWILIO_FROM_NUMBER=""
  SENDGRID_API_KEY=""
  SENDGRID_FROM_EMAIL=""

  case "$NOTIFICATION_ADAPTER" in
    twilio)
      TWILIO_ACCOUNT_SID=$(prompt_input "Twilio Account SID")
      TWILIO_AUTH_TOKEN=$(prompt_input "Twilio Auth Token")
      TWILIO_FROM_NUMBER=$(prompt_input "Twilio From Number")
      ;;
    sendgrid)
      SENDGRID_API_KEY=$(prompt_input "SendGrid API Key")
      SENDGRID_FROM_EMAIL=$(prompt_input "SendGrid From Email")
      ;;
  esac
}

# === Write .env ===

write_env() {
  log_info "Generating secrets..."
  DB_PASSWORD=$(generate_secret)
  JWT_SECRET=$(generate_secret)
  log_success "Secrets generated."

  log_info "Writing configuration to ${ENV_FILE}..."

  cat > "$ENV_FILE" <<ENVEOF
# === SafeSchool OS — Edge Configuration ===
# Generated by install.sh on $(date -Iseconds)

# Site Identity
SITE_NAME=${SITE_NAME}
SITE_ID=${SITE_ID}

# Cloud Sync
CLOUD_SYNC_URL=${CLOUD_SYNC_URL}
CLOUD_SYNC_KEY=${CLOUD_SYNC_KEY}

# Database
DB_PASSWORD=${DB_PASSWORD}

# Auth
JWT_SECRET=${JWT_SECRET}
AUTH_PROVIDER=dev

# 911 Dispatch
DISPATCH_ADAPTER=${DISPATCH_ADAPTER}
RAPIDSOS_CLIENT_ID=${RAPIDSOS_CLIENT_ID}
RAPIDSOS_CLIENT_SECRET=${RAPIDSOS_CLIENT_SECRET}
RAVE_API_KEY=${RAVE_API_KEY}
RAVE_ORGANIZATION_ID=${RAVE_ORGANIZATION_ID}
SIP_TRUNK_HOST=${SIP_TRUNK_HOST}
SIP_LOCAL_DOMAIN=${SIP_LOCAL_DOMAIN}
CELLULAR_DEVICE_PATH=${CELLULAR_DEVICE_PATH}

# Access Control
ACCESS_CONTROL_ADAPTER=${ACCESS_CONTROL_ADAPTER}
AC_API_URL=${AC_API_URL}
AC_API_KEY=${AC_API_KEY}

# Notifications
NOTIFICATION_ADAPTER=${NOTIFICATION_ADAPTER}
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN}
TWILIO_FROM_NUMBER=${TWILIO_FROM_NUMBER}
SENDGRID_API_KEY=${SENDGRID_API_KEY}
SENDGRID_FROM_EMAIL=${SENDGRID_FROM_EMAIL}
ENVEOF

  chmod 600 "$ENV_FILE"
  log_success "Configuration written to ${ENV_FILE}"
}

# === Deploy ===

deploy_stack() {
  echo ""
  echo -e "${BOLD}${CYAN}=== Deploying SafeSchool OS ===${NC}"
  echo ""

  cd "$INSTALL_DIR"

  log_info "Building Docker images (this may take several minutes)..."
  docker compose build

  log_info "Starting services..."
  docker compose up -d

  echo ""
  log_info "Waiting for services to become healthy..."

  local max_wait=120
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
      # Check if API is responding
      if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
        break
      fi
    fi
    sleep 5
    waited=$((waited + 5))
    echo -n "."
  done
  echo ""

  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    log_success "API is healthy!"
  else
    log_warn "API health check timed out. Services may still be starting."
    log_info "Check status with: docker compose -f ${INSTALL_DIR}/docker-compose.yml ps"
  fi
}

# === Summary ===

print_summary() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║       SafeSchool OS — Deployment Complete        ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}Site:${NC}       ${SITE_NAME}"
  echo -e "${BOLD}Site ID:${NC}    ${SITE_ID}"
  echo -e "${BOLD}Mode:${NC}      Edge (on-site)"
  echo ""
  echo -e "${BOLD}${CYAN}Service URLs:${NC}"
  echo -e "  Dashboard:  ${BOLD}http://${ip}/${NC}"
  echo -e "  Kiosk:      ${BOLD}http://${ip}:8080/${NC}"
  echo -e "  Admin:      ${BOLD}http://${ip}:9090/${NC}"
  echo -e "  API:        ${BOLD}http://${ip}:3000/${NC}"
  echo ""
  echo -e "${BOLD}${CYAN}Adapters:${NC}"
  echo -e "  Dispatch:       ${DISPATCH_ADAPTER}"
  echo -e "  Access Control: ${ACCESS_CONTROL_ADAPTER}"
  echo -e "  Notifications:  ${NOTIFICATION_ADAPTER}"
  echo ""
  if [ -n "$CLOUD_SYNC_URL" ]; then
    echo -e "${BOLD}Cloud Sync:${NC} ${CLOUD_SYNC_URL}"
  else
    echo -e "${BOLD}Cloud Sync:${NC} Standalone (not connected)"
  fi
  echo ""
  echo -e "${BOLD}${CYAN}Management Commands:${NC}"
  echo -e "  Status:   ${BOLD}docker compose -f ${INSTALL_DIR}/docker-compose.yml ps${NC}"
  echo -e "  Logs:     ${BOLD}docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f${NC}"
  echo -e "  Restart:  ${BOLD}docker compose -f ${INSTALL_DIR}/docker-compose.yml restart${NC}"
  echo -e "  Stop:     ${BOLD}docker compose -f ${INSTALL_DIR}/docker-compose.yml down${NC}"
  echo -e "  Update:   ${BOLD}Re-run this installer${NC}"
  echo ""
  echo -e "${YELLOW}Config file: ${ENV_FILE}${NC}"
  echo -e "${YELLOW}Keep this file secure — it contains secrets.${NC}"
  echo ""
}

# === Main ===

main() {
  print_banner
  check_prerequisites
  configure_site
  configure_cloud_sync
  configure_dispatch
  configure_access_control
  configure_notifications
  write_env
  deploy_stack
  print_summary
}

main "$@"
