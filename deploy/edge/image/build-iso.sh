#!/bin/bash
# ==============================================================================
# SafeSchool Edge -- ISO Builder (runs inside Docker container)
# ==============================================================================
set -euo pipefail

UBUNTU_VERSION="24.04.2"
UBUNTU_ISO_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
UBUNTU_ISO_FILE="ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
SHA256_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/SHA256SUMS"
OUTPUT_ISO="/output/safeschool-edge-installer.iso"
WORK="/build/work"
EXTRACT="/build/work/iso-extract"
BOOT_DIR="/build/work/BOOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date -u '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }

echo ""
echo -e "${CYAN}${BOLD}====================================================${NC}"
echo -e "${CYAN}${BOLD}  SafeSchool Edge -- ISO Installer Builder${NC}"
echo -e "${CYAN}${BOLD}====================================================${NC}"
echo ""

mkdir -p "$WORK" /output

# ============================================================================
# Step 1: Download Ubuntu Server ISO
# ============================================================================
log "${BOLD}Step 1/5: Downloading Ubuntu Server ${UBUNTU_VERSION} ISO...${NC}"

if [ -f "${WORK}/${UBUNTU_ISO_FILE}" ]; then
    log "ISO already cached. Verifying..."
else
    log "Downloading from ${UBUNTU_ISO_URL}"
    log "This will take several minutes (~2.6 GB)..."
    wget --progress=bar:force:noscroll -O "${WORK}/${UBUNTU_ISO_FILE}" "$UBUNTU_ISO_URL"
fi

# Verify checksum
log "Downloading SHA256SUMS for verification..."
wget -q -O "${WORK}/SHA256SUMS" "$SHA256_URL" 2>/dev/null || warn "Could not download SHA256SUMS"

if [ -f "${WORK}/SHA256SUMS" ]; then
    EXPECTED=$(grep "$UBUNTU_ISO_FILE" "${WORK}/SHA256SUMS" | awk '{print $1}')
    if [ -n "$EXPECTED" ]; then
        ACTUAL=$(sha256sum "${WORK}/${UBUNTU_ISO_FILE}" | awk '{print $1}')
        if [ "$EXPECTED" = "$ACTUAL" ]; then
            ok "SHA256 checksum verified."
        else
            warn "Checksum mismatch! Expected: ${EXPECTED}"
            warn "                   Got:      ${ACTUAL}"
            warn "Re-downloading ISO..."
            rm -f "${WORK}/${UBUNTU_ISO_FILE}"
            wget --progress=bar:force:noscroll -O "${WORK}/${UBUNTU_ISO_FILE}" "$UBUNTU_ISO_URL"
        fi
    else
        warn "ISO filename not found in SHA256SUMS. Skipping verification."
    fi
fi

ISO_SIZE=$(du -h "${WORK}/${UBUNTU_ISO_FILE}" | cut -f1)
ok "Ubuntu ISO ready: ${ISO_SIZE}"

# ============================================================================
# Step 2: Extract ISO
# ============================================================================
log "${BOLD}Step 2/5: Extracting ISO contents...${NC}"

rm -rf "$EXTRACT"
rm -rf "$BOOT_DIR"
mkdir -p "$EXTRACT"
mkdir -p "$BOOT_DIR"

7z x -o"$EXTRACT" "${WORK}/${UBUNTU_ISO_FILE}" -y > /dev/null 2>&1
chmod -R u+w "$EXTRACT"

