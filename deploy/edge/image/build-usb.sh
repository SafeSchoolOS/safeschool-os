#!/usr/bin/env bash
# ==============================================================================
# SafeSchool OS -- Bootable USB Installer Builder (Linux/Mac)
# ==============================================================================
# Copyright (c) 2026 SafeSchool. All rights reserved.
# Licensed under the SafeSchool Platform License.
#
# Creates a bootable USB installer that provisions a fresh mini PC with
# Ubuntu Server 24.04 LTS and auto-installs the SafeSchool edge stack.
#
# Usage:
#   ./build-usb.sh                     # Build ISO only
#   ./build-usb.sh --flash /dev/sdX    # Build ISO and flash to USB drive
#
# Requirements:
#   - xorriso (ISO manipulation)
#   - p7zip-full or 7z (ISO extraction)
#   - wget or curl (ISO download)
#   - dd (USB flashing, Linux only)
# ==============================================================================
set -euo pipefail

# -- Configuration -----------------------------------------------------------
UBUNTU_VERSION="24.04.2"
UBUNTU_ISO_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
UBUNTU_ISO_FILENAME="ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
UBUNTU_ISO_SHA256_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/SHA256SUMS"
OUTPUT_ISO="safeschool-edge-installer.iso"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${SCRIPT_DIR}/build"
EXTRACT_DIR="${WORK_DIR}/iso-extract"
FLASH_DEVICE=""

# -- Colors -------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -- Logging ------------------------------------------------------------------
log_info()    { echo -e "${BLUE}[INFO]${NC}    $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}      $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}    $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC}   $*" >&2; }

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}=====================================================${NC}"
    echo -e "${CYAN}${BOLD}  SafeSchool OS -- USB Installer Builder (Linux/Mac)${NC}"
    echo -e "${CYAN}${BOLD}=====================================================${NC}"
    echo ""
}

# -- Usage --------------------------------------------------------------------
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --flash /dev/sdX   Flash the built ISO to a USB drive"
    echo "  --output FILE      Output ISO filename (default: ${OUTPUT_ISO})"
    echo "  --work-dir DIR     Working directory (default: ${WORK_DIR})"
    echo "  --skip-download    Skip ISO download (use existing)"
    echo "  --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Build ISO only"
    echo "  $0 --flash /dev/sdb          # Build and flash to USB"
    echo "  $0 --output custom.iso       # Build with custom output name"
    exit 0
}

# -- Parse Arguments ----------------------------------------------------------
SKIP_DOWNLOAD=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --flash)
            FLASH_DEVICE="$2"
            shift 2
            ;;
        --output)
            OUTPUT_ISO="$2"
            shift 2
            ;;
        --work-dir)
            WORK_DIR="$2"
            EXTRACT_DIR="${WORK_DIR}/iso-extract"
            shift 2
            ;;
        --skip-download)
            SKIP_DOWNLOAD=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            log_error "Unknown argument: $1"
            usage
            ;;
    esac
done

# -- Dependency Checks --------------------------------------------------------
check_dependencies() {
    log_info "Checking dependencies..."
    local missing=()

    if ! command -v xorriso &>/dev/null; then
        missing+=("xorriso")
    fi

    # Check for extraction tool
    if ! command -v 7z &>/dev/null && ! command -v bsdtar &>/dev/null; then
        missing+=("p7zip-full (or bsdtar)")
    fi

    # Check for download tool
    if ! command -v wget &>/dev/null && ! command -v curl &>/dev/null; then
        missing+=("wget or curl")
    fi

    if [[ -n "$FLASH_DEVICE" ]] && ! command -v dd &>/dev/null; then
        missing+=("dd")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        echo ""
        echo "Install on Ubuntu/Debian:"
        echo "  sudo apt-get install xorriso p7zip-full wget"
        echo ""
        echo "Install on macOS:"
        echo "  brew install xorriso p7zip wget"
        exit 1
    fi

    log_success "All dependencies found."
}

