# SafeSchool Edge - Mini PC Image Builder

Create a bootable USB drive that auto-provisions any x86_64 mini PC as a
fully-configured SafeSchool edge node. The installer performs an unattended
Ubuntu Server 24.04 LTS installation, installs Docker and the complete
SafeSchool edge stack, configures networking and firewall rules, and enables
automated backups and auto-updates -- all without manual intervention.

---

## Table of Contents

1. [Supported Hardware](#supported-hardware)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [What Gets Installed](#what-gets-installed)
5. [Post-Install Setup](#post-install-setup)
6. [Network Configuration](#network-configuration)
7. [Accessing Services](#accessing-services)
8. [CLI Commands](#cli-commands)
9. [Troubleshooting](#troubleshooting)
10. [Security Notes](#security-notes)
11. [Backup and Recovery](#backup-and-recovery)
12. [Alternative Build Methods](#alternative-build-methods)

---

## Supported Hardware

### Recommended Models

| Vendor       | Model                        | Notes                                    |
|--------------|------------------------------|------------------------------------------|
| Intel        | NUC 13 Pro (Arena Canyon)    | Best tested, dual Ethernet available     |
| Intel        | NUC 12 Pro (Wall Street)     | Widely deployed, excellent reliability   |
| Beelink      | Mini S12 Pro                 | Budget option, adequate for small sites  |
| Beelink      | SER5                         | AMD Ryzen, good price/performance        |
| MinisForum   | UM690                        | Compact, dual NIC models available       |
| MinisForum   | UM760                        | Higher performance for larger sites      |

### Minimum Requirements

- **CPU**: x86_64 (Intel or AMD), 4+ cores recommended
- **RAM**: 4 GB minimum, **8 GB+ recommended**
- **Storage**: 64 GB SSD minimum, **256 GB SSD recommended**
- **Network**: 1 Ethernet port minimum, **2 Ethernet ports recommended**
- **Optional**: Wi-Fi (backup connectivity), USB 3.0 (for initial install)

Any x86_64 mini PC meeting these specifications will work. ARM-based devices
(Raspberry Pi, etc.) are not supported.

---

## Prerequisites

### Linux Build Host

Install the following packages to build the bootable USB image:

```bash
# Debian / Ubuntu
sudo apt-get install -y xorriso isolinux p7zip-full wget curl

# Fedora / RHEL
sudo dnf install -y xorriso syslinux p7zip wget curl
```

### Windows Build Host

- PowerShell 5.1 or later (included with Windows 10/11)
- Administrator privileges (required for writing to USB)
- No additional software required -- the script downloads what it needs

### USB Drive

- **Capacity**: 8 GB or larger
- **Warning**: The USB drive will be completely erased during the build process.
  Back up any important data before proceeding.

---

## Quick Start

### Linux

```bash
cd deploy/edge/image

# Make the build script executable
chmod +x build-usb.sh

# Build the image and flash directly to a USB drive
sudo ./build-usb.sh --flash /dev/sdX

# Or build the ISO only (no flash)
./build-usb.sh --iso-only
```

Replace `/dev/sdX` with your actual USB device (check with `lsblk`).

### Windows

Open PowerShell as Administrator:

```powershell
cd deploy\edge\image

# Flash to USB drive letter E:
.\build-usb.ps1 -DriveLetter E

# Or build the ISO only
.\build-usb.ps1 -IsoOnly
```

---

## What Gets Installed

The bootable USB performs a fully unattended installation that includes:

### Operating System

- **Ubuntu Server 24.04 LTS** (minimal server, no GUI)
- Automatic security updates enabled (unattended-upgrades)
- Timezone set to UTC

### Container Runtime

- **Docker Engine** (latest stable)
- **Docker Compose** plugin

### SafeSchool Edge Stack

| Service        | Description                                      | Container     |
|----------------|--------------------------------------------------|---------------|
| API            | Fastify REST + WebSocket server                  | `api`         |
| Worker         | BullMQ background job processor                  | `worker`      |
| Dashboard      | React admin dashboard                            | `dashboard`   |
| Kiosk          | React visitor check-in interface                 | `kiosk`       |
| Admin          | Edge administration panel                        | `admin`       |
| Caddy          | TLS-terminating reverse proxy                    | `caddy`       |
| PostgreSQL 16  | Primary database                                 | `postgres`    |
| Redis 7        | Job queue and caching                            | `redis`       |
| Watchtower     | Automatic container image updates                | `watchtower`  |
| Backup         | Scheduled database backup (daily at 2 AM UTC)    | `backup`      |

### System Configuration

- **UFW firewall** pre-configured (see [Network Configuration](#network-configuration))
- **SSH server** enabled on port 22
- **systemd service** (`safeschool.service`) for auto-start on boot
- **safeschool CLI** installed to `/usr/local/bin/safeschool`
- **Log rotation** configured for all SafeSchool logs

---

## Post-Install Setup

### Step 1: Boot from USB

1. Insert the USB drive into the target mini PC.
2. Power on and enter the boot menu:
   - **Intel NUC**: Press **F10** during POST
   - **Beelink / MinisForum**: Press **F7** or **F12** during POST
   - **Generic**: Press **F12**, **F2**, or **Del** during POST
3. Select the USB drive from the boot menu.

### Step 2: Wait for Installation

The installation is fully unattended. The mini PC will:

1. Partition and format the internal SSD
2. Install Ubuntu Server 24.04 LTS
3. Install Docker and the SafeSchool edge stack
4. Configure networking, firewall, and SSH
5. **Reboot automatically** when complete

Total time: approximately **15-20 minutes** depending on hardware and network
speed.

### Step 3: Configure Network via Web UI

After the reboot, the NUC comes up at a **known static IP: 192.168.0.250**.

1. Connect the NUC to your network via Ethernet.
2. Open a browser on any device on the same network and navigate to:
   ```
   http://192.168.0.250:9090
   ```
3. Enter the **admin token** shown on the NUC's console/MOTD (or retrieve it via
   `safeschool admin-token` after SSH login).
4. Use the web form to configure the correct IP address, gateway, DNS, and hostname
   for your school's network.
5. Click **Apply** -- the NUC will switch to the new IP and the browser will
   redirect automatically.

> **Note**: If your network does not use the 192.168.0.x range, you may need to
> temporarily connect a laptop directly to the NUC via Ethernet and set the laptop's
> IP to 192.168.0.x to reach the web UI.

### Step 4: SSH Login (Optional)

You can also SSH into the mini PC:

```bash
ssh safeschool@<IP-ADDRESS>
```

- **Default username**: `safeschool`
- **Default password**: `SafeSchool2026!`
- You will be prompted to change the password on first login.

### Step 5: Configure the Edge Node

Run the interactive configuration wizard:

```bash
safeschool config
```

You will be prompted to set the following values:

| Setting                    | Description                                          | Where to Find It                  |
|----------------------------|------------------------------------------------------|-----------------------------------|
| `SITE_ID`                  | UUID identifying this school site                    | Cloud dashboard > Sites           |
| `SITE_NAME`                | Human-readable school name                           | e.g. "Lincoln Elementary"         |
| `CLOUD_SYNC_URL`           | Cloud API endpoint for bidirectional sync             | Cloud admin settings              |
| `CLOUD_SYNC_KEY`           | API key for cloud sync authentication                | Cloud admin > Edge Devices        |
| `ACCESS_CONTROL_ADAPTER`   | Access control integration (sicunet, genetec, etc.)  | Based on installed hardware       |
| `AC_API_URL`               | Access control system API endpoint                   | AC vendor documentation           |
| `AC_API_KEY`               | Access control system API key                        | AC vendor portal                  |
| `DISPATCH_ADAPTER`         | 911 dispatch integration (rapidsos, rave-911, etc.)  | Based on district contract        |

### Step 6: Apply Configuration

After configuring, restart all services:

```bash
safeschool restart
```

Verify everything is running:

```bash
safeschool status
```

---

## Network Configuration

### Outbound (Mini PC to Internet)

The mini PC requires outbound internet access for:

- Pulling Docker container images (Docker Hub, GitHub Container Registry)
- Cloud sync (bidirectional data synchronization)
- Automatic security updates (Ubuntu apt repositories)
- Let's Encrypt certificate provisioning (if using a real domain)

### Inbound (Local Network to Mini PC)

Open the following ports on the local network:

| Port  | Protocol | Service                     |
|-------|----------|-----------------------------|
| 22    | TCP      | SSH (administration)        |
| 80    | TCP      | HTTP (redirects to HTTPS)   |
| 443   | TCP      | HTTPS (Dashboard)           |
| 3443  | TCP      | HTTPS (API / WebSocket)     |
| 8443  | TCP      | HTTPS (Kiosk)               |
| 9090  | TCP      | HTTP (Network Admin web UI) |

The UFW firewall is pre-configured to allow only these ports.

### Isolated / Air-Gapped Networks

For networks without internet access:

1. Pre-pull all Docker images on a connected machine:
   ```bash
   docker compose -f deploy/edge/docker-compose.yml pull
   docker save $(docker compose -f deploy/edge/docker-compose.yml config --images) | gzip > safeschool-images.tar.gz
   ```
2. Transfer `safeschool-images.tar.gz` to the mini PC via USB.
3. Load the images:
   ```bash
   gunzip -c safeschool-images.tar.gz | docker load
   ```
4. Set `CLOUD_SYNC_URL=` (empty) in `.env` to run in standalone mode.

---

## Accessing Services

Once the edge node is running, access the following services from any device
on the local network:

| Service     | URL                            | Purpose                                  |
|-------------|--------------------------------|------------------------------------------|
| Dashboard   | `https://<IP>/`                | Admin login, alert management, monitoring|
| Kiosk       | `https://<IP>:8443/`           | Visitor check-in (lobby tablet)          |
| API         | `https://<IP>:3443/`           | REST API + WebSocket endpoint            |
| Net Admin   | `http://<IP>:9090/`            | Network config web UI (token-protected)  |
| SSH         | `ssh safeschool@<IP>:22`       | Command-line administration              |

**Note**: The edge node uses self-signed TLS certificates by default. Browsers
will display a security warning on first visit -- add a browser exception to
proceed. To use trusted certificates, set `EDGE_DOMAIN` to a real FQDN in the
configuration and ensure DNS points to the mini PC.

---

## CLI Commands

The `safeschool` CLI is installed at `/usr/local/bin/safeschool` and provides
the following commands:

| Command                       | Description                                          |
|-------------------------------|------------------------------------------------------|
| `safeschool status`           | Show status of all SafeSchool services               |
| `safeschool logs [service]`   | Tail logs (optionally for a specific service)        |
| `safeschool update`           | Pull latest code and rebuild/restart services        |
| `safeschool backup`           | Trigger an immediate database backup                 |
| `safeschool restore <file>`   | Restore database from a backup file                  |
| `safeschool config`           | Interactive configuration editor                     |
| `safeschool restart`          | Restart all SafeSchool services                      |
| `safeschool stop`             | Stop all services (database data is preserved)       |
| `safeschool start`            | Start all services                                   |
| `safeschool network [cmd]`    | Network config (`show`, `set`, `dhcp`, `test`)       |
| `safeschool admin-token`      | Display the admin token for the Network Admin web UI |
| `safeschool version`          | Show installed SafeSchool version and commit hash    |

Examples:

```bash
# Check which services are running and healthy
safeschool status

# Follow API logs in real time
safeschool logs api

# Perform an immediate backup before a major change
safeschool backup

# Restore from yesterday's backup
safeschool restore safeschool_20260209T020000Z.sql.gz

# Update to the latest version
safeschool update
```

---

## Troubleshooting

### USB Not Booting

- Enter BIOS/UEFI setup (usually F2 or Del during POST).
- **Disable Secure Boot** -- the installer requires Secure Boot to be off.
- Set the boot order to prioritize USB devices.
- Ensure the USB was built correctly (`build-usb.sh` completed without errors).
- Try a different USB port (prefer USB 3.0 ports).

### No Network After Install

- The NUC defaults to static IP **192.168.0.250/24** after install.
- Verify the Ethernet cable is connected and the link LED is active.
- If your network uses a different subnet, connect a laptop directly to the NUC
  with a static IP in the 192.168.0.x range and open `http://192.168.0.250:9090`
  to reconfigure.
- Alternatively, use `safeschool network set` from the console or SSH.
- Check network status: `ip addr show` and `ping -c 3 8.8.8.8`.

### Services Not Starting

```bash
# Check overall status
safeschool status

# Check logs for a specific service
safeschool logs api
safeschool logs postgres
safeschool logs worker

# Verify the .env file exists and has required values
cat /opt/safeschool/deploy/edge/.env

# Manually restart
safeschool restart
```

### Cloud Sync Not Working

- Verify `CLOUD_SYNC_URL` is set and reachable:
  ```bash
  curl -sf "$CLOUD_SYNC_URL/health"
  ```
- Verify `CLOUD_SYNC_KEY` matches the key configured in the cloud admin panel.
- Check API logs for sync errors: `safeschool logs api | grep sync`.
- Ensure outbound HTTPS (port 443) is not blocked by a firewall or proxy.

### SSL Certificate Warnings

By default, the edge node uses self-signed TLS certificates generated by Caddy.
This is expected behavior for local network deployments. Options:

1. **Accept the browser warning** and add a permanent exception.
2. **Set a real domain**: Configure `EDGE_DOMAIN` in `.env` with a FQDN that
   resolves to the mini PC's IP. Caddy will automatically provision a
   Let's Encrypt certificate.
3. **Import the CA certificate**: Export Caddy's root CA from the container
   and install it on client devices.

### Database Issues

```bash
# Check PostgreSQL container health
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml ps postgres

# Connect to the database directly
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml exec postgres \
  psql -U safeschool -d safeschool

# Re-run migrations
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml run --rm migrate
```

---

## Security Notes

### Immediate Post-Install Actions

1. **Change the default password** -- you will be prompted on first SSH login.
   If not, change it manually: `passwd`
2. **Set up SSH key authentication** and disable password-based login:
   ```bash
   # On your workstation, copy your SSH key
   ssh-copy-id safeschool@<IP>

   # On the mini PC, disable password auth
   sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart sshd
   ```

### Pre-Configured Security

- **UFW firewall** is enabled and configured to allow only SafeSchool ports.
- **Automatic security updates** are enabled via `unattended-upgrades`.
- **Docker bridge network** isolates inter-service communication.
- **PostgreSQL and Redis** are not exposed outside the Docker network.
- **Caddy** enforces HTTPS with security headers (HSTS, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy).
- **Database credentials** are randomly generated during installation.

### Ongoing Maintenance

- Run `safeschool update` regularly to pull the latest security patches.
- Monitor logs for anomalies: `safeschool logs`.
- Review the admin panel at `http://<IP>:9090/` for system health.

---

## Backup and Recovery

### Automated Backups

The edge node runs automated PostgreSQL backups:

- **Daily backups** at 2:00 AM UTC
- **Weekly backups** on Sundays (in addition to the daily)
- **Retention**: 7 daily + 4 weekly backups (rotated automatically)
- **Storage**: `/opt/safeschool/backups/` on the local disk
- **Optional**: S3 upload if `AWS_BACKUP_BUCKET` is configured

### Manual Backup

```bash
safeschool backup
```

### Restore from Backup

```bash
# List available backups
safeschool restore

# Restore a specific backup
safeschool restore safeschool_20260209T020000Z.sql.gz
```

The restore process automatically:

1. Creates a pre-restore safety backup of the current database
2. Stops the API and worker services
3. Drops and recreates the database
4. Restores from the specified backup file
5. Restarts services and verifies health
6. Rolls back to the safety backup if the restore fails

### Full System Recovery

If the mini PC hardware fails or the SSD is corrupted:

1. Obtain a new mini PC (or repair the existing one).
2. Flash the SafeSchool USB image and install (see [Quick Start](#quick-start)).
3. After installation, restore the latest backup:
   ```bash
   # Copy backup from external storage
   scp backup-server:/backups/safeschool_latest.sql.gz /tmp/

   # Restore
   safeschool restore /tmp/safeschool_latest.sql.gz
   ```
4. Re-run `safeschool config` if needed (configuration is stored in `.env`,
   not in the database).

---

## Alternative Build Methods

In addition to the USB image builder, two alternative methods are available
for testing and virtualized deployments.

### HashiCorp Packer (VM Image)

Use `packer.pkr.hcl` to build a reproducible VM image for VMware, Proxmox,
QEMU, or cloud-hosted edge testing:

```bash
cd deploy/edge/image

# Copy and edit the variables file
cp variables.pkrvars.hcl.example variables.pkrvars.hcl
vi variables.pkrvars.hcl

# Initialize Packer plugins
packer init .

# Build the image
packer build -var-file=variables.pkrvars.hcl packer.pkr.hcl
```

Output formats: `.qcow2` (QEMU/KVM/Proxmox) and `.img` (raw disk image for
VMware or direct flashing).

See `packer.pkr.hcl` for full configuration details.

### Vagrant (Local Development)

Use the `Vagrantfile` to spin up a local edge node in VirtualBox or libvirt
for development and testing:

```bash
cd deploy/edge/image

# Start the VM
vagrant up

# SSH into the VM
vagrant ssh

# Destroy when done
vagrant destroy
```

Port mappings for local access:

| Host Port | Guest Port | Service   |
|-----------|------------|-----------|
| 8080      | 80         | HTTP      |
| 8443      | 443        | Dashboard |
| 3443      | 3443       | API       |
| 9090      | 9090       | Admin     |

See the `Vagrantfile` for full configuration details.
