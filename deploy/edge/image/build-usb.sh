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
BOOT_DIR="${WORK_DIR}/BOOT"
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
            BOOT_DIR="${WORK_DIR}/BOOT"
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

    if ! command -v 7z &>/dev/null && ! command -v bsdtar &>/dev/null; then
        missing+=("p7zip-full (or bsdtar)")
    fi

    if ! command -v wget &>/dev/null && ! command -v curl &>/dev/null; then
        missing+=("wget or curl")
    fi

    if [[ -n "$FLASH_DEVICE" ]] && ! command -v dd &>/dev/null; then
        missing+=("dd")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        echo "Install on Ubuntu: sudo apt-get install xorriso p7zip-full wget"
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
        rm -rf "$EXTRACT_DIR"
    fi
    rm -rf "$BOOT_DIR"

    mkdir -p "$EXTRACT_DIR"
    mkdir -p "$BOOT_DIR"
    log_info "Extracting ISO contents..."

    if command -v 7z &>/dev/null; then
        7z x -o"$EXTRACT_DIR" "$iso_path" -y > /dev/null 2>&1
    elif command -v bsdtar &>/dev/null; then
        bsdtar xf "$iso_path" -C "$EXTRACT_DIR"
    else
        log_error "No extraction tool available (need 7z or bsdtar)."
        exit 1
    fi

    chmod -R u+w "$EXTRACT_DIR"

    # 7z creates a [BOOT] directory with the boot images we need for xorriso.
    # Move them to a separate directory so they don't end up in the ISO filesystem.
    if [[ -d "${EXTRACT_DIR}/[BOOT]" ]]; then
        mv "${EXTRACT_DIR}/[BOOT]"/* "$BOOT_DIR/" 2>/dev/null || true
        rm -rf "${EXTRACT_DIR}/[BOOT]"
        log_info "Boot images saved to ${BOOT_DIR}:"
        ls -la "$BOOT_DIR/"
    else
        log_warn "[BOOT] directory not found in extraction. Will extract from source ISO."
    fi

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
    log_success "user-data and meta-data copied to /autoinstall/"

    # Also place in the server directory (some installers look here)
    local server_dir="${EXTRACT_DIR}/server"
    if [[ -d "$server_dir" ]]; then
        cp "${SCRIPT_DIR}/user-data" "$server_dir/user-data"
        cp "${SCRIPT_DIR}/meta-data" "$server_dir/meta-data"
        log_info "Also copied to /server/ directory."
    fi

    # Copy support scripts into the ISO
    for script_file in first-boot.sh safeschool-motd.sh network-admin.py admin-menu.sh; do
        if [[ -f "${SCRIPT_DIR}/${script_file}" ]]; then
            cp "${SCRIPT_DIR}/${script_file}" "$autoinstall_dir/${script_file}"
            chmod +x "$autoinstall_dir/${script_file}"
        fi
    done

    # Copy embedded Docker images (if built by CI or locally)
    if [[ -d "${SCRIPT_DIR}/docker-images" ]]; then
        log_info "Embedding Docker images into ISO..."
        cp -r "${SCRIPT_DIR}/docker-images" "$autoinstall_dir/docker-images"
        local images_size
        images_size=$(du -sh "$autoinstall_dir/docker-images" | cut -f1)
        log_success "Docker images embedded (${images_size} total)."
    else
        log_warn "No docker-images/ directory found. ISO will require network to pull images."
    fi

    # Copy deploy/edge files (docker-compose.yml, Caddyfile, etc.)
    if [[ -d "${SCRIPT_DIR}/deploy-edge" ]]; then
        log_info "Embedding deploy/edge files into ISO..."
        cp -r "${SCRIPT_DIR}/deploy-edge" "$autoinstall_dir/deploy-edge"
        log_success "Deploy files embedded."
    fi

    # =========================================================================
    # GRUB: Replace grub.cfg entirely for reliable autoinstall boot
    # =========================================================================
    # Instead of sed-patching (fragile), we replace grub.cfg with a minimal
    # config that boots directly into autoinstall with zero interaction.
    # =========================================================================
    log_info "Writing autoinstall GRUB configuration..."

    local main_grub="${EXTRACT_DIR}/boot/grub/grub.cfg"
    if [[ -f "$main_grub" ]]; then
        # Detect kernel and initrd paths from the original grub.cfg
        local kernel_path initrd_path
        kernel_path=$(grep -m1 'linux.*vmlinuz' "$main_grub" | sed 's/.*\(\/casper\/[^ ]*vmlinuz[^ ]*\).*/\1/' || echo "/casper/vmlinuz")
        initrd_path=$(grep -m1 'initrd.*initrd' "$main_grub" | sed 's/.*\(\/casper\/[^ ]*initrd[^ ]*\).*/\1/' || echo "/casper/initrd")
        log_info "Kernel: ${kernel_path}"
        log_info "Initrd: ${initrd_path}"

        # Write a minimal grub.cfg for zero-touch autoinstall
        cat > "$main_grub" <<GRUBEOF
