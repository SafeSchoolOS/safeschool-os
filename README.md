# SafeSchool OS

**Open-Source School Safety Platform | Alyssa's Law Compliant | Redundant by Design**

SafeSchool OS is a free, open-source school safety management platform that integrates panic alarms, lockdown control, 911 dispatch, visitor management, threat analysis, transportation tracking, and mass notification into a single command center. Built to comply with Alyssa's Law and the PASS (Partner Alliance for Safer Schools) Guidelines.

---

## Free & Open Source

SafeSchool OS is **free to use, deploy, and modify** under the [AGPL-3.0 license](LICENSE). Every school deserves access to modern safety technology regardless of budget.

### Business Model

| | Community (Free) | Supported (Paid) |
|---|---|---|
| **Full platform** | Included | Included |
| **All integrations** | Included | Included |
| **Self-hosted deployment** | Included | Included |
| **Community support** | GitHub Issues & Discussions | Priority email & phone |
| **Implementation assistance** | Self-service docs | Dedicated onboarding engineer |
| **Custom integrations** | DIY via adapter pattern | Built by our team |
| **SLA** | Best effort | 99.9% uptime guarantee |
| **Training** | Documentation & videos | On-site & virtual training sessions |
| **Compliance consulting** | Guides included | Alyssa's Law compliance audit & certification |
| **Grant writing support** | Grant finder tool | Assistance with SVPP, COPS, BSCA applications |
| **Hardware provisioning** | BYO hardware | Pre-configured edge devices, shipped ready |

**Our philosophy**: The software that keeps kids safe should never be locked behind a paywall. We charge for the expertise, support, and services that help schools deploy it successfully — not for the software itself.

For support plans and pricing, contact **sales@safeschoolos.com**.

---

## Architecture: Redundancy First

SafeSchool is designed to **never be a single point of failure**:

```
                    +------------------+
                    |   Cloud Server   |
                    |   (Primary Hub)  |
                    +--------+---------+
                             |
                    Encrypted Sync (WebSocket + REST)
                             |
                    +--------+---------+
                    |  On-Site Mini PC  |
                    | (Local Failover)  |
                    +--------+---------+
                             |
          +------------------+------------------+
          |                  |                  |
    +-----------+     +-----------+     +-----------+
    |  Wearable |     |  Access   |     |  Visitor  |
    |  Panic    |     |  Control  |     |  Check-in |
    |  Devices  |     |  Systems  |     |  Kiosk    |
    +-----------+     +-----------+     +-----------+
```

- **Cloud Server**: Primary management dashboard, alerting engine, data storage, remote management
- **On-Site Mini PC**: Local fallback that operates independently if internet goes down; handles direct 911 integration, local access control, and real-time device communication
- **Dual-Path 911**: Both cloud and on-site can independently trigger 911 dispatch
- **Cellular Failover**: On-site unit has cellular modem backup if school network goes down

---

## Alyssa's Law Compliance

Named after Alyssa Alhadeff, killed in the 2018 Parkland school shooting. Enacted in NJ, FL, NY, TX, OK, TN, VA, AZ, NC and expanding.

| Requirement | How SafeSchool Meets It |
|---|---|
| Silent panic alarm | Wearable devices + app-based panic buttons with no audible alarm |
| Direct law enforcement notification | Dual-path 911/PSAP integration via RapidSOS & Rave |
| Location data | Room-level accuracy via BLE mesh + GPS |
| Immediate activation | Single-button press on wearable or 2-tap on mobile app |
| Redundancy | Cloud + on-site + cellular failover |
| Regular testing | Built-in drill management and compliance reporting |

### Standards Compliance
- **UL 636** — Holdup Alarm Units and Systems
- **NFPA 3000** — Active Shooter/Hostile Event Response
- **NFPA 72 Ch.24** — Emergency Communications Systems
- **NENA i3** — Next Generation 911 interoperability
- **PASS Guidelines** — Tiers 1-4 school security
- **FERPA** — Student data privacy

---

## Platform Modules

