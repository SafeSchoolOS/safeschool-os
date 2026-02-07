# SafeSchool - Comprehensive School Safety Platform

**Alyssa's Law Compliant | Open Architecture | Redundant by Design**

SafeSchool is an open-source school safety management platform designed to comply with Alyssa's Law and the Partner Alliance for Safer Schools (PASS) guidelines. It provides a unified command center that integrates panic alarms, access control lockdown, 911 dispatch, visitor management, threat analysis, and mass notification into a single platform.

## Architecture: Redundancy First

SafeSchool is designed to **never be a single point of failure**:

```
                    +------------------+
                    |   Railway Cloud  |
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
    |  Wearable |     |  Access   |     |   Badge   |
    |  Panic    |     |  Control  |     |   Kiosk   |
    |  Devices  |     |  Systems  |     |  Visitor  |
    +-----------+     +-----------+     +-----------+
```

- **Railway Cloud**: Primary management dashboard, alerting engine, data storage, remote management
- **On-Site Mini PC**: Local fallback that operates independently if internet goes down; handles direct 911 integration, local access control, and real-time device communication
- **Dual-Path 911**: Both cloud and on-site can independently trigger 911 dispatch
- **Cellular Failover**: On-site unit has cellular modem backup if school network goes down

---

## Alyssa's Law Compliance

Named after Alyssa Alhadeff, killed in the 2018 Parkland school shooting. Enacted in NJ, FL, NY, TX and expanding. Core requirements this platform meets:

| Requirement | How SafeSchool Meets It |
|---|---|
| Silent panic alarm | Wearable devices + app-based panic buttons with no audible alarm |
| Direct law enforcement notification | Dual-path 911/PSAP integration via RapidSOS/Rave |
| Location data | Room-level accuracy via BLE mesh + GPS |
| Immediate activation | Single-button press on wearable or 2-tap on mobile app |
| Redundancy | Cloud + on-site + cellular failover |
| Regular testing | Built-in drill management and compliance reporting |

### Standards Compliance
- **UL 636** - Holdup Alarm Units and Systems
- **NFPA 3000** - Active Shooter/Hostile Event Response
- **NFPA 72 Ch.24** - Emergency Communications Systems
- **NENA i3** - Next Generation 911 interoperability
- **PASS Guidelines** - Tiers 1-4 school security

---

## System Modules

### 1. Panic Alert Engine (Core)
The heart of the system. Receives panic signals and orchestrates the response.

- **Wearable device integration** (Centegix CrisisAlert, custom BLE devices)
- **Mobile app panic button** (iOS/Android)
- **Fixed wall-mount panic stations**
- **Configurable alert levels**: Medical, Lockdown, Active Threat, All-Clear
- **Auto-escalation**: If no acknowledgment in X seconds, escalate to next tier
- **Location tracking**: Room-level via BLE beacons, floor/building via GPS

### 2. 911 / Law Enforcement Dispatch Integration
Dual-path redundant emergency dispatch.

- **RapidSOS integration** - Direct data push to 911 PSAPs (location, floor plans, caller info)
- **Rave 911 Suite (Motorola)** - Panic button to PSAP integration
- **SIP/VoIP direct dial** - Backup direct 911 call capability
- **Cellular backup** - Independent cellular 911 path from on-site unit
- **CAP (Common Alerting Protocol)** - Standard emergency alert formatting
- **First responder data push** - Automatic floor plans, camera feeds, entry points to responding officers

### 3. Access Control & Lockdown
Instant building-wide or zone-based lockdown.

**Supported Access Control Systems:**
| System | Integration Method | Lockdown Capable | Priority |
|---|---|---|---|
| **Sicunet** | REST API / Native | Yes | **Primary** |
| Genetec Security Center | REST API | Yes | Tier 1 |
| LenelS2 OnGuard | OpenAccess API | Yes | Tier 1 |
| Brivo | Cloud API | Yes | Tier 1 |
| Verkada | REST API | Yes | Tier 1 |
| Openpath (Motorola) | REST API | Yes | Tier 2 |
| Honeywell Pro-Watch | SDK/API | Yes | Tier 2 |
| HID Mercury controllers | OSDP Protocol | Yes | Tier 2 |
| Allegion Schlage | ENGAGE API | Yes | Tier 2 |
| ASSA ABLOY Aperio | Integration Hub | Yes | Tier 2 |

