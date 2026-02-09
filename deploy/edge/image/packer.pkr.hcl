# ==============================================================================
# SafeSchool Edge — Packer VM Image Builder
# ==============================================================================
#
# Builds a reproducible VM image for VMware, Proxmox, QEMU, or cloud-hosted
# edge testing. The output is a fully provisioned SafeSchool edge node that
# boots and runs the complete edge stack without manual intervention.
#
# Usage:
#   cp variables.pkrvars.hcl.example variables.pkrvars.hcl
#   vi variables.pkrvars.hcl              # Edit to match your environment
#   packer init .                         # Install required plugins
#   packer build -var-file=variables.pkrvars.hcl packer.pkr.hcl
#
# Output:
#   output-safeschool-edge/safeschool-edge.qcow2   (QEMU/KVM/Proxmox)
#   output-safeschool-edge/safeschool-edge.img      (Raw disk, VMware, flashing)
#
# ==============================================================================

packer {
  required_version = ">= 1.9.0"

  required_plugins {
    qemu = {
      version = ">= 1.1.0"
      source  = "github.com/hashicorp/qemu"
    }
  }
}

# ==============================================================================
# Variables
# ==============================================================================

variable "ubuntu_iso_url" {
  type        = string
  description = "URL to the Ubuntu Server 24.04 LTS ISO image."
  default     = "https://releases.ubuntu.com/24.04/ubuntu-24.04.1-live-server-amd64.iso"
}

variable "ubuntu_iso_checksum" {
  type        = string
  description = "SHA256 checksum of the Ubuntu ISO (prefix with 'sha256:')."
  default     = "sha256:e240e4b801f7bb68c20d1356b60f4cbcc27b3be0bc2f7b1b4144e2c27c0460d0"
}

variable "vm_name" {
  type        = string
  description = "Name of the output VM image."
  default     = "safeschool-edge"
}

variable "disk_size" {
  type        = string
  description = "Disk size for the VM (e.g. '128G')."
  default     = "128G"
}

variable "memory" {
  type        = number
  description = "RAM allocation in MB."
  default     = 8192
}

variable "cpus" {
  type        = number
  description = "Number of virtual CPUs."
  default     = 4
}

variable "ssh_username" {
  type        = string
  description = "SSH username created during installation."
  default     = "safeschool"
}

variable "ssh_password" {
  type        = string
  description = "SSH password for the initial user (change after first boot)."
  default     = "SafeSchool2026!"
  sensitive   = true
}

variable "site_id" {
  type        = string
  description = "SafeSchool Site UUID. Leave empty to auto-generate on first boot."
  default     = ""
}

variable "site_name" {
  type        = string
  description = "Human-readable school/site name."
  default     = ""
}

variable "cloud_sync_url" {
  type        = string
  description = "Cloud API endpoint for bidirectional sync. Leave empty for standalone mode."
  default     = ""
}

variable "cloud_sync_key" {
  type        = string
  description = "API key for cloud sync authentication."
  default     = ""
  sensitive   = true
}

variable "headless" {
  type        = bool
  description = "Run the build in headless mode (no VNC display)."
  default     = true
}

variable "output_directory" {
  type        = string
  description = "Directory for the output image files."
  default     = "output-safeschool-edge"
}

# ==============================================================================
# Locals
# ==============================================================================

