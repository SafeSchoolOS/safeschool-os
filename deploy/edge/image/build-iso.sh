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
mkdir -p "$EXTRACT"

7z x -o"$EXTRACT" "${WORK}/${UBUNTU_ISO_FILE}" -y > /dev/null 2>&1
chmod -R u+w "$EXTRACT"

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
chmod +x "$AUTOINSTALL_DIR/first-boot.sh"
chmod +x "$AUTOINSTALL_DIR/safeschool-motd.sh"

# Also place user-data/meta-data in server/ directory (some installers look here)
if [ -d "${EXTRACT}/server" ]; then
    cp /build/user-data "${EXTRACT}/server/user-data"
    cp /build/meta-data "${EXTRACT}/server/meta-data"
fi

ok "Autoinstall files copied."

# Patch GRUB to add autoinstall kernel parameter
log "Patching GRUB for unattended install..."

GRUB_CFG="${EXTRACT}/boot/grub/grub.cfg"
if [ -f "$GRUB_CFG" ]; then
    # Insert autoinstall parameter before the --- separator
    sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$GRUB_CFG"
    ok "GRUB boot/grub/grub.cfg patched."
else
    # Search for grub.cfg in alternative locations
    GRUB_CFG=$(find "$EXTRACT" -name "grub.cfg" -path "*/boot/grub/*" 2>/dev/null | head -1)
    if [ -n "$GRUB_CFG" ]; then
        sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$GRUB_CFG"
        ok "GRUB patched at ${GRUB_CFG}"
    else
        warn "grub.cfg not found. The installer may prompt for confirmation."
    fi
fi

# Also patch loopback.cfg for UEFI boot
LOOPBACK_CFG="${EXTRACT}/boot/grub/loopback.cfg"
if [ -f "$LOOPBACK_CFG" ]; then
    sed -i 's|---| autoinstall ds=nocloud\;s=/cdrom/autoinstall/ ---|g' "$LOOPBACK_CFG"
    ok "UEFI loopback.cfg patched."
fi

# Set timeout to 1 second so it boots automatically
if [ -f "$GRUB_CFG" ]; then
    sed -i 's/set timeout=.*/set timeout=1/' "$GRUB_CFG" 2>/dev/null || true
    log "GRUB timeout set to 1 second."
fi

ok "Autoinstall injection complete."

# ============================================================================
# Step 4: Rebuild bootable ISO with xorriso
# ============================================================================
log "${BOLD}Step 4/5: Rebuilding bootable ISO with xorriso...${NC}"

# Check for required boot files
MBR_IMG="${EXTRACT}/boot/grub/i386-pc/boot_hybrid.img"
EFI_IMG="${EXTRACT}/boot/grub/efi.img"
ELTORITO="${EXTRACT}/boot/grub/i386-pc/eltorito.img"

if [ ! -f "$MBR_IMG" ]; then
    warn "MBR boot image not found at expected path."
    MBR_IMG=$(find "$EXTRACT" -name "boot_hybrid.img" 2>/dev/null | head -1)
    [ -z "$MBR_IMG" ] && fail "Cannot find boot_hybrid.img -- cannot build bootable ISO."
fi

if [ ! -f "$EFI_IMG" ]; then
    warn "EFI boot image not found at expected path."
    EFI_IMG=$(find "$EXTRACT" -name "efi.img" 2>/dev/null | head -1)
    [ -z "$EFI_IMG" ] && fail "Cannot find efi.img -- cannot build UEFI-bootable ISO."
fi

if [ ! -f "$ELTORITO" ]; then
    warn "El Torito image not found at expected path."
    ELTORITO=$(find "$EXTRACT" -name "eltorito.img" 2>/dev/null | head -1)
    [ -z "$ELTORITO" ] && fail "Cannot find eltorito.img -- cannot build BIOS-bootable ISO."
fi

log "Building ISO (this takes a moment)..."

xorriso -as mkisofs \
    -r \
    -V "SafeSchool Edge Installer" \
    -o "$OUTPUT_ISO" \
    --grub2-mbr "$MBR_IMG" \
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
    2>&1 | tail -10

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
echo -e "    4. SSH in: ssh safeschool@<IP>  (password: SafeSchool2026!)"
echo -e "    5. Configure: sudo safeschool config"
echo ""