> **Sicunet is our primary access control integration** - built with deep native support. SafeSchool team members work directly with Sicunet, enabling the tightest possible integration for lockdown, door monitoring, and credential management.

**Lockdown Features:**
- One-button full building lockdown
- Zone-based lockdown (lock specific wings/floors)
- Automatic lockdown on active threat alert
- Safe passage corridors for evacuation
- Door status monitoring (open/closed/locked/forced)
- Automatic unlock for fire alarm integration

### 4. Visitor Management & Badge Kiosk
Integrated visitor screening and badging system.

- **Self-service kiosk** (tablet-based or dedicated hardware)
- **ID scanning** - Driver's license OCR and barcode scanning
- **Sex offender database screening** - Real-time NSOPW check
- **Custom watchlist** - School-specific banned visitor list
- **Photo badge printing** - Thermal badge with photo, name, destination, expiry
- **Pre-registration** - Parents/visitors can pre-register online
- **Contractor management** - Recurring visitor profiles
- **Integration with SIS** - Verify parent/guardian relationships
- **Raptor Technologies API** - For schools already using Raptor

### 5. Threat Analysis & Intelligence
Proactive threat detection and assessment.

- **AccessIQ integration** - Security threat analysis
- **AI weapon detection** - Integration with ZeroEyes, Omnilert (camera-based gun detection)
- **Gunshot detection** - SoundThinking (formerly ShotSpotter) integration
- **Behavioral threat assessment** - Navigate360 workflow integration
- **Social media monitoring** - Bark for Schools, Social Sentinel feeds
- **Anonymous tip line** - Built-in tip submission portal (Sandy Hook Promise compatible)
- **Threat scoring dashboard** - Aggregated threat level from all sources

### 6. Mass Notification
Multi-channel emergency communications.

- **PA/Intercom integration** - Automated announcements via existing PA
- **SMS/Email blast** - Mass text and email to staff, parents, district
- **Mobile app push notifications** - Real-time alerts to SafeSchool app
- **Digital signage** - Push lockdown/evacuation instructions to hallway displays
- **Desktop alerts** - Pop-up notifications on school computers
- **Social media** - Automated posts to school social accounts
- **Outdoor speakers** - Integration with outdoor notification systems
- **NOAA weather alerts** - Automatic severe weather notifications

### 7. Video Surveillance Integration
Camera system integration for situational awareness.

- **ONVIF compatible** - Works with any ONVIF-compliant camera
- **VMS integration** - Genetec, Milestone, Avigilon, Verkada
- **AI analytics** - License plate recognition (LPR), person tracking
- **Live feed sharing** - Stream camera feeds to first responders during incidents
- **Automatic recording** - Trigger recording on panic alarm activation
- **Camera health monitoring** - Alert on camera offline/tampered

### 8. Emergency Operations & Reunification
Structured emergency response management.

- **Emergency Operations Plans (EOP)** - Digital EOP with role assignments
- **Drill management** - Schedule, track, and report on safety drills
- **Reunification** - Parent-student reunification tracking after evacuation
- **Staging area management** - Digital check-in for evacuees
- **After-action reporting** - Automated incident timeline and report generation
- **Compliance dashboard** - State reporting requirements tracking

### 9. Environmental Monitoring
Integration with building systems.

- **Fire alarm integration** - Auto-unlock on fire alarm, coordinate with lockdown
- **Weather alerts** - NOAA integration for tornado/severe weather shelter-in-place
- **Air quality sensors** - Hazmat/air quality monitoring
- **AED location tracking** - Map of all AED devices
- **Medical emergency protocols** - Allergy alerts, student medical info for first responders

### 10. Student Transportation & Tracking
Complete student transportation safety with real-time parent notifications.

- **GPS tracking** - Real-time bus location on map
- **Driver panic button** - Alert from bus to command center
- **Student ridership tracking** - RFID/NFC reader on bus scans student ID on board/exit
- **Parent notifications** - Automated SMS/email when:
  - Student boards the bus (with bus number and route)
  - Bus is approaching their stop (ETA notification)
  - Student exits the bus at school
  - Student exits the bus at their home stop
  - Bus is running late (delay notification with new ETA)
  - Student did NOT board expected bus (missed bus alert)
