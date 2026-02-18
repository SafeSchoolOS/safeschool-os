# ==============================================================================
# SafeSchool Edge ISO Builder
# ==============================================================================
# Builds the SafeSchool edge installer ISO inside a container.
#
# Usage:
#   docker build -f Dockerfile.builder -t safeschool-iso-builder .
#   docker run --rm -v "$(pwd)/output:/output" safeschool-iso-builder
# ==============================================================================
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    xorriso \
    p7zip-full \
    wget \
    ca-certificates \
    isolinux \
    syslinux-utils \
    fdisk \
    file \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy all image builder files
COPY autoinstall.yaml user-data meta-data first-boot.sh safeschool-motd.sh network-admin.py admin-menu.sh ./
COPY safeschool-first-boot.service 99-safeschool-motd ./

# The build script
COPY build-iso.sh /build/build-iso.sh
RUN chmod +x /build/build-iso.sh

# Optional: To embed Docker images in the ISO (for offline first-boot), create
# docker-images/ and deploy-edge/ in the build context before building:
#   mkdir docker-images && docker save ghcr.io/.../api:latest | gzip > docker-images/api.tar.gz
#   mkdir deploy-edge && cp ../docker-compose.yml ../Caddyfile ../.env.example deploy-edge/
# Then mount them at runtime:
#   docker run --rm -v "$(pwd)/docker-images:/build/docker-images" \
#     -v "$(pwd)/deploy-edge:/build/deploy-edge" -v "$(pwd)/output:/output" safeschool-iso-builder

# Output directory
VOLUME /output

CMD ["/build/build-iso.sh"]
