#!/bin/bash
# SafeSchoolOS NanoPi Gateway - Image builder
# Creates a flashable eMMC/SD image for NanoPi with EdgeRuntime pre-installed
#
# Usage: ./flash-image.sh --key XXXX-XXXX-XXXX-XXXX --site "lincoln-elementary"

set -euo pipefail

ACTIVATION_KEY=""
SITE_ID=""
OUTPUT_DIR="./output"

while [[ $# -gt 0 ]]; do
  case $1 in
    --key) ACTIVATION_KEY="$2"; shift 2 ;;
    --site) SITE_ID="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$ACTIVATION_KEY" ] || [ -z "$SITE_ID" ]; then
  echo "Usage: $0 --key XXXX-XXXX-XXXX-XXXX --site my-school-id"
  exit 1
fi

echo "============================================"
echo " SafeSchoolOS NanoPi Gateway Image Builder"
echo "============================================"
echo "Activation Key: ${ACTIVATION_KEY:0:4}-****-****-****"
echo "Site ID:        $SITE_ID"
echo ""

mkdir -p "$OUTPUT_DIR"

# Generate config.yaml
cat > "$OUTPUT_DIR/config.yaml" <<EOF
activationKey: "$ACTIVATION_KEY"
siteId: "$SITE_ID"
dataDir: /app/data
apiPort: 8470
syncIntervalMs: 30000
healthCheckIntervalMs: 15000
moduleDirs:
  - ./modules
EOF

# Generate .env
cat > "$OUTPUT_DIR/.env" <<EOF
NODE_ENV=production
EDGERUNTIME_DATA_DIR=/app/data
EDGERUNTIME_API_PORT=8470
EDGERUNTIME_CONFIG=/app/config.yaml
EOF

# Copy docker-compose
cp "$(dirname "$0")/docker-compose.yml" "$OUTPUT_DIR/"

# Build ARM image
echo "Building ARM64 Docker image..."
docker build --platform linux/arm64 \
  -t safeschoolos-gateway:arm64 \
  -f "$(dirname "$0")/../../../deploy/docker/Dockerfile" \
  "$(dirname "$0")/../../.."

# Save image as tarball for offline loading
echo "Saving Docker image tarball..."
docker save safeschoolos-gateway:arm64 | gzip > "$OUTPUT_DIR/safeschoolos-gateway-arm64.tar.gz"

echo ""
echo "Image build complete!"
echo "Output: $OUTPUT_DIR/"
echo ""
echo "To deploy on NanoPi:"
echo "  1. Copy $OUTPUT_DIR/ to NanoPi"
echo "  2. docker load < safeschoolos-gateway-arm64.tar.gz"
echo "  3. docker compose up -d"
