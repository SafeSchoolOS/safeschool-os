# SafeSchool OS -- Deployment Guide

Production deployment instructions for the SafeSchool platform. SafeSchool runs in two modes: **Cloud** (Railway) for central management and multi-site coordination, and **Edge** (on-site Mini PC) for local operation with offline resilience.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Cloud Deployment (Railway)](#cloud-deployment-railway)
- [Edge Deployment (Mini PC)](#edge-deployment-mini-pc)
- [Environment Variables Reference](#environment-variables-reference)
- [Database Migrations](#database-migrations)
- [SSL/TLS Setup](#ssltls-setup)
- [Monitoring (Sentry)](#monitoring-sentry)
- [Backup and Restore](#backup-and-restore)
- [Updating and Upgrading](#updating-and-upgrading)

---

## Prerequisites

| Component       | Cloud (Railway)           | Edge (Mini PC)                    |
|-----------------|---------------------------|-----------------------------------|
| Node.js         | >= 20.x (built in Docker) | >= 20.x (built in Docker)         |
| Docker          | N/A (Railway builds)      | Docker Engine + Compose plugin     |
| OS              | N/A (managed)             | Ubuntu 22.04 LTS / Debian 12      |
| Architecture    | N/A                       | x86_64                             |
| PostgreSQL      | 16 (Railway managed)      | 16 (Docker container)              |
| Redis           | 7 (Railway managed)       | 7 (Docker container)               |
| Disk Space      | N/A                       | 20 GB minimum                      |
| RAM             | N/A                       | 4 GB minimum, 8 GB recommended     |

---

## Cloud Deployment (Railway)

Railway hosts the cloud hub: API server, dashboard SPA, background worker, PostgreSQL, and Redis.

### Step 1 -- Create a Railway Project

1. Sign in to [Railway](https://railway.app) and create a new project.
2. Link the GitHub repository `bwattendorf/safeSchool`.
3. Add managed services: **PostgreSQL** and **Redis**.

### Step 2 -- Create Services

Create three services, each pointing to the same repo and root `Dockerfile`:

| Service     | BUILD_TARGET | Purpose                         |
|-------------|--------------|----------------------------------|
| api         | `api`        | Fastify API + WebSocket server   |
| dashboard   | `dashboard`  | React SPA (Vite build)           |
| worker      | `worker`     | BullMQ background job processor  |

### Step 3 -- Configure Build Variables

Set these variables **per service** in the Railway dashboard:

**All services:**
```
PORT=3000
NODE_ENV=production
```

**api service:**
```
BUILD_TARGET=api
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<generate-a-64-char-random-string>
AUTH_PROVIDER=dev          # or "clerk" for Clerk SSO
OPERATING_MODE=cloud
CORS_ORIGINS=https://dashboard-production-XXXX.up.railway.app
DISPATCH_ADAPTER=console   # or rapidsos, rave-911
ACCESS_CONTROL_ADAPTER=mock
NOTIFICATION_ADAPTER=console
```

**dashboard service:**
```
BUILD_TARGET=dashboard
VITE_API_URL=https://api-production-XXXX.up.railway.app
VITE_AUTH_PROVIDER=dev     # or "clerk"
```

**worker service:**
```
BUILD_TARGET=worker
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
DISPATCH_ADAPTER=console
ACCESS_CONTROL_ADAPTER=mock
NOTIFICATION_ADAPTER=console
```

### Step 4 -- Configure railway.toml

The shared `railway.toml` at repo root configures health checks:

```toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "always"
numReplicas = 1
```

### Step 5 -- Deploy

Push to `main` to trigger automatic deploys. Railway builds each service using the multi-target Dockerfile with the `BUILD_TARGET` argument.

The `start-api.sh` script runs on API startup and automatically:
1. Runs `prisma migrate deploy` (applies pending migrations).
2. Seeds the owner account (`admin@safeschool.example.com` / SITE_ADMIN).
3. Starts the Node.js server.

### Step 6 -- Verify

```bash
# Health check
curl https://api-production-XXXX.up.railway.app/health

# Readiness (confirms DB + Redis)
curl https://api-production-XXXX.up.railway.app/ready

# API docs
open https://api-production-XXXX.up.railway.app/docs
```

### Important: PORT Configuration

Railway routes traffic to the port from the Dockerfile `EXPOSE` directive, **not** the auto-injected `PORT` env var. Always set `PORT=3000` explicitly on each service to match `EXPOSE 3000`, or the proxy will return 502 errors.

---

## Edge Deployment (Mini PC)

The edge deployment runs all services locally on an on-site mini PC. It operates independently even without internet connectivity.

### Option A: Automated Setup (Recommended)

Run the setup script as root on a fresh Ubuntu 22.04 / Debian 12 machine:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/bwattendorf/safeSchool/main/deploy/edge/setup.sh)"
```

Or clone the repo first:

```bash
git clone https://github.com/bwattendorf/safeSchool.git /opt/safeschool
cd /opt/safeschool
sudo bash deploy/edge/setup.sh
```

The script performs these steps:
1. Installs Docker and Docker Compose plugin (if missing).
2. Clones or updates the repository to `/opt/safeschool`.
3. Generates `.env` with secure random secrets for `DB_PASSWORD` and `JWT_SECRET`.
4. Creates a systemd service (`safeschool.service`) for auto-start on boot.
5. Builds and starts all containers.

### Option B: Interactive Installer

For a guided setup with adapter selection prompts:

```bash
cd /opt/safeschool/deploy/edge
sudo bash install.sh
```

The interactive installer walks you through:
- Site name and ID configuration
- Cloud sync URL and key
- 911 dispatch adapter selection (console, RapidSOS, Rave 911, SIP, cellular)
- Access control adapter selection (mock, Sicunet, Genetec, Brivo, Verkada)
- Notification adapter selection (console, Twilio, SendGrid)

### Step 2 -- Configure Environment

Edit the `.env` file with your site-specific settings:

```bash
sudo nano /opt/safeschool/deploy/edge/.env
```

At minimum, configure:
- `SITE_ID` -- UUID for this school site (from cloud admin panel or auto-generated)
- `SITE_NAME` -- Human-readable school name
- `CLOUD_SYNC_URL` -- Cloud API URL (leave empty for standalone mode)
- `CLOUD_SYNC_KEY` -- Sync authentication key

### Step 3 -- Restart Services

```bash
sudo systemctl restart safeschool
```

### Step 4 -- Verify

After startup, services are available at:

| Service    | URL                            |
|------------|--------------------------------|
| Dashboard  | `https://<ip>:443`             |
| Kiosk      | `https://<ip>:8443`            |
| API        | `https://<ip>:3443`            |
| Admin      | `http://<ip>:9090`             |

Check service health:

```bash
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml ps
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml logs -f api
curl -k https://localhost:3443/health
```

### Edge Services Architecture

The edge Docker Compose stack includes:

| Container   | Image / Build          | Purpose                                |
|-------------|------------------------|----------------------------------------|
| api         | Custom (Dockerfile)    | Fastify API server (OPERATING_MODE=edge)|
| worker      | Custom (Dockerfile)    | BullMQ job processor                   |
| dashboard   | Custom (Dockerfile.dashboard) | React SPA for staff              |
| kiosk       | Custom (Dockerfile.kiosk) | Visitor check-in kiosk              |
| admin       | Custom (Dockerfile.admin) | Admin panel                          |
| caddy       | caddy:2-alpine         | Reverse proxy with auto-TLS            |
| postgres    | postgres:16-alpine     | Local database                         |
| redis       | redis:7-alpine         | Message queue and cache                |
| migrate     | Init container         | Applies Prisma migrations on start     |
| backup      | postgres:16-alpine     | Automated daily database backups       |
| watchtower  | containrrr/watchtower  | Auto-updates Docker images             |

---

## Environment Variables Reference

### Core

| Variable            | Required | Default   | Description                                    |
|---------------------|----------|-----------|------------------------------------------------|
| `NODE_ENV`          | Yes      | --        | `production` or `development`                  |
| `PORT`              | Yes      | `3000`    | Server listen port                             |
| `HOST`              | No       | `0.0.0.0` | Server bind address                            |
| `OPERATING_MODE`    | Yes      | `cloud`   | `cloud` or `edge`                              |
| `LOG_LEVEL`         | No       | `info`    | Pino log level (trace, debug, info, warn, error)|

### Database and Cache

| Variable            | Required | Default | Description                                      |
|---------------------|----------|---------|--------------------------------------------------|
| `DATABASE_URL`      | Yes      | --      | PostgreSQL connection string                     |
| `REDIS_URL`         | Yes      | --      | Redis connection string                          |
| `DB_PASSWORD`       | Edge     | --      | PostgreSQL password (edge .env only)             |

### Authentication

| Variable              | Required | Default | Description                                    |
|-----------------------|----------|---------|------------------------------------------------|
| `JWT_SECRET`          | Yes      | --      | Secret for signing JWT tokens                  |
| `AUTH_PROVIDER`       | No       | `dev`   | `dev` (JWT) or `clerk` (Clerk SSO)             |
| `CLERK_SECRET_KEY`    | Clerk    | --      | Clerk backend secret key                       |
| `CLERK_PUBLISHABLE_KEY`| Clerk   | --      | Clerk frontend publishable key                 |
| `CLERK_WEBHOOK_SECRET`| Clerk    | --      | Clerk webhook signing secret                   |

### Site Identity (Edge Only)

| Variable            | Required | Default | Description                                      |
|---------------------|----------|---------|--------------------------------------------------|
| `SITE_ID`           | Edge     | --      | UUID of this school site                         |
| `SITE_NAME`         | Edge     | --      | Human-readable site name                         |

### Cloud Sync (Edge Only)

| Variable            | Required | Default | Description                                      |
|---------------------|----------|---------|--------------------------------------------------|
| `CLOUD_SYNC_URL`    | No       | --      | Cloud API base URL for sync                      |
| `CLOUD_SYNC_KEY`    | No       | --      | Shared secret for edge-cloud sync auth           |

### 911 Dispatch

| Variable                  | Required     | Default   | Description                          |
|---------------------------|--------------|-----------|--------------------------------------|
| `DISPATCH_ADAPTER`        | No           | `console` | `console`, `rapidsos`, `rave-911`, `sip-direct`, `cellular` |
| `RAPIDSOS_CLIENT_ID`      | If rapidsos  | --        | RapidSOS OAuth client ID             |
| `RAPIDSOS_CLIENT_SECRET`  | If rapidsos  | --        | RapidSOS OAuth client secret         |
| `RAVE_API_KEY`            | If rave-911  | --        | Rave 911 Suite API key               |
| `RAVE_ORGANIZATION_ID`    | If rave-911  | --        | Rave organization identifier         |
| `SIP_TRUNK_HOST`          | If sip-direct| --        | SIP trunk server hostname            |
| `SIP_LOCAL_DOMAIN`        | If sip-direct| --        | Local SIP domain                     |
| `CELLULAR_DEVICE_PATH`    | If cellular  | --        | Modem device path (e.g., `/dev/ttyUSB0`) |

### Access Control

| Variable                    | Required  | Default | Description                            |
|-----------------------------|-----------|---------|----------------------------------------|
| `ACCESS_CONTROL_ADAPTER`    | No        | `mock`  | `mock`, `sicunet`, `genetec`, `brivo`, `verkada`, `lenel`, `openpath`, `hid-mercury` |
| `AC_API_URL`                | If real   | --      | Access control system API URL          |
| `AC_API_KEY`                | If real   | --      | Access control system API key          |

### Notifications

| Variable                | Required      | Default   | Description                          |
|-------------------------|---------------|-----------|--------------------------------------|
| `NOTIFICATION_ADAPTER`  | No            | `console` | `console`, `twilio`, `sendgrid`, `fcm`, `pa-intercom` |
| `TWILIO_ACCOUNT_SID`    | If twilio     | --        | Twilio account SID                   |
| `TWILIO_AUTH_TOKEN`      | If twilio     | --        | Twilio auth token                    |
| `TWILIO_FROM_NUMBER`    | If twilio     | --        | Twilio sender phone number           |
| `SENDGRID_API_KEY`      | If sendgrid   | --        | SendGrid API key                     |
| `SENDGRID_FROM_EMAIL`   | If sendgrid   | --        | SendGrid sender email                |
| `FCM_SERVICE_ACCOUNT_KEY`| If fcm       | --        | Firebase Cloud Messaging service key |

### Cameras

| Variable              | Required | Default | Description                                  |
|-----------------------|----------|---------|----------------------------------------------|
| `CAMERA_ADAPTER`      | No       | `none`  | `none`, `onvif`, `genetec-vms`               |
| `GENETEC_VMS_URL`     | If genetec| --     | Genetec VMS server URL                       |

### Threat Intelligence

| Variable                       | Required | Default | Description                        |
|--------------------------------|----------|---------|------------------------------------|
| `ZEROEYES_API_URL`             | No       | --      | ZeroEyes API endpoint              |
| `ZEROEYES_API_KEY`             | No       | --      | ZeroEyes API key                   |
| `ZEROEYES_WEBHOOK_SECRET`      | No       | --      | ZeroEyes webhook HMAC secret       |

### Visitor Management

| Variable                    | Required | Default   | Description                        |
|-----------------------------|----------|-----------|------------------------------------|
| `VISITOR_SCREENING_ADAPTER` | No       | `console` | Screening backend adapter          |

### Transportation

| Variable                     | Required | Default | Description                         |
|------------------------------|----------|---------|-------------------------------------|
| `TRANSPORT_TRACKING_ENABLED` | No       | `false` | Enable GPS/RFID bus tracking        |

### Monitoring

| Variable                      | Required | Default | Description                        |
|-------------------------------|----------|---------|------------------------------------|
| `SENTRY_DSN`                  | No       | --      | Sentry DSN for error tracking      |
| `SENTRY_TRACES_SAMPLE_RATE`   | No       | `0.1`   | Sentry performance sampling rate   |

### CORS

| Variable        | Required | Default             | Description                           |
|-----------------|----------|---------------------|---------------------------------------|
| `CORS_ORIGINS`  | Prod     | Block all in prod   | Comma-separated allowed origins       |
| `API_BASE_URL`  | No       | `http://localhost:PORT` | Public API URL for OpenAPI docs   |

### SSL/TLS (Edge Only)

| Variable       | Required | Default    | Description                                      |
|----------------|----------|------------|--------------------------------------------------|
| `EDGE_DOMAIN`  | No       | (empty)    | FQDN for Let's Encrypt. Empty = self-signed.     |
| `EDGE_TLS`     | No       | `internal` | `internal` for self-signed. Empty for Let's Encrypt. |

### Auto-Update (Edge Only)

| Variable                      | Required | Default | Description                          |
|-------------------------------|----------|---------|--------------------------------------|
| `WATCHTOWER_POLL_INTERVAL`    | No       | `3600`  | Seconds between update checks        |
| `WATCHTOWER_CLEANUP`          | No       | `true`  | Remove old images after update       |
| `WATCHTOWER_NOTIFICATION_URL` | No       | --      | Shoutrrr URL for update notifications|

---

## Database Migrations

SafeSchool uses Prisma for database schema management.

### Applying Migrations

**Cloud (Railway):** Migrations run automatically on API startup via `start-api.sh`:
```bash
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

**Edge:** The `migrate` init container runs before the API starts:
```yaml
command: npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

### Creating New Migrations (Development)

```bash
# From repo root
cd packages/db
npx prisma migrate dev --name describe_your_change
```

### Resetting the Database (Development Only)

```bash
npx prisma migrate reset --schema=packages/db/prisma/schema.prisma
```

---

## SSL/TLS Setup

The edge deployment uses [Caddy](https://caddyserver.com) as a reverse proxy with automatic TLS.

### Self-Signed Certificates (Default)

When `EDGE_DOMAIN` is empty, Caddy generates self-signed certificates using its internal CA. This is suitable for LAN-only access. Browsers will show a certificate warning.

```env
EDGE_DOMAIN=
EDGE_TLS=internal
```

Services are accessible via:
- Dashboard: `https://<ip>:443`
- Kiosk: `https://<ip>:8443`
- API: `https://<ip>:3443`

### Let's Encrypt Certificates (Public Domain)

If the mini PC has a public DNS record, Caddy will automatically provision and renew Let's Encrypt certificates:

```env
EDGE_DOMAIN=edge.myschool.org
EDGE_TLS=
```

Requirements:
- Port 80 and 443 must be reachable from the internet (for ACME HTTP challenge).
- DNS A record pointing `edge.myschool.org` to the mini PC's public IP.

### Security Headers

Caddy automatically applies these security headers to all responses:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## Monitoring (Sentry)

SafeSchool integrates with [Sentry](https://sentry.io) for error tracking and performance monitoring.

### Setup

1. Create a Sentry project (Node.js).
2. Set the environment variables:

```env
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_TRACES_SAMPLE_RATE=0.1
```

3. Redeploy. The Sentry plugin registers automatically on API startup.

### What Gets Tracked

- Unhandled exceptions in API routes
- Background worker job failures
- Slow database queries (via performance tracing)
- HTTP 5xx responses

### Health Endpoints

| Endpoint  | Purpose                                   | Auth Required |
|-----------|-------------------------------------------|---------------|
| `/health` | Basic liveness check (returns `{status: "ok"}`) | No    |
| `/ready`  | Readiness check (confirms DB + Redis connectivity) | No  |

---

## Backup and Restore

### Automated Backups (Edge)

The edge Docker Compose stack includes a `backup` container that runs `pg_dump` daily at 02:00 UTC.

- **Daily backups:** Keeps the last 7 days in `/backups/daily/`
- **Weekly backups:** Copies to `/backups/weekly/` on Sundays (keeps 4)
- **Format:** PostgreSQL custom format with compression level 6

Backups are stored in the `backup_data` Docker volume.

### Manual Backup

```bash
sudo bash /opt/safeschool/deploy/edge/backup.sh
```

### Optional S3 Upload

Set these environment variables to automatically upload backups to S3:

```env
AWS_BACKUP_BUCKET=my-school-backups
AWS_BACKUP_PREFIX=safeschool/edge
```

Requires the AWS CLI to be installed on the host.

### Restore from Backup

```bash
# List available backups
sudo bash /opt/safeschool/deploy/edge/restore.sh

# Restore a specific backup
sudo bash /opt/safeschool/deploy/edge/restore.sh safeschool_20260209T020000Z.sql.gz
```

The restore script:
1. Creates a pre-restore safety backup of the current database.
2. Stops API and worker containers to drain connections.
3. Drops and recreates the `safeschool` database.
4. Restores from the backup file using `pg_restore`.
5. Restarts API and worker containers.
6. Waits up to 90 seconds for the API health check to pass.
7. Reports the number of restored tables.

If the restore fails, the script attempts to roll back using the pre-restore backup.

### Cloud Backups (Railway)

Railway's managed PostgreSQL includes automatic daily backups. For additional protection:

```bash
# Manual backup via Railway CLI
railway run pg_dump --format=custom --compress=6 > backup.sql.gz
```

---

## Updating and Upgrading

### Cloud (Railway)

Push to the `main` branch. Railway automatically rebuilds and redeploys all services. Migrations run on API startup.

### Edge -- Automated (Watchtower)

The `watchtower` container polls for new Docker images every hour (configurable via `WATCHTOWER_POLL_INTERVAL`). When updates are detected, it pulls new images and restarts containers.

### Edge -- Manual Update

```bash
sudo bash /opt/safeschool/deploy/edge/update.sh
```

The update script:
1. Fetches the latest code from `origin/main`.
2. Compares local and remote commit hashes; exits if already up to date.
3. Pulls the latest code with `git pull --ff-only`.
4. Runs database migrations via the `migrate` container.
5. Rebuilds and restarts all services.
6. Waits for health checks to pass.
7. Prunes old Docker images.
8. Logs all output to `/var/log/safeschool-update.log`.

### Systemd Management (Edge)

```bash
# Start
sudo systemctl start safeschool

# Stop
sudo systemctl stop safeschool

# Restart
sudo systemctl restart safeschool

# View status
sudo systemctl status safeschool

# View logs
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml logs -f
```

### Rollback

If an update causes problems:

```bash
cd /opt/safeschool
sudo git log --oneline -5              # Find the last good commit
sudo git checkout <commit-hash>        # Switch to that commit
sudo docker compose -f deploy/edge/docker-compose.yml up -d --build
```