### Panic Alert Engine
Receives panic signals from wearables, mobile apps, and fixed stations. Configurable alert levels (Medical, Lockdown, Active Threat, All-Clear) with auto-escalation and room-level location tracking.

### 911 Dispatch Integration
Dual-path redundant dispatch with automatic failover chain: RapidSOS, Rave 911 Suite, SIP direct dial, and cellular backup. Pushes floor plans, camera feeds, and entry points to responding officers.

### Access Control & Lockdown
One-button building-wide or zone-based lockdown. Integrates with 10+ access control systems:

| System | Integration | Priority |
|---|---|---|
| **Sicunet** | Native REST + WebSocket | Primary |
| Genetec Security Center | WebSDK | Tier 1 |
| LenelS2 OnGuard | OpenAccess API | Tier 1 |
| Brivo | OAuth2 Cloud API | Tier 1 |
| Verkada | REST API | Tier 1 |
| Openpath (Motorola) | REST API | Tier 2 |
| HID Mercury | OAuth2 + OSDP | Tier 2 |
| Allegion (Schlage) | ENGAGE API | Tier 2 |
| ASSA ABLOY (Aperio) | Integration Hub | Tier 2 |

### Visitor Management
Self-service kiosk with ID scanning, real-time sex offender database (NSOPW) screening, custom watchlists, pre-registration, and contractor management. Raptor Technologies API supported for existing deployments.

### Threat Analysis & Intelligence
- **AI weapon detection** — ZeroEyes, Omnilert (camera-based)
- **Gunshot detection** — SoundThinking (formerly ShotSpotter)
- **Behavioral threat assessment** — CSTAG-based scoring, Navigate360 integration
- **Social media monitoring** — Bark for Schools, Gaggle
- **Anonymous tip line** — Built-in submission portal with admin review

### Mass Notification
Multi-channel alerts: SMS (Twilio), email (SendGrid), push notifications (FCM), PA/intercom integration, and 20+ configurable notification templates.

### Video Surveillance
ONVIF-compatible camera discovery, VMS integration (Genetec, Milestone, Avigilon, Verkada), live feed sharing to first responders during incidents.

### Emergency Operations & Reunification
Drill management with Alyssa's Law compliance tracking, parent-student reunification with barcode check-in, staging area management, and after-action reporting.

### Environmental Monitoring
Sensor integration for air quality, temperature, and hazardous conditions with configurable alert thresholds.

### Student Transportation
Real-time bus GPS tracking, RFID student scanning, geofence-based route monitoring, and automated parent notifications (boarding, arrival, delays, missed bus alerts).

### Grant & Funding Finder
Searchable database of federal, state, and private school safety grants (SVPP, COPS, BSCA, E-Rate, FEMA, state-specific programs) with eligibility matching and application tracking.

---

## Tech Stack

| Component | Technology |
|---|---|
| **Backend API** | TypeScript, Fastify 5, BullMQ workers |
| **Real-time** | WebSocket for live alerts |
| **Database** | PostgreSQL 16 + Redis 7 |
| **Dashboard** | React 19, Vite 6, TailwindCSS 4, React Query |
| **Mobile App** | Expo SDK 54 (React Native) |
| **Kiosk App** | React 19, Vite 6 |
| **Auth** | Clerk SSO (production) / JWT (development) |
| **Monorepo** | Turborepo with npm workspaces |
| **Cloud Hosting** | Railway (or any Docker host) |
| **Edge Runtime** | Docker on Ubuntu (Mini PC) |
| **CI/CD** | GitHub Actions |

---

## Project Structure