locals {
  # Timestamp for tagging the build
  build_timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# ==============================================================================
# Source: QEMU builder
# ==============================================================================
#
# Produces a .qcow2 image suitable for QEMU/KVM and Proxmox.
# Can be converted to other formats (vmdk, vdi, raw) with qemu-img.

source "qemu" "safeschool-edge" {
  vm_name          = "${var.vm_name}"
  output_directory = var.output_directory

  # ISO source
  iso_url      = var.ubuntu_iso_url
  iso_checksum = var.ubuntu_iso_checksum

  # VM hardware
  memory     = var.memory
  cpus       = var.cpus
  disk_size  = var.disk_size
  format     = "qcow2"
  accelerator = "kvm"

  # Display
  headless         = var.headless
  vnc_bind_address = "0.0.0.0"

  # Network
  net_device   = "virtio-net"
  disk_interface = "virtio"

  # SSH communicator
  ssh_username         = var.ssh_username
  ssh_password         = var.ssh_password
  ssh_timeout          = "30m"
  ssh_handshake_attempts = 50

  # Shutdown
  shutdown_command = "echo '${var.ssh_password}' | sudo -S shutdown -P now"

  # Ubuntu autoinstall boot command
  # Sends keystrokes to the GRUB menu to trigger an unattended installation
  # using cloud-init autoinstall. The kernel command line points to the
  # autoinstall configuration served via the built-in HTTP server.
  boot_wait = "5s"
  boot_command = [
    "<esc><wait>",
    "e<wait>",
    "<down><down><down><end>",
    " autoinstall ds=nocloud-net\\;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/",
    "<F10>"
  ]

  # Serve the autoinstall configuration via Packer's built-in HTTP server.
  # The cloud-init files (user-data, meta-data) must be in this directory.
  http_directory = "${path.root}/http"

  # QEMU-specific settings
  qemuargs = [
    ["-cpu", "host"],
    ["-smp", "${var.cpus}"],
    ["-m", "${var.memory}M"]
  ]
}

# ==============================================================================
# Build
# ==============================================================================

build {
  sources = ["source.qemu.safeschool-edge"]

  # --------------------------------------------------------------------------
  # Provisioner 1: Upload the first-boot provisioning script
  # --------------------------------------------------------------------------
  # The first-boot.sh script is expected to be in the parent directory
  # (deploy/edge/). It installs Docker, clones the SafeSchool repo,
  # configures the edge stack, and starts services.

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S mkdir -p /opt/safeschool-install"
    ]
  }

  provisioner "file" {
    source      = "${path.root}/../setup.sh"
    destination = "/tmp/safeschool-setup.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../install.sh"
    destination = "/tmp/safeschool-install.sh"
  }

  # --------------------------------------------------------------------------
  # Provisioner 2: Run the SafeSchool edge setup
  # --------------------------------------------------------------------------
  # Executes the setup script which installs Docker, clones the repository,
  # generates secrets, builds Docker images, and starts the stack.

  provisioner "shell" {
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive",
      "SITE_ID=${var.site_id}",
      "SITE_NAME=${var.site_name}",
      "CLOUD_SYNC_URL=${var.cloud_sync_url}",
      "CLOUD_SYNC_KEY=${var.cloud_sync_key}"
    ]
    inline = [
      "echo '${var.ssh_password}' | sudo -S bash /tmp/safeschool-setup.sh"
    ]
    expect_disconnect = true
  }

  # --------------------------------------------------------------------------
  # Provisioner 3: Install the safeschool CLI wrapper
  # --------------------------------------------------------------------------

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S tee /usr/local/bin/safeschool > /dev/null <<'CLIEOF'",
      "#!/bin/bash",
      "set -euo pipefail",
      "",
      "INSTALL_DIR=\"/opt/safeschool\"",
      "COMPOSE_FILE=\"$INSTALL_DIR/deploy/edge/docker-compose.yml\"",
      "ENV_FILE=\"$INSTALL_DIR/deploy/edge/.env\"",
      "",
      "case \"${1:-help}\" in",
      "  status)",
      "    docker compose -f \"$COMPOSE_FILE\" ps",
      "    ;;",
      "  logs)",
      "    shift",
      "    docker compose -f \"$COMPOSE_FILE\" logs -f \"$@\"",
      "    ;;",
      "  update)",
      "    sudo bash \"$INSTALL_DIR/deploy/edge/update.sh\"",
      "    ;;",
      "  backup)",
      "    sudo bash \"$INSTALL_DIR/deploy/edge/backup.sh\"",
      "    ;;",
      "  restore)",
      "    shift",
      "    sudo bash \"$INSTALL_DIR/deploy/edge/restore.sh\" \"$@\"",
      "    ;;",
      "  config)",
      "    sudo nano \"$ENV_FILE\"",
      "    ;;",
      "  restart)",
      "    docker compose -f \"$COMPOSE_FILE\" --env-file \"$ENV_FILE\" restart",
      "    ;;",
      "  stop)",
      "    docker compose -f \"$COMPOSE_FILE\" --env-file \"$ENV_FILE\" down",
      "    ;;",
      "  start)",
      "    docker compose -f \"$COMPOSE_FILE\" --env-file \"$ENV_FILE\" up -d",
      "    ;;",
      "  version)",
      "    cd \"$INSTALL_DIR\" && echo \"SafeSchool Edge $(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)\"",
      "    ;;",
      "  *)",
      "    echo \"SafeSchool Edge CLI\"",
      "    echo \"\"",
      "    echo \"Usage: safeschool <command>\"",
      "    echo \"\"",
      "    echo \"Commands:\"",
      "    echo \"  status    Show status of all services\"",
      "    echo \"  logs      Tail service logs (optionally specify service name)\"",
      "    echo \"  update    Pull latest code and rebuild services\"",
      "    echo \"  backup    Trigger an immediate database backup\"",
      "    echo \"  restore   Restore database from a backup file\"",
      "    echo \"  config    Edit edge configuration (.env)\"",
      "    echo \"  restart   Restart all services\"",
      "    echo \"  stop      Stop all services\"",
      "    echo \"  start     Start all services\"",
      "    echo \"  version   Show installed version\"",
      "    ;;",
      "esac",
      "CLIEOF",
      "echo '${var.ssh_password}' | sudo -S chmod +x /usr/local/bin/safeschool"
    ]
  }

  # --------------------------------------------------------------------------
  # Provisioner 4: Configure firewall (UFW)
  # --------------------------------------------------------------------------

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S apt-get install -y ufw",
      "echo '${var.ssh_password}' | sudo -S ufw default deny incoming",
      "echo '${var.ssh_password}' | sudo -S ufw default allow outgoing",
      "echo '${var.ssh_password}' | sudo -S ufw allow 22/tcp comment 'SSH'",
      "echo '${var.ssh_password}' | sudo -S ufw allow 80/tcp comment 'HTTP redirect'",
      "echo '${var.ssh_password}' | sudo -S ufw allow 443/tcp comment 'Dashboard HTTPS'",
      "echo '${var.ssh_password}' | sudo -S ufw allow 3443/tcp comment 'API HTTPS'",
      "echo '${var.ssh_password}' | sudo -S ufw allow 8443/tcp comment 'Kiosk HTTPS'",
      "echo '${var.ssh_password}' | sudo -S ufw allow 9090/tcp comment 'Admin panel'",
      "echo '${var.ssh_password}' | sudo -S ufw --force enable"
    ]
  }

  # --------------------------------------------------------------------------
  # Provisioner 5: Configure automatic security updates
  # --------------------------------------------------------------------------

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S apt-get install -y unattended-upgrades",
      "echo '${var.ssh_password}' | sudo -S dpkg-reconfigure -plow unattended-upgrades"
    ]
  }

  # --------------------------------------------------------------------------
  # Provisioner 6: Force password change on first login
  # --------------------------------------------------------------------------

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S chage -d 0 ${var.ssh_username}"
    ]
  }

  # --------------------------------------------------------------------------
  # Provisioner 7: Cleanup
  # --------------------------------------------------------------------------
  # Remove temporary files, apt caches, and logs to minimize image size.

  provisioner "shell" {
    inline = [
      "echo '${var.ssh_password}' | sudo -S apt-get autoremove -y",
      "echo '${var.ssh_password}' | sudo -S apt-get clean",
      "echo '${var.ssh_password}' | sudo -S rm -rf /var/lib/apt/lists/*",
      "echo '${var.ssh_password}' | sudo -S rm -rf /tmp/*",
      "echo '${var.ssh_password}' | sudo -S rm -rf /var/tmp/*",
      "echo '${var.ssh_password}' | sudo -S truncate -s 0 /var/log/*.log",
      "echo '${var.ssh_password}' | sudo -S truncate -s 0 /var/log/**/*.log 2>/dev/null || true",
      "echo '${var.ssh_password}' | sudo -S rm -f /var/log/safeschool-*.log",
      "echo '${var.ssh_password}' | sudo -S sync"
    ]
  }

  # --------------------------------------------------------------------------
  # Post-processor: Convert to raw .img format
  # --------------------------------------------------------------------------
  # Produces both .qcow2 (default from QEMU builder) and a raw .img file
  # that can be used with VMware, Proxmox, or written directly to an SSD.

  post-processor "shell-local" {
    inline = [
      "qemu-img convert -f qcow2 -O raw ${var.output_directory}/${var.vm_name} ${var.output_directory}/${var.vm_name}.img",
      "echo 'Build complete.'",
      "echo '  QCOW2: ${var.output_directory}/${var.vm_name}'",
      "echo '  Raw:   ${var.output_directory}/${var.vm_name}.img'",
      "echo ''",
      "echo 'To convert to other formats:'",
      "echo '  VMware vmdk: qemu-img convert -f qcow2 -O vmdk ${var.output_directory}/${var.vm_name} ${var.output_directory}/${var.vm_name}.vmdk'",
      "echo '  VirtualBox:  qemu-img convert -f qcow2 -O vdi  ${var.output_directory}/${var.vm_name} ${var.output_directory}/${var.vm_name}.vdi'"
    ]
  }
}