- **Route geofencing** - Alert on route deviation or unexpected stops
- **Attendance integration** - Bus scan counts as "present" in SIS
- **Historical tracking** - Full ridership history for safety audits
- **Multi-modal** - Supports bus, van, parent pickup, walker tracking

### 11. Grant & Funding Management
Built-in tools to find, apply for, and track school safety funding.

- **Grant finder** - Searchable database of federal, state, and private grants
- **Eligibility checker** - Match your school/district profile to eligible grants
- **Application tracker** - Track deadlines, submissions, and award status
- **Budget planning** - Map SafeSchool modules to fundable line items
- **Compliance reporting** - Auto-generate grant compliance reports
- **Funding sources tracked**:
  - STOP School Violence Prevention Program (DOJ/BJA)
  - COPS School Violence Prevention Program
  - Bipartisan Safer Communities Act
  - State-specific school safety grants (NJ, FL, NY, TX, CA, etc.)
  - E-Rate (network infrastructure)
  - FEMA Preparedness Grants
  - Private foundations (Sandy Hook Promise, etc.)
- **ROI calculator** - Show cost savings and safety improvements for grant justification

---

## Tech Stack

| Component | Technology |
|---|---|
| **Backend API** | Node.js / TypeScript with Fastify |
| **Real-time Engine** | WebSocket (Socket.io) for live alerts |
| **Database** | PostgreSQL (primary) + Redis (cache/pubsub) |
| **Frontend Dashboard** | React + TypeScript + Tailwind CSS |
| **Mobile App** | React Native (iOS + Android) |
| **Cloud Hosting** | Railway.app |
| **On-Site Runtime** | Docker on Ubuntu Server (Mini PC) |
| **Integration Bus** | Event-driven message queue (BullMQ/Redis) |
| **Authentication** | Auth0 / Clerk (RBAC - Admin, Operator, Teacher, First Responder) |
| **Mapping** | Leaflet.js with custom floor plan overlays |
| **Notifications** | Twilio (SMS), SendGrid (Email), FCM (Push) |

---

## On-Site Mini PC Recommendations

For the local redundant server at each school site:

| Option | Model | Specs | Why |
|---|---|---|---|
| **Recommended** | Intel NUC 13 Pro | i7, 32GB RAM, 512GB SSD | Reliable, vPro remote management, small form factor |
| Budget | Beelink SER7 | Ryzen 7, 32GB RAM, 500GB SSD | Great performance/price ratio |
| Enterprise | Lenovo ThinkCentre M90q Tiny | i7, 32GB RAM, 512GB SSD | Enterprise support, vPro |
| Rugged | OnLogic Helix 600 | Fanless, industrial, 24/7 rated | No moving parts, ideal for server closet |

**Required Accessories:**
- UPS battery backup (CyberPower CP1500AVRLCD or APC BR1500MS2)
- Cellular failover modem (Cradlepoint IBR600C or Peplink MAX BR1 Mini)
- Ethernet connection to school network

---

## Wearable Panic Devices - Recommendations

| Device | Type | Location Accuracy | Battery | API | Price Range |
|---|---|---|---|---|---|
| **Centegix CrisisAlert** | Badge/lanyard | Room-level (BLE mesh) | 1+ year | Proprietary, webhook-capable | $$/user/year |
| Rave Panic Button (Motorola) | Mobile app | GPS | N/A (phone) | REST API | $/user/year |
| ASR Alert Systems | App + hardware | GPS + BLE | 1+ year | REST API | $$/user/year |
| Custom BLE Beacon Badge | DIY hardware | Room-level | 6-12 months | Open/custom | $ (hardware only) |

**Recommendation**: Start with **Centegix CrisisAlert** for its room-level accuracy and proven Alyssa's Law compliance, with the mobile app as a backup/supplement.

---

## Project Structure

