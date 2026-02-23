#!/usr/bin/env bash
# ==============================================================================
# SafeSchool OS -- Dynamic MOTD (Message of the Day)
# ==============================================================================
# Copyright (c) 2026 SafeSchool. All rights reserved.
# Licensed under the SafeSchool Platform License.
#
# Installed at: /etc/update-motd.d/99-safeschool
# Displays system info, service status, and sync state on login.
# ==============================================================================

# -- Configuration ------------------------------------------------------------
INSTALL_DIR="/opt/safeschool"
EDGE_DIR="${INSTALL_DIR}/deploy/edge"
COMPOSE_FILE="${EDGE_DIR}/docker-compose.yml"
ENV_FILE="${EDGE_DIR}/.env"

# -- ANSI Colors ---------------------------------------------------------------
RST='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# Foreground
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
MAGENTA='\033[0;35m'

# Background
BG_BLUE='\033[44m'
BG_RED='\033[41m'
BG_GREEN='\033[42m'

# -- Helper functions ----------------------------------------------------------
get_ip() {
    hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown"
}

get_uptime() {
    uptime -p 2>/dev/null || echo "unknown"
}

get_disk_usage() {
    df -h / 2>/dev/null | tail -1 | awk '{printf "%s / %s (%s used)", $3, $2, $5}'
}

get_memory_usage() {
    free -h 2>/dev/null | awk '/^Mem:/ {printf "%s / %s (%s free)", $3, $2, $4}'
}

get_cpu_load() {
    cat /proc/loadavg 2>/dev/null | awk '{printf "%s %s %s", $1, $2, $3}' || echo "unknown"
}

get_docker_status() {
    local service="$1"
    local status
    status=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format '{{.Status}}' "$service" 2>/dev/null | head -1)
    if [ -z "$status" ]; then
        echo "stopped"
    else
        echo "$status"
    fi
}

format_service_status() {
    local name="$1"
    local status="$2"
    local padded_name
    padded_name=$(printf "%-12s" "$name")

    if echo "$status" | grep -qi "up.*healthy"; then
        printf "  ${GREEN}●${RST} ${BOLD}%s${RST} ${GREEN}%s${RST}\n" "$padded_name" "$status"
    elif echo "$status" | grep -qi "up"; then
        printf "  ${YELLOW}●${RST} ${BOLD}%s${RST} ${YELLOW}%s${RST}\n" "$padded_name" "$status"
    else
        printf "  ${RED}●${RST} ${BOLD}%s${RST} ${RED}%s${RST}\n" "$padded_name" "$status"
    fi
}

get_operating_mode() {
    if [ -f "$ENV_FILE" ]; then
        grep -E '^OPERATING_MODE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "unknown"
    else
        echo "unconfigured"
    fi
}

get_site_name() {
    if [ -f "$ENV_FILE" ]; then
        grep -E '^SITE_NAME=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "(not configured)"
    else
        echo "(not configured)"
    fi
}