# 7z creates a [BOOT] directory with boot images we need for xorriso.
# Move them to a separate directory so they don't end up in the ISO filesystem.
if [ -d "${EXTRACT}/[BOOT]" ]; then
    mv "${EXTRACT}/[BOOT]"/* "$BOOT_DIR/" 2>/dev/null || true
    rm -rf "${EXTRACT}/[BOOT]"
    log "Boot images saved to ${BOOT_DIR}:"
    ls -la "$BOOT_DIR/"
else
    warn "[BOOT] directory not found in extraction. Will extract from source ISO."
fi

ok "ISO extracted to ${EXTRACT}"

# ============================================================================
# Step 3: Inject autoinstall configuration
# ============================================================================
log "${BOLD}Step 3/5: Injecting SafeSchool autoinstall configuration...${NC}"

# Create autoinstall directory on the ISO
AUTOINSTALL_DIR="${EXTRACT}/autoinstall"
mkdir -p "$AUTOINSTALL_DIR"

# Copy cloud-init files
cp /build/user-data "$AUTOINSTALL_DIR/user-data"
cp /build/meta-data "$AUTOINSTALL_DIR/meta-data"

# Copy provisioning scripts so late-commands can access them from /cdrom/
cp /build/first-boot.sh "$AUTOINSTALL_DIR/first-boot.sh"
cp /build/safeschool-motd.sh "$AUTOINSTALL_DIR/safeschool-motd.sh"
cp /build/network-admin.py "$AUTOINSTALL_DIR/network-admin.py"
cp /build/admin-menu.sh "$AUTOINSTALL_DIR/admin-menu.sh"
chmod +x "$AUTOINSTALL_DIR/first-boot.sh"
chmod +x "$AUTOINSTALL_DIR/safeschool-motd.sh"
chmod +x "$AUTOINSTALL_DIR/network-admin.py"
chmod +x "$AUTOINSTALL_DIR/admin-menu.sh"

# Also place user-data/meta-data in server/ directory (some installers look here)
if [ -d "${EXTRACT}/server" ]; then
    cp /build/user-data "${EXTRACT}/server/user-data"
    cp /build/meta-data "${EXTRACT}/server/meta-data"
fi

ok "Autoinstall files copied."

# Copy embedded Docker images (if built by CI or locally)
if [ -d /build/docker-images ]; then
    log "Embedding Docker images into ISO..."
    cp -r /build/docker-images "$AUTOINSTALL_DIR/docker-images"
    IMAGES_SIZE=$(du -sh "$AUTOINSTALL_DIR/docker-images" | cut -f1)
    ok "Docker images embedded (${IMAGES_SIZE} total)."
else
    warn "No docker-images/ directory found. ISO will require network to pull images on first boot."
fi

# Copy deploy/edge files (docker-compose.yml, Caddyfile, etc.)
if [ -d /build/deploy-edge ]; then
    log "Embedding deploy/edge files into ISO..."
    cp -r /build/deploy-edge "$AUTOINSTALL_DIR/deploy-edge"
    ok "Deploy files embedded: $(ls /build/deploy-edge | tr '\n' ' ')"
else
    warn "No deploy-edge/ directory found. ISO will require git clone for deploy files."
fi

# =========================================================================
# GRUB: Replace grub.cfg entirely for reliable autoinstall boot
# =========================================================================
log "Writing autoinstall GRUB configuration..."

MAIN_GRUB="${EXTRACT}/boot/grub/grub.cfg"
if [ -f "$MAIN_GRUB" ]; then
    # Detect kernel and initrd paths from the original grub.cfg
    KERNEL_PATH=$(grep -m1 'linux.*vmlinuz' "$MAIN_GRUB" | sed 's/.*\(\/casper\/[^ ]*vmlinuz[^ ]*\).*/\1/' || echo "/casper/vmlinuz")
    INITRD_PATH=$(grep -m1 'initrd.*initrd' "$MAIN_GRUB" | sed 's/.*\(\/casper\/[^ ]*initrd[^ ]*\).*/\1/' || echo "/casper/initrd")
    log "Kernel: ${KERNEL_PATH}"
    log "Initrd: ${INITRD_PATH}"

    # Write a minimal grub.cfg for zero-touch autoinstall
    cat > "$MAIN_GRUB" <<GRUBEOF
set timeout=0

loadfont unicode

set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

menuentry "SafeSchool OS Autoinstall" {
    set gfxpayload=keep
    linux   ${KERNEL_PATH} quiet autoinstall cloud-config-url=/dev/null ds=nocloud\\;s=/cdrom/autoinstall/ ---
    initrd  ${INITRD_PATH}
}
GRUBEOF
    ok "grub.cfg replaced with autoinstall config."
    log "Contents:"
    cat "$MAIN_GRUB"
else
    warn "boot/grub/grub.cfg not found!"
fi

# Also replace loopback.cfg
LOOPBACK="${EXTRACT}/boot/grub/loopback.cfg"
if [ -f "$LOOPBACK" ]; then
    KERNEL_PATH=$(grep -m1 'linux.*vmlinuz' "$LOOPBACK" | sed 's/.*\(\/casper\/[^ ]*vmlinuz[^ ]*\).*/\1/' || echo "/casper/vmlinuz")
    INITRD_PATH=$(grep -m1 'initrd.*initrd' "$LOOPBACK" | sed 's/.*\(\/casper\/[^ ]*initrd[^ ]*\).*/\1/' || echo "/casper/initrd")
    cat > "$LOOPBACK" <<GRUBEOF
menuentry "SafeSchool OS Autoinstall" {
    set gfxpayload=keep
    linux   ${KERNEL_PATH} quiet autoinstall cloud-config-url=/dev/null ds=nocloud\\;s=/cdrom/autoinstall/ ---
    initrd  ${INITRD_PATH}
}
GRUBEOF
    ok "loopback.cfg replaced."
fi

# Update md5sum.txt to reflect our changes
if [ -f "${EXTRACT}/md5sum.txt" ]; then
    log "Updating md5sum.txt..."
    (cd "$EXTRACT" && find . -type f -not -name md5sum.txt -exec md5sum {} \; > md5sum.txt 2>/dev/null) || true
    ok "md5sum.txt updated."
fi

ok "Autoinstall injection complete."

# ============================================================================
# Step 4: Rebuild bootable ISO with xorriso
# ============================================================================
log "${BOLD}Step 4/5: Rebuilding bootable ISO with xorriso...${NC}"

SOURCE_ISO="${WORK}/${UBUNTU_ISO_FILE}"

# Determine MBR and EFI boot images
MBR_IMG=""
EFI_IMG=""