```
safeschool/
├── apps/
│   ├── dashboard/          # React web dashboard (command center)
│   ├── mobile/             # React Native mobile app (panic button + alerts)
│   └── kiosk/              # Visitor badge kiosk application
├── packages/
│   ├── core/               # Shared business logic, types, utilities
│   ├── api/                # Fastify REST API + WebSocket server
│   ├── db/                 # Database schemas, migrations (Prisma/Drizzle)
│   ├── integrations/       # Third-party integration adapters
│   │   ├── access-control/ # Sicunet (primary), Genetec, LenelS2, Brivo, Verkada
│   │   ├── dispatch/       # RapidSOS, Rave 911, SIP/911
│   │   ├── cameras/        # ONVIF, VMS integrations
│   │   ├── notifications/  # Twilio, SendGrid, FCM, PA system
│   │   ├── threat-intel/   # ZeroEyes, Bark, Navigate360
│   │   ├── visitor-mgmt/   # Raptor, ID scanning, badge printing
│   │   ├── transportation/ # Bus GPS, student RFID tracking, parent alerts
│   │   ├── grants/         # Grant finder, eligibility, application tracking
│   │   └── environmental/  # Fire alarm, NOAA, sensors
│   └── edge/               # On-site mini PC runtime & sync engine
├── deploy/
│   ├── railway/            # Railway deployment configs
│   ├── docker/             # Docker Compose for on-site mini PC
│   └── scripts/            # Setup and maintenance scripts
├── docs/
│   ├── architecture/       # System architecture documentation
│   ├── compliance/         # Alyssa's Law & PASS compliance docs
│   ├── integrations/       # Integration guides per vendor
│   └── deployment/         # Deployment guides
├── .github/
│   └── workflows/          # CI/CD pipelines
├── package.json
├── turbo.json              # Turborepo monorepo config
├── railway.toml            # Railway project config
└── docker-compose.yml      # On-site deployment
```

---

## PASS (Partner Alliance for Safer Schools) Tier Alignment

SafeSchool is designed to support all 4 PASS tiers:

| Tier | Description | SafeSchool Coverage |
|---|---|---|
| **Tier 1** | Minimum recommended | Panic alerts, basic access control, visitor management |
| **Tier 2** | Enhanced | + Camera integration, mass notification, lockdown |
| **Tier 3** | Comprehensive | + Threat analysis, weapon detection, reunification |
| **Tier 4** | Highest level | + AI analytics, gunshot detection, full interoperability |

---

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16+
- Redis 7+

### Cloud Deployment (Railway)
```bash
# Clone the repo
git clone https://github.com/bwattendorf/safeschool.git
cd safeschool

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Deploy to Railway
railway up
```

### On-Site Mini PC Deployment
```bash
# On the mini PC (Ubuntu Server)
git clone https://github.com/bwattendorf/safeschool.git
cd safeschool/deploy/docker
docker compose up -d
```

---

## Roadmap

### Phase 1 - Foundation (MVP)
- [ ] Core API with authentication and RBAC
- [ ] Web dashboard (command center)
- [ ] Panic alert engine (receive, process, escalate)
- [ ] **Sicunet access control integration** (primary, native)
- [ ] 911 dispatch integration (RapidSOS)
- [ ] Railway deployment
- [ ] On-site Docker deployment with sync engine
- [ ] Grant & funding finder (help schools fund the system)

### Phase 2 - Visitor, Transportation & Notification
- [ ] Visitor management badge kiosk
- [ ] ID scanning and sex offender screening
- [ ] Mass notification (SMS, email, push)
- [ ] PA/intercom integration
- [ ] Mobile app (iOS/Android)
- [ ] **Student bus tracking with RFID readers**
- [ ] **Parent notification system** (board/exit/ETA/delay/missed bus alerts)
- [ ] Additional access control adapters (Genetec, Brivo, Verkada)

### Phase 3 - Intelligence & Video
- [ ] Camera/VMS integration (ONVIF)
- [ ] AI weapon detection (ZeroEyes/Omnilert)
- [ ] Anonymous tip line portal
- [ ] Behavioral threat assessment workflow
- [ ] Social media monitoring integration
- [ ] Grant application tracker and compliance reporting

### Phase 4 - Full Platform
- [ ] Reunification module
- [ ] Drill management and compliance reporting
- [ ] Environmental monitoring (fire, weather, air quality)
- [ ] First responder data sharing portal
- [ ] LPR (license plate recognition)
- [ ] Walk-through weapons detection (Evolv, CEIA)
- [ ] Additional access control integrations (LenelS2, Openpath, HID, Allegion, ASSA ABLOY)

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

This is a safety-critical system. All contributions must include tests and undergo security review. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

*Built with the goal of making every school safer. In memory of Alyssa Alhadeff and all victims of school violence.*