# -- Download Ubuntu ISO ------------------------------------------------------
download_iso() {
    local iso_path="${WORK_DIR}/${UBUNTU_ISO_FILENAME}"

    if [[ -f "$iso_path" ]] && [[ "$SKIP_DOWNLOAD" == "true" ]]; then
        log_info "Using existing ISO: ${iso_path}"
        return 0
    fi

    if [[ -f "$iso_path" ]]; then
        log_info "ISO already downloaded: ${iso_path}"
        log_info "Verifying SHA256 checksum..."

        # Download SHA256SUMS for verification
        local sha256_file="${WORK_DIR}/SHA256SUMS"
        if command -v wget &>/dev/null; then
            wget -q -O "$sha256_file" "$UBUNTU_ISO_SHA256_URL" 2>/dev/null || true
        else
            curl -sL -o "$sha256_file" "$UBUNTU_ISO_SHA256_URL" 2>/dev/null || true
        fi

        if [[ -f "$sha256_file" ]]; then
            local expected_hash
            expected_hash=$(grep "$UBUNTU_ISO_FILENAME" "$sha256_file" | awk '{print $1}' || true)
            if [[ -n "$expected_hash" ]]; then
                local actual_hash
                if command -v sha256sum &>/dev/null; then
                    actual_hash=$(sha256sum "$iso_path" | awk '{print $1}')
                else
                    actual_hash=$(shasum -a 256 "$iso_path" | awk '{print $1}')
                fi
                if [[ "$expected_hash" == "$actual_hash" ]]; then
                    log_success "ISO checksum verified."
                    return 0
                else
                    log_warn "Checksum mismatch. Re-downloading..."
                    rm -f "$iso_path"
                fi
            fi
        fi
    fi

    if [[ ! -f "$iso_path" ]]; then
        log_info "Downloading Ubuntu Server ${UBUNTU_VERSION} LTS ISO..."
        log_info "URL: ${UBUNTU_ISO_URL}"
        log_info "This may take a while depending on your connection speed."
        echo ""

        if command -v wget &>/dev/null; then
            wget --show-progress -O "$iso_path" "$UBUNTU_ISO_URL"
        else
            curl -L --progress-bar -o "$iso_path" "$UBUNTU_ISO_URL"
        fi

        if [[ ! -f "$iso_path" ]]; then
            log_error "Failed to download Ubuntu ISO."
            exit 1
        fi
        log_success "ISO downloaded: ${iso_path}"
    fi
}

# -- Extract ISO --------------------------------------------------------------
extract_iso() {
    local iso_path="${WORK_DIR}/${UBUNTU_ISO_FILENAME}"

    if [[ -d "$EXTRACT_DIR" ]]; then
        log_info "Cleaning previous extraction..."
        rm -rf "$EXTRACT_DIR"
    fi

    mkdir -p "$EXTRACT_DIR"
    log_info "Extracting ISO contents..."

    if command -v 7z &>/dev/null; then
        7z x -o"$EXTRACT_DIR" "$iso_path" -y > /dev/null 2>&1
    elif command -v bsdtar &>/dev/null; then
        bsdtar xf "$iso_path" -C "$EXTRACT_DIR"
    else
        log_error "No extraction tool available (need 7z or bsdtar)."
        exit 1
    fi

    # Ensure the extracted contents are writable
    chmod -R u+w "$EXTRACT_DIR"

    log_success "ISO extracted to ${EXTRACT_DIR}"
}

# -- Inject Autoinstall Config ------------------------------------------------
inject_autoinstall() {
    log_info "Injecting autoinstall configuration..."

    # Create the autoinstall directory in the ISO
    local autoinstall_dir="${EXTRACT_DIR}/autoinstall"
    mkdir -p "$autoinstall_dir"

    # Copy user-data and meta-data
    if [[ ! -f "${SCRIPT_DIR}/user-data" ]]; then
        log_error "user-data file not found at ${SCRIPT_DIR}/user-data"
        exit 1
    fi
    if [[ ! -f "${SCRIPT_DIR}/meta-data" ]]; then
        log_error "meta-data file not found at ${SCRIPT_DIR}/meta-data"
        exit 1
    fi

    cp "${SCRIPT_DIR}/user-data" "$autoinstall_dir/user-data"
    cp "${SCRIPT_DIR}/meta-data" "$autoinstall_dir/meta-data"

    # Also place in the server directory (some installers look here)
    local server_dir="${EXTRACT_DIR}/server"
    if [[ -d "$server_dir" ]]; then
        cp "${SCRIPT_DIR}/user-data" "$server_dir/user-data"
        cp "${SCRIPT_DIR}/meta-data" "$server_dir/meta-data"
    fi

    # Copy first-boot script, MOTD, and network-admin into the ISO so late-commands can access them
    if [[ -f "${SCRIPT_DIR}/first-boot.sh" ]]; then
        cp "${SCRIPT_DIR}/first-boot.sh" "$autoinstall_dir/first-boot.sh"
        chmod +x "$autoinstall_dir/first-boot.sh"
    fi
    if [[ -f "${SCRIPT_DIR}/safeschool-motd.sh" ]]; then
        cp "${SCRIPT_DIR}/safeschool-motd.sh" "$autoinstall_dir/safeschool-motd.sh"
        chmod +x "$autoinstall_dir/safeschool-motd.sh"
    fi
    if [[ -f "${SCRIPT_DIR}/network-admin.py" ]]; then
        cp "${SCRIPT_DIR}/network-admin.py" "$autoinstall_dir/network-admin.py"
        chmod +x "$autoinstall_dir/network-admin.py"
    fi

    # Modify the GRUB configuration to add autoinstall kernel parameter
    local grub_cfg="${EXTRACT_DIR}/boot/grub/grub.cfg"
    if [[ -f "$grub_cfg" ]]; then
        log_info "Patching GRUB configuration for autoinstall..."
        # Add autoinstall parameter to the default menu entry
        sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$grub_cfg"
        log_success "GRUB patched."
    else
        log_warn "grub.cfg not found at expected location. Checking alternatives..."
        # Try alternative location
        grub_cfg=$(find "$EXTRACT_DIR" -name "grub.cfg" -path "*/boot/grub/*" | head -1 || true)
        if [[ -n "$grub_cfg" ]]; then
            sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$grub_cfg"
            log_success "GRUB patched at ${grub_cfg}"
        else
            log_warn "Could not find grub.cfg. Manual GRUB editing may be required."
        fi
    fi

    # Also patch the UEFI GRUB config if present
    local uefi_grub="${EXTRACT_DIR}/boot/grub/loopback.cfg"
    if [[ -f "$uefi_grub" ]]; then
        sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$uefi_grub"
        log_info "UEFI loopback GRUB patched."
    fi

    log_success "Autoinstall configuration injected."
}

