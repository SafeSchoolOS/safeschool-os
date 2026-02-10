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
COPY autoinstall.yaml user-data meta-data first-boot.sh safeschool-motd.sh ./

# The build script
COPY build-iso.sh /build/build-iso.sh
RUN chmod +x /build/build-iso.sh

# Output directory
VOLUME /output

CMD ["/build/build-iso.sh"]