set timeout=0

loadfont unicode

set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

menuentry "SafeSchool OS Autoinstall" {
    set gfxpayload=keep
    linux   ${kernel_path} quiet autoinstall cloud-config-url=/dev/null ds=nocloud\\;s=/cdrom/autoinstall/ ---
    initrd  ${initrd_path}
}
GRUBEOF
        log_success "grub.cfg replaced with autoinstall config."
        log_info "Contents:"
        cat "$main_grub"
    else
        log_warn "boot/grub/grub.cfg not found!"
    fi

    # Also replace loopback.cfg
    local loopback="${EXTRACT_DIR}/boot/grub/loopback.cfg"
    if [[ -f "$loopback" ]]; then
        local kernel_path initrd_path
        kernel_path=$(grep -m1 'linux.*vmlinuz' "$loopback" | sed 's/.*\(\/casper\/[^ ]*vmlinuz[^ ]*\).*/\1/' || echo "/casper/vmlinuz")
        initrd_path=$(grep -m1 'initrd.*initrd' "$loopback" | sed 's/.*\(\/casper\/[^ ]*initrd[^ ]*\).*/\1/' || echo "/casper/initrd")
        cat > "$loopback" <<GRUBEOF
menuentry "SafeSchool OS Autoinstall" {
    set gfxpayload=keep
    linux   ${kernel_path} quiet autoinstall cloud-config-url=/dev/null ds=nocloud\\;s=/cdrom/autoinstall/ ---
    initrd  ${initrd_path}
}
GRUBEOF
        log_success "loopback.cfg replaced."
    fi

    # Update md5sum.txt to reflect our changes
    if [[ -f "${EXTRACT_DIR}/md5sum.txt" ]]; then
        log_info "Updating md5sum.txt..."
        (cd "$EXTRACT_DIR" && find . -type f -not -name md5sum.txt -exec md5sum {} \; > md5sum.txt 2>/dev/null) || true
        log_success "md5sum.txt updated."
    fi

    log_success "Autoinstall configuration injected."
}