# Prefer [BOOT] images extracted by 7z (cleanest source)
if [ -f "${BOOT_DIR}/1-Boot-NoEmul.img" ]; then
    MBR_IMG="${BOOT_DIR}/1-Boot-NoEmul.img"
    ok "Using [BOOT]/1-Boot-NoEmul.img for MBR boot"
else
    # Fallback: extract MBR from source ISO (first 432 bytes)
    MBR_IMG="${WORK}/mbr.img"
    dd if="$SOURCE_ISO" bs=1 count=432 of="$MBR_IMG" 2>/dev/null
    log "MBR extracted from source ISO (fallback)"
fi

if [ -f "${BOOT_DIR}/2-Boot-NoEmul.img" ]; then
    EFI_IMG="${BOOT_DIR}/2-Boot-NoEmul.img"
    ok "Using [BOOT]/2-Boot-NoEmul.img for EFI boot"
else
    # Fallback: extract EFI partition from source ISO via fdisk
    EFI_IMG="${WORK}/efi.img"
    EFI_INFO=$(fdisk -l "$SOURCE_ISO" 2>/dev/null | grep "EFI" || true)
    if [ -n "$EFI_INFO" ]; then
        EFI_SECTOR_START=$(echo "$EFI_INFO" | awk '{print $2}')
        EFI_SECTOR_END=$(echo "$EFI_INFO" | awk '{print $3}')
        EFI_SECTORS=$((EFI_SECTOR_END - EFI_SECTOR_START + 1))
        dd if="$SOURCE_ISO" bs=512 skip="$EFI_SECTOR_START" count="$EFI_SECTORS" of="${WORK}/efi.img" 2>/dev/null
        log "EFI partition extracted from source ISO (fallback)"
    else
        fail "Cannot locate EFI partition in source ISO."
    fi
fi

log "MBR image: ${MBR_IMG} ($(stat -c%s "$MBR_IMG") bytes)"
log "EFI image: ${EFI_IMG} ($(stat -c%s "$EFI_IMG") bytes)"

log "Building ISO (this takes a moment)..."

# Build with proper BIOS + UEFI hybrid boot support
xorriso -as mkisofs \
    -r \
    -V "SafeSchool Edge Installer" \
    -o "$OUTPUT_ISO" \
    --grub2-mbr "$MBR_IMG" \
    --protective-msdos-label \
    -partition_cyl_align off \
    -partition_offset 16 \
    --mbr-force-bootable \
    -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$EFI_IMG" \
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
    "$EXTRACT" \
    2>&1 | tail -10 || {
    # If BIOS+UEFI hybrid build failed (missing eltorito.img), try UEFI-only
    warn "Hybrid BIOS+UEFI build failed. Trying UEFI-only build..."
    xorriso -as mkisofs \
        -r \
        -V "SafeSchool Edge Installer" \
        -o "$OUTPUT_ISO" \
        --grub2-mbr "$MBR_IMG" \
        --protective-msdos-label \
        --mbr-force-bootable \
        -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$EFI_IMG" \
        -appended_part_as_gpt \
        -eltorito-alt-boot \
        -e '--interval:appended_partition_2:::' \
        -no-emul-boot \
        "$EXTRACT" \
        2>&1 | tail -10
}

if [ ! -f "$OUTPUT_ISO" ]; then
    fail "ISO build failed -- output file not created."
fi

ISO_FINAL_SIZE=$(du -h "$OUTPUT_ISO" | cut -f1)
ok "ISO created: ${OUTPUT_ISO} (${ISO_FINAL_SIZE})"

# ============================================================================
# Step 5: Verify the ISO
# ============================================================================
log "${BOLD}Step 5/5: Verifying ISO...${NC}"

# Check it's a valid ISO
FILE_TYPE=$(file "$OUTPUT_ISO")
log "File type: ${FILE_TYPE}"

# Generate checksum
ISO_SHA256=$(sha256sum "$OUTPUT_ISO" | awk '{print $1}')
echo "$ISO_SHA256  safeschool-edge-installer.iso" > /output/SHA256SUM
ok "SHA256: ${ISO_SHA256}"

# Cleanup extracted files to save space
log "Cleaning up working files..."
rm -rf "$EXTRACT"
rm -rf "$BOOT_DIR"

# ============================================================================
# Done
# ============================================================================
echo ""
echo -e "${GREEN}${BOLD}====================================================${NC}"
echo -e "${GREEN}${BOLD}  SafeSchool Edge ISO -- Build Complete${NC}"
echo -e "${GREEN}${BOLD}====================================================${NC}"
echo ""
echo -e "  ${BOLD}ISO file:${NC}  /output/safeschool-edge-installer.iso"
echo -e "  ${BOLD}Size:${NC}      ${ISO_FINAL_SIZE}"
echo -e "  ${BOLD}SHA256:${NC}    ${ISO_SHA256}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. Flash to USB with Rufus (Windows) or dd (Linux/Mac)"
echo -e "    2. Boot the mini PC from USB"
echo -e "    3. Installation is fully automated (~15-20 min)"
echo -e "    4. NUC comes up at 192.168.0.250 (static)"
echo -e "    5. Open http://192.168.0.250:9090 to configure network"
echo -e "    6. Configure: sudo safeschool config"
echo ""