```
safeschool/
├── apps/
│   ├── dashboard/          # React web dashboard (command center)
│   ├── mobile/             # Expo mobile app (panic button + alerts)
│   └── kiosk/              # Visitor check-in kiosk
├── packages/
│   ├── core/               # Shared types, utilities, notification templates
│   ├── api/                # Fastify REST API + WebSocket + RBAC middleware
│   ├── db/                 # Prisma schema, migrations, seed data
│   ├── integrations/
│   │   ├── access-control/ # Sicunet, Genetec, LenelS2, Brivo, Verkada, etc.
│   │   ├── dispatch/       # RapidSOS, Rave 911, SIP, cellular failover
│   │   ├── cameras/        # ONVIF, Genetec VMS, Milestone, Avigilon
│   │   ├── notifications/  # Twilio, SendGrid, FCM, PA/intercom
│   │   ├── threat-intel/   # ZeroEyes, weapon detection
│   │   ├── threat-assessment/ # CSTAG scoring, Navigate360
│   │   ├── social-media/   # Bark, Gaggle monitoring
│   │   ├── visitor-mgmt/   # Visitor screening, Raptor
│   │   ├── panic-devices/  # Centegix, Rave Panic Button
│   │   ├── gunshot-detection/ # SoundThinking
│   │   └── environmental/  # Sensor monitoring
│   └── edge/               # On-site sync engine, offline queue, conflict resolver
├── deploy/
│   ├── railway/            # Cloud deployment (start-api.sh, railway.toml)
│   ├── edge/               # On-site Docker Compose + setup scripts
│   └── docker/             # Dockerfiles for all services
├── docs/                   # Admin guide, deployment guide, architecture
├── test/load/              # k6 load testing scripts
└── .github/workflows/      # CI/CD pipelines
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16+
- Redis 7+

### Local Development

```bash
# Clone the repo
git clone https://github.com/your-org/safeschool.git
cd safeschool

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate --schema=packages/db/prisma/schema.prisma

# Start database and Redis
docker compose up -d postgres redis

# Push schema and seed data
npx prisma db push --schema=packages/db/prisma/schema.prisma
npx tsx packages/db/src/seed.ts

# Start API and dashboard in development mode
npm run dev --workspace=@safeschool/api &
npm run dev --workspace=@safeschool/dashboard
```

The dashboard will be available at `http://localhost:5173`. Log in with `admin@lincoln.edu` / `safeschool123`.

### On-Site Edge Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full instructions on deploying the on-site mini PC with Docker Compose, cellular failover, and auto-updates.

### Recommended Edge Hardware

| Option | Model | Why |
|---|---|---|
| **Recommended** | Intel NUC 13 Pro (i7, 32GB, 512GB SSD) | vPro remote management, small form factor |
| Budget | Beelink SER7 (Ryzen 7, 32GB, 500GB SSD) | Great performance/price ratio |
| Enterprise | Lenovo ThinkCentre M90q Tiny | Enterprise support, vPro |
| Rugged | OnLogic Helix 600 (fanless) | No moving parts, 24/7 rated |

Plus a UPS battery backup and cellular failover modem.

---

## PASS Tier Alignment

| Tier | Description | SafeSchool Coverage |
|---|---|---|
| **Tier 1** | Minimum recommended | Panic alerts, basic access control, visitor management |
| **Tier 2** | Enhanced | + Camera integration, mass notification, lockdown |
| **Tier 3** | Comprehensive | + Threat analysis, weapon detection, reunification |
| **Tier 4** | Highest level | + AI analytics, gunshot detection, full interoperability |

---

## Contributing

This is a safety-critical system. All contributions must include tests and undergo security review. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key principles:
- Adapter pattern for all integrations — never vendor-lock
- Redundancy at every layer — no single points of failure
- Privacy by default — FERPA compliant, minimal data collection
- Test coverage required for all safety-critical paths

---

## License

SafeSchool OS is licensed under the [GNU Affero General Public License v3.0](LICENSE). This means you can freely use, modify, and deploy it — but if you distribute a modified version or run it as a network service, you must make your source code available under the same license.

---

## Contact

| | |
|---|---|
| **General** | info@safeschoolos.com |
| **Sales & Pricing** | sales@safeschoolos.com |
| **Support** | support@safeschoolos.com |
| **Security Vulnerabilities** | security@safeschoolos.com (see [SECURITY.md](SECURITY.md)) |
| **Website** | [safeschoolos.com](https://safeschoolos.com) |

---

*Built with the goal of making every school safer. In memory of Alyssa Alhadeff and all victims of school violence.*