# -- Rebuild ISO ---------------------------------------------------------------
rebuild_iso() {
    local output_path="${SCRIPT_DIR}/${OUTPUT_ISO}"

    log_info "Rebuilding bootable ISO with xorriso..."

    # Detect the EFI boot image and MBR
    local efi_img=""
    local mbr_img=""

    if [[ -f "${EXTRACT_DIR}/boot/grub/i386-pc/eltorito.img" ]]; then
        mbr_img="boot/grub/i386-pc/eltorito.img"
    elif [[ -f "${EXTRACT_DIR}/isolinux/isolinux.bin" ]]; then
        mbr_img="isolinux/isolinux.bin"
    fi

    if [[ -f "${EXTRACT_DIR}/EFI/boot/bootx64.efi" ]] || [[ -f "${EXTRACT_DIR}/boot.catalog" ]]; then
        efi_img="boot/grub/efi.img"
    fi

    # Find the boot catalog
    local boot_catalog=""
    if [[ -f "${EXTRACT_DIR}/boot.catalog" ]]; then
        boot_catalog="boot.catalog"
    fi

    # Build the xorriso command with proper BIOS + UEFI boot support
    xorriso -as mkisofs \
        -r -V "SafeSchool Edge Installer" \
        -o "$output_path" \
        --grub2-mbr "${EXTRACT_DIR}/boot/grub/i386-pc/boot_hybrid.img" \
        -partition_offset 16 \
        --mbr-force-bootable \
        -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "${EXTRACT_DIR}/boot/grub/efi.img" \
        -appended_part_as_gpt \
        -iso_mbr_part_type a2a0d0ebe5b9334487c068b6b72699c7 \
        -c '/boot.catalog' \
        -b '/boot/grub/i386-pc/eltorito.img' \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        --grub2-boot-info \
        -eltorito-alt-boot \
        -e '--interval:appended_partition_2:::' \
        -no-emul-boot \
        "$EXTRACT_DIR" \
        2>&1 | tail -5

    if [[ ! -f "$output_path" ]]; then
        log_error "Failed to create ISO."
        exit 1
    fi

    local iso_size
    iso_size=$(du -h "$output_path" | cut -f1)
    log_success "ISO created: ${output_path} (${iso_size})"
}