get_version() {
    if [ -d "${INSTALL_DIR}/.git" ]; then
        git -C "$INSTALL_DIR" log --oneline -1 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

# -- Render MOTD ---------------------------------------------------------------
IP=$(get_ip)
MODE=$(get_operating_mode)
SITE=$(get_site_name)

echo ""
echo -e "${CYAN}${BOLD}"
echo "   ____         __     ____       _                 _ "
echo "  / ___|  __ _ / _| __/ ___|  ___| |__   ___   ___ | |"
echo "  \\___ \\ / _\` | |_ / _ \\___ \\ / __| '_ \\ / _ \\ / _ \\| |"
echo "   ___) | (_| |  _|  __/___) | (__| | | | (_) | (_) | |"
echo "  |____/ \\__,_|_|  \\___|____/ \\___|_| |_|\\___/ \\___/|_|"
echo -e "${RST}"
echo -e "  ${DIM}Edge Platform -- On-Site Mini PC${RST}"
echo ""

# -- System Info ---------------------------------------------------------------
echo -e "  ${BLUE}${BOLD}System${RST}"
echo -e "  ${DIM}------------------------------------------------------${RST}"
printf "  ${BOLD}%-14s${RST} %s\n" "Hostname:" "$(hostname)"
printf "  ${BOLD}%-14s${RST} %s\n" "IP Address:" "$IP"
printf "  ${BOLD}%-14s${RST} %s\n" "Uptime:" "$(get_uptime)"
printf "  ${BOLD}%-14s${RST} %s\n" "Load:" "$(get_cpu_load)"
printf "  ${BOLD}%-14s${RST} %s\n" "Memory:" "$(get_memory_usage)"
printf "  ${BOLD}%-14s${RST} %s\n" "Disk:" "$(get_disk_usage)"
echo ""

# -- SafeSchool Info -----------------------------------------------------------
echo -e "  ${BLUE}${BOLD}SafeSchool${RST}"
echo -e "  ${DIM}------------------------------------------------------${RST}"
printf "  ${BOLD}%-14s${RST} %s\n" "Site:" "$SITE"
printf "  ${BOLD}%-14s${RST} %s\n" "Mode:" "$MODE"
printf "  ${BOLD}%-14s${RST} %s\n" "Version:" "$(get_version)"
echo ""

# -- Service Status ------------------------------------------------------------
echo -e "  ${BLUE}${BOLD}Services${RST}"
echo -e "  ${DIM}------------------------------------------------------${RST}"

if [ -f "$COMPOSE_FILE" ] && command -v docker &>/dev/null; then
    for svc in api worker dashboard kiosk postgres redis caddy; do
        status=$(get_docker_status "$svc")
        format_service_status "$svc" "$status"
    done
else
    echo -e "  ${RED}Docker Compose not available or not configured.${RST}"
fi
echo ""

# -- Sync Status ---------------------------------------------------------------
echo -e "  ${BLUE}${BOLD}Sync Status${RST}"
echo -e "  ${DIM}------------------------------------------------------${RST}"

ACTIVATION_KEY=""
if [ -f "$ENV_FILE" ]; then
    ACTIVATION_KEY=$(grep -E '^EDGERUNTIME_ACTIVATION_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
fi

# Check EdgeRuntime health
EDGE_HEALTH=$(curl -sf http://localhost:8470/health 2>/dev/null || echo "")
if [ -n "$EDGE_HEALTH" ]; then
    printf "  ${BOLD}%-14s${RST} ${GREEN}%s${RST}\n" "EdgeRuntime:" "Online"
    if [ -n "$ACTIVATION_KEY" ] && [ "$ACTIVATION_KEY" != "" ]; then
        printf "  ${BOLD}%-14s${RST} ${GREEN}%s${RST}\n" "Cloud Sync:" "Activated"
    else
        printf "  ${BOLD}%-14s${RST} ${YELLOW}%s${RST}\n" "Cloud Sync:" "Not activated (standalone)"
    fi
else
    printf "  ${BOLD}%-14s${RST} ${YELLOW}%s${RST}\n" "EdgeRuntime:" "Not responding"
fi

# Check for offline queue
if [ -f "${INSTALL_DIR}/data/offline-queue.db" ]; then
    QUEUE_SIZE=$(sqlite3 "${INSTALL_DIR}/data/offline-queue.db" "SELECT COUNT(*) FROM queue WHERE status='pending'" 2>/dev/null || echo "0")
    if [ "$QUEUE_SIZE" -gt 0 ] 2>/dev/null; then
        printf "  ${BOLD}%-14s${RST} ${YELLOW}%s pending${RST}\n" "Queue:" "$QUEUE_SIZE"
    else
        printf "  ${BOLD}%-14s${RST} ${GREEN}%s${RST}\n" "Queue:" "Empty (all synced)"
    fi
fi
echo ""

# -- Admin Token ---------------------------------------------------------------
ADMIN_TOKEN_FILE="/etc/safeschool/admin-token"
if [ -f "$ADMIN_TOKEN_FILE" ] && [ -r "$ADMIN_TOKEN_FILE" ]; then
    ADMIN_TOKEN=$(cat "$ADMIN_TOKEN_FILE" 2>/dev/null)
    if [ -n "$ADMIN_TOKEN" ]; then
        echo -e "  ${BLUE}${BOLD}Network Admin${RST}"
        echo -e "  ${DIM}------------------------------------------------------${RST}"
        echo -e "  ${BOLD}URL:${RST}        http://${IP}:9090"
        echo -e "  ${BOLD}Token:${RST}      ${YELLOW}${ADMIN_TOKEN}${RST}"
        echo ""
    fi
fi

# -- Quick Reference -----------------------------------------------------------
echo -e "  ${BLUE}${BOLD}Quick Reference${RST}"
echo -e "  ${DIM}------------------------------------------------------${RST}"
echo -e "  ${BOLD}Dashboard:${RST}  https://${IP}"
echo -e "  ${BOLD}Kiosk:${RST}      https://${IP}:8443"
echo -e "  ${BOLD}API:${RST}        https://${IP}:3443"
echo -e "  ${BOLD}Net Admin:${RST}  http://${IP}:9090"
echo ""
echo -e "  ${BOLD}CLI:${RST}        safeschool status | logs | update | config | network"
echo ""
