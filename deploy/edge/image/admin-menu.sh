#!/bin/bash
# ==============================================================================
# SafeSchool OS -- Admin Configuration Menu
# ==============================================================================
# Displays an interactive menu when the 'admin' user logs in via SSH.
# Allows setting IP address, gateway, DNS, hostname, and viewing status.
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

NETPLAN_DIR="/etc/netplan"

clear_screen() {
    clear 2>/dev/null || printf '\033[2J\033[H'
}

print_banner() {
    echo -e "${CYAN}"
    echo "  ╔═══════════════════════════════════════════════════════════╗"
    echo "  ║              SafeSchool OS - Admin Console               ║"
    echo "  ╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

get_current_ip() {
    ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d./]+' | head -1
}

get_current_gateway() {
    ip route show default 2>/dev/null | awk '/default/ {print $3}' | head -1
}

get_current_dns() {
    resolvectl status 2>/dev/null | grep "DNS Servers" | awk '{for(i=3;i<=NF;i++) printf "%s ", $i}' | xargs
    if [ -z "$(resolvectl status 2>/dev/null | grep 'DNS Servers')" ]; then
        grep "^nameserver" /etc/resolv.conf 2>/dev/null | awk '{print $2}' | tr '\n' ' '
    fi
}

get_current_hostname() {
    hostname 2>/dev/null
}

get_primary_interface() {
    ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1
}

is_dhcp() {
    local iface
    iface=$(get_primary_interface)
    if [ -z "$iface" ]; then
        echo "unknown"
        return
    fi
    # Check if any netplan config has dhcp4: true for this interface
    grep -rql "dhcp4: true" "$NETPLAN_DIR"/ 2>/dev/null && echo "yes" || echo "no"
}

show_status() {
    echo -e "\n${BOLD}  Network Configuration${NC}"
    echo -e "  ─────────────────────────────────────────────"
    echo -e "  Hostname:     ${GREEN}$(get_current_hostname)${NC}"
    echo -e "  Interface:    ${GREEN}$(get_primary_interface)${NC}"
    echo -e "  IP Address:   ${GREEN}$(get_current_ip)${NC}"
    echo -e "  Gateway:      ${GREEN}$(get_current_gateway)${NC}"
    echo -e "  DNS:          ${GREEN}$(get_current_dns)${NC}"
    echo -e "  DHCP:         ${GREEN}$(is_dhcp)${NC}"

    echo -e "\n${BOLD}  Docker Services${NC}"
    echo -e "  ─────────────────────────────────────────────"
    if command -v docker &>/dev/null; then
        docker ps --format '  {{.Names}}\t{{.Status}}' 2>/dev/null || echo -e "  ${RED}Docker not accessible${NC}"
    else
        echo -e "  ${RED}Docker not installed${NC}"
    fi
    echo ""
}

validate_ip() {
    local ip="$1"
    if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        IFS='.' read -r -a octets <<< "$ip"
        for octet in "${octets[@]}"; do
            if (( octet > 255 )); then return 1; fi
        done
        return 0
    fi
    return 1
}

validate_cidr() {
    local cidr="$1"
    if [[ "$cidr" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]{1,2})$ ]]; then
        local ip="${cidr%/*}"
        local mask="${cidr#*/}"
        if validate_ip "$ip" && (( mask >= 1 && mask <= 32 )); then
            return 0
        fi
    fi
    return 1
}