# -- Flash to USB --------------------------------------------------------------
flash_usb() {
    if [[ -z "$FLASH_DEVICE" ]]; then
        return 0
    fi

    # Validate the device exists
    if [[ ! -b "$FLASH_DEVICE" ]]; then
        log_error "Device ${FLASH_DEVICE} does not exist or is not a block device."
        exit 1
    fi

    # Safety: refuse to flash to common system drives
    case "$FLASH_DEVICE" in
        /dev/sda|/dev/nvme0n1|/dev/vda|/dev/xvda|/dev/mmcblk0)
            log_error "Refusing to flash to ${FLASH_DEVICE} -- this looks like a system drive!"
            log_error "Please specify a removable USB device (e.g., /dev/sdb, /dev/sdc)."
            exit 1
            ;;
    esac

    # Check if the device is mounted
    if mount | grep -q "^${FLASH_DEVICE}"; then
        log_warn "Device ${FLASH_DEVICE} has mounted partitions."
        log_info "Unmounting all partitions on ${FLASH_DEVICE}..."
        umount "${FLASH_DEVICE}"* 2>/dev/null || true
    fi

    # Get device info for confirmation
    local device_size
    device_size=$(lsblk -dno SIZE "$FLASH_DEVICE" 2>/dev/null || echo "unknown")
    local device_model
    device_model=$(lsblk -dno MODEL "$FLASH_DEVICE" 2>/dev/null || echo "unknown")

    echo ""
    echo -e "${RED}${BOLD}========================================${NC}"
    echo -e "${RED}${BOLD}  WARNING: USB FLASH OPERATION${NC}"
    echo -e "${RED}${BOLD}========================================${NC}"
    echo ""
    echo -e "  Device:  ${BOLD}${FLASH_DEVICE}${NC}"
    echo -e "  Size:    ${device_size}"
    echo -e "  Model:   ${device_model}"
    echo ""
    echo -e "${RED}${BOLD}  ALL DATA ON THIS DEVICE WILL BE DESTROYED!${NC}"
    echo ""
    read -rp "  Type 'YES' (uppercase) to confirm: " confirm

    if [[ "$confirm" != "YES" ]]; then
        log_info "Flash cancelled by user."
        return 0
    fi

    local iso_path="${SCRIPT_DIR}/${OUTPUT_ISO}"
    log_info "Flashing ${OUTPUT_ISO} to ${FLASH_DEVICE}..."
    log_info "This may take several minutes. Do not remove the USB drive."
    echo ""

    dd if="$iso_path" of="$FLASH_DEVICE" bs=4M status=progress oflag=sync

    # Ensure all data is written
    sync

    log_success "USB drive flashed successfully!"
    echo ""
    echo -e "${GREEN}${BOLD}The USB installer is ready.${NC}"
    echo -e "Insert it into the target mini PC and boot from USB."
    echo -e "The installation will proceed automatically."
}

# -- Cleanup -------------------------------------------------------------------
cleanup() {
    if [[ -d "${WORK_DIR}/iso-extract" ]]; then
        log_info "Cleaning up extracted ISO files..."
        rm -rf "${WORK_DIR}/iso-extract"
    fi
}

# -- Main ----------------------------------------------------------------------
main() {
    print_banner
    check_dependencies

    # Create working directory
    mkdir -p "$WORK_DIR"

    # Step 1: Download ISO
    echo ""
    echo -e "${BOLD}Step 1/5: Download Ubuntu Server ISO${NC}"
    download_iso

    # Step 2: Extract ISO
    echo ""
    echo -e "${BOLD}Step 2/5: Extract ISO${NC}"
    extract_iso

    # Step 3: Inject autoinstall
    echo ""
    echo -e "${BOLD}Step 3/5: Inject autoinstall configuration${NC}"
    inject_autoinstall

    # Step 4: Rebuild ISO
    echo ""
    echo -e "${BOLD}Step 4/5: Rebuild bootable ISO${NC}"
    rebuild_iso

    # Step 5: Optional flash
    echo ""
    echo -e "${BOLD}Step 5/5: Flash to USB (optional)${NC}"
    if [[ -n "$FLASH_DEVICE" ]]; then
        flash_usb
    else
        log_info "No --flash device specified. Skipping USB flash."
        echo ""
        echo -e "To flash later, run:"
        echo -e "  ${BOLD}sudo dd if=${SCRIPT_DIR}/${OUTPUT_ISO} of=/dev/sdX bs=4M status=progress oflag=sync${NC}"
    fi

    # Cleanup extracted files
    cleanup

    echo ""
    echo -e "${GREEN}${BOLD}=====================================================${NC}"
    echo -e "${GREEN}${BOLD}  SafeSchool Edge USB Installer -- Build Complete${NC}"
    echo -e "${GREEN}${BOLD}=====================================================${NC}"
    echo ""
    echo -e "  ISO:  ${BOLD}${SCRIPT_DIR}/${OUTPUT_ISO}${NC}"
    echo ""
    echo -e "  Next steps:"
    echo -e "    1. Flash the ISO to a USB drive (4GB+ recommended)"
    echo -e "    2. Insert USB into the target mini PC"
    echo -e "    3. Boot from USB (may need to change BIOS boot order)"
    echo -e "    4. Installation is fully automated -- hands off"
    echo -e "    5. NUC comes up at 192.168.0.250 (static IP)"
    echo -e "    6. Open http://192.168.0.250:9090 to configure network"
    echo -e "    7. Run: sudo safeschool config  (to set SITE_ID and integrations)"
    echo ""
}

main "$@"