# -- Rebuild ISO ---------------------------------------------------------------
rebuild_iso() {
    local output_path="${SCRIPT_DIR}/${OUTPUT_ISO}"
    local source_iso="${WORK_DIR}/${UBUNTU_ISO_FILENAME}"

    log_info "Rebuilding bootable ISO with xorriso..."

    # Determine MBR and EFI boot images
    local mbr_img=""
    local efi_img=""

    # Prefer [BOOT] images extracted by 7z (cleanest source)
    if [[ -f "${BOOT_DIR}/1-Boot-NoEmul.img" ]]; then
        mbr_img="${BOOT_DIR}/1-Boot-NoEmul.img"
        log_success "Using [BOOT]/1-Boot-NoEmul.img for MBR boot"
    else
        # Fallback: extract MBR from source ISO (first 432 bytes)
        mbr_img="${WORK_DIR}/mbr.img"
        dd if="$source_iso" bs=1 count=432 of="$mbr_img" 2>/dev/null
        log_info "MBR extracted from source ISO (fallback)"
    fi

    if [[ -f "${BOOT_DIR}/2-Boot-NoEmul.img" ]]; then
        efi_img="${BOOT_DIR}/2-Boot-NoEmul.img"
        log_success "Using [BOOT]/2-Boot-NoEmul.img for EFI boot"
    else
        # Fallback: extract EFI partition from source ISO via fdisk
        efi_img="${WORK_DIR}/efi.img"
        local efi_info
        efi_info=$(fdisk -l "$source_iso" 2>/dev/null | grep "EFI" || true)
        if [[ -n "$efi_info" ]]; then
            local efi_start efi_end efi_sectors
            efi_start=$(echo "$efi_info" | awk '{print $2}')
            efi_end=$(echo "$efi_info" | awk '{print $3}')
            efi_sectors=$((efi_end - efi_start + 1))
            dd if="$source_iso" bs=512 skip="$efi_start" count="$efi_sectors" of="$efi_img" 2>/dev/null
            log_info "EFI partition extracted from source ISO (fallback)"
        else
            log_error "Cannot locate EFI partition."
            exit 1
        fi
    fi

    log_info "MBR image: ${mbr_img} ($(stat -c%s "$mbr_img" 2>/dev/null || stat -f%z "$mbr_img") bytes)"
    log_info "EFI image: ${efi_img} ($(stat -c%s "$efi_img" 2>/dev/null || stat -f%z "$efi_img") bytes)"

    # Build the xorriso command with proper BIOS + UEFI hybrid boot support
    # Flags based on: https://github.com/maka00/ubuntu2404-autoinstall
    xorriso -as mkisofs \
        -r -V "SafeSchool Edge Installer" \
        -o "$output_path" \
        --grub2-mbr "$mbr_img" \
        --protective-msdos-label \
        -partition_cyl_align off \
        -partition_offset 16 \
        --mbr-force-bootable \
        -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$efi_img" \
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
        2>&1 | tail -10

    if [[ ! -f "$output_path" ]]; then
        # If BIOS+UEFI hybrid build failed (missing eltorito.img), try UEFI-only
        log_warn "Hybrid BIOS+UEFI build failed. Trying UEFI-only build..."
        xorriso -as mkisofs \
            -r -V "SafeSchool Edge Installer" \
            -o "$output_path" \
            --grub2-mbr "$mbr_img" \
            --protective-msdos-label \
            --mbr-force-bootable \
            -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$efi_img" \
            -appended_part_as_gpt \
            -eltorito-alt-boot \
            -e '--interval:appended_partition_2:::' \
            -no-emul-boot \
            "$EXTRACT_DIR" \
            2>&1 | tail -10
    fi

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

    if [[ ! -b "$FLASH_DEVICE" ]]; then
        log_error "Device ${FLASH_DEVICE} does not exist or is not a block device."
        exit 1
    fi

    case "$FLASH_DEVICE" in
        /dev/sda|/dev/nvme0n1|/dev/vda|/dev/xvda|/dev/mmcblk0)
            log_error "Refusing to flash to ${FLASH_DEVICE} -- this looks like a system drive!"
            exit 1
            ;;
    esac

    if mount | grep -q "^${FLASH_DEVICE}"; then
        log_warn "Unmounting ${FLASH_DEVICE}..."
        umount "${FLASH_DEVICE}"* 2>/dev/null || true
    fi

    local device_size device_model
    device_size=$(lsblk -dno SIZE "$FLASH_DEVICE" 2>/dev/null || echo "unknown")
    device_model=$(lsblk -dno MODEL "$FLASH_DEVICE" 2>/dev/null || echo "unknown")

    echo ""
    echo -e "${RED}${BOLD}  WARNING: ALL DATA ON ${FLASH_DEVICE} WILL BE DESTROYED!${NC}"
    echo -e "  Size: ${device_size}  Model: ${device_model}"
    read -rp "  Type 'YES' to confirm: " confirm

    if [[ "$confirm" != "YES" ]]; then
        log_info "Flash cancelled."
        return 0
    fi

    local iso_path="${SCRIPT_DIR}/${OUTPUT_ISO}"
    log_info "Flashing to ${FLASH_DEVICE}..."
    dd if="$iso_path" of="$FLASH_DEVICE" bs=4M status=progress oflag=sync
    sync
    log_success "USB drive flashed successfully!"
}

# -- Cleanup -------------------------------------------------------------------
cleanup() {
    if [[ -d "${WORK_DIR}/iso-extract" ]]; then
        log_info "Cleaning up..."
        rm -rf "${WORK_DIR}/iso-extract"
    fi
    rm -rf "$BOOT_DIR" 2>/dev/null || true
}

# -- Main ----------------------------------------------------------------------
main() {
    print_banner
    check_dependencies
    mkdir -p "$WORK_DIR"

    echo -e "\n${BOLD}Step 1/5: Download Ubuntu Server ISO${NC}"
    download_iso

    echo -e "\n${BOLD}Step 2/5: Extract ISO${NC}"
    extract_iso

    echo -e "\n${BOLD}Step 3/5: Inject autoinstall configuration${NC}"
    inject_autoinstall

    echo -e "\n${BOLD}Step 4/5: Rebuild bootable ISO${NC}"
    rebuild_iso

    echo -e "\n${BOLD}Step 5/5: Flash to USB (optional)${NC}"
    if [[ -n "$FLASH_DEVICE" ]]; then
        flash_usb
    else
        log_info "No --flash device specified."
        echo -e "  To flash: ${BOLD}sudo dd if=${SCRIPT_DIR}/${OUTPUT_ISO} of=/dev/sdX bs=4M status=progress${NC}"
    fi

    cleanup

    echo ""
    echo -e "${GREEN}${BOLD}  Build Complete!${NC}"
    echo -e "  ISO: ${SCRIPT_DIR}/${OUTPUT_ISO}"
    echo ""
}

main "$@"