set_static_ip() {
    local iface
    iface=$(get_primary_interface)
    if [ -z "$iface" ]; then
        echo -e "${RED}  Error: No network interface found.${NC}"
        return
    fi

    echo -e "\n${BOLD}  Set Static IP Address${NC}"
    echo -e "  ─────────────────────────────────────────────"
    echo -e "  Current: $(get_current_ip)"
    echo ""

    read -rp "  IP Address (e.g. 192.168.1.250/24): " new_ip
    if [ -z "$new_ip" ]; then echo -e "${YELLOW}  Cancelled.${NC}"; return; fi
    if ! validate_cidr "$new_ip"; then
        echo -e "${RED}  Invalid IP/CIDR format. Use format: 192.168.1.250/24${NC}"
        return
    fi

    read -rp "  Gateway (e.g. 192.168.1.1): " new_gw
    if [ -z "$new_gw" ]; then echo -e "${YELLOW}  Cancelled.${NC}"; return; fi
    if ! validate_ip "$new_gw"; then
        echo -e "${RED}  Invalid gateway IP.${NC}"
        return
    fi

    read -rp "  DNS servers (e.g. 8.8.8.8,1.1.1.1): " new_dns
    if [ -z "$new_dns" ]; then new_dns="8.8.8.8,1.1.1.1"; fi

    # Build DNS array
    local dns_yaml=""
    IFS=',' read -ra dns_arr <<< "$new_dns"
    for d in "${dns_arr[@]}"; do
        d=$(echo "$d" | xargs)
        dns_yaml="${dns_yaml}            - ${d}\n"
    done

    echo ""
    echo -e "  ${BOLD}Summary:${NC}"
    echo -e "  Interface: $iface"
    echo -e "  IP:        $new_ip"
    echo -e "  Gateway:   $new_gw"
    echo -e "  DNS:       $new_dns"
    echo ""
    read -rp "  Apply these settings? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${YELLOW}  Cancelled.${NC}"
        return
    fi

    # Remove existing netplan configs
    sudo rm -f "$NETPLAN_DIR"/*.yaml 2>/dev/null

    # Disable cloud-init network management
    sudo mkdir -p /etc/cloud/cloud.cfg.d
    echo "network: {config: disabled}" | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg >/dev/null

    # Write new netplan config
    sudo tee "$NETPLAN_DIR/99-safeschool-static.yaml" >/dev/null <<NETPLAN
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${new_ip}
      routes:
        - to: default
          via: ${new_gw}
      nameservers:
        addresses:
$(echo -e "$dns_yaml")
NETPLAN
    sudo chmod 600 "$NETPLAN_DIR/99-safeschool-static.yaml"

    echo -e "\n${GREEN}  Network config written.${NC}"
    echo -e "${YELLOW}  WARNING: Applying now will change the IP address.${NC}"
    echo -e "${YELLOW}  You may lose SSH connection if the IP changes.${NC}"
    read -rp "  Apply now? (y/N): " apply_now
    if [[ "$apply_now" == "y" || "$apply_now" == "Y" ]]; then
        echo -e "  Applying netplan..."
        sudo netplan apply 2>&1
        echo -e "${GREEN}  Done. New IP: $(get_current_ip)${NC}"
    else
        echo -e "${YELLOW}  Settings saved. Run 'sudo netplan apply' to activate.${NC}"
    fi
}

set_dhcp() {
    local iface
    iface=$(get_primary_interface)
    if [ -z "$iface" ]; then
        echo -e "${RED}  Error: No network interface found.${NC}"
        return
    fi

    echo -e "\n${BOLD}  Switch to DHCP${NC}"
    read -rp "  Switch $iface to DHCP? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${YELLOW}  Cancelled.${NC}"
        return
    fi

    sudo rm -f "$NETPLAN_DIR"/*.yaml 2>/dev/null

    sudo tee "$NETPLAN_DIR/99-safeschool-dhcp.yaml" >/dev/null <<NETPLAN
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: true
      dhcp6: false
NETPLAN
    sudo chmod 600 "$NETPLAN_DIR/99-safeschool-dhcp.yaml"

    echo -e "${GREEN}  DHCP config written.${NC}"
    read -rp "  Apply now? (y/N): " apply_now
    if [[ "$apply_now" == "y" || "$apply_now" == "Y" ]]; then
        sudo netplan apply 2>&1
        sleep 3
        echo -e "${GREEN}  Done. New IP: $(get_current_ip)${NC}"
    else
        echo -e "${YELLOW}  Settings saved. Run 'sudo netplan apply' to activate.${NC}"
    fi
}

set_hostname_menu() {
    echo -e "\n${BOLD}  Set Hostname${NC}"
    echo -e "  Current: $(get_current_hostname)"
    read -rp "  New hostname: " new_host
    if [ -z "$new_host" ]; then echo -e "${YELLOW}  Cancelled.${NC}"; return; fi
    if [[ ! "$new_host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]]; then
        echo -e "${RED}  Invalid hostname.${NC}"
        return
    fi
    sudo hostnamectl set-hostname "$new_host"
    echo -e "${GREEN}  Hostname set to: $new_host${NC}"
}

restart_services() {
    echo -e "\n${BOLD}  Restart SafeSchool Services${NC}"
    read -rp "  Restart all Docker services? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${YELLOW}  Cancelled.${NC}"
        return
    fi
    echo -e "  Restarting..."
    cd /opt/safeschool/deploy/edge 2>/dev/null && sudo docker compose restart 2>&1
    echo -e "${GREEN}  Services restarted.${NC}"
}

reboot_system() {
    read -rp "  Reboot the system? (y/N): " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        echo -e "${YELLOW}  Rebooting in 3 seconds...${NC}"
        sleep 3
        sudo reboot
    fi
}

# Main menu loop
main() {
    while true; do
        clear_screen
        print_banner
        show_status

        echo -e "  ${BOLD}Options:${NC}"
        echo -e "  ${CYAN}1${NC}) Set Static IP"
        echo -e "  ${CYAN}2${NC}) Switch to DHCP"
        echo -e "  ${CYAN}3${NC}) Set Hostname"
        echo -e "  ${CYAN}4${NC}) Restart Services"
        echo -e "  ${CYAN}5${NC}) Reboot System"
        echo -e "  ${CYAN}6${NC}) Drop to Shell"
        echo -e "  ${CYAN}0${NC}) Logout"
        echo ""
        read -rp "  Select option: " choice

        case "$choice" in
            1) set_static_ip ;;
            2) set_dhcp ;;
            3) set_hostname_menu ;;
            4) restart_services ;;
            5) reboot_system ;;
            6)
                echo -e "${YELLOW}  Type 'exit' to return to menu.${NC}"
                /bin/bash --login
                ;;
            0|q|Q) exit 0 ;;
            *) echo -e "${RED}  Invalid option.${NC}" ;;
        esac

        echo ""
        read -rp "  Press Enter to continue..." _
    done
}

main
