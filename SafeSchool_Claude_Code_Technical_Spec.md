# SafeSchool Foundation — Technical Specification & Architecture Document

## For: Claude Code Development Reference

**Version:** 1.0
**Date:** February 2026
**Author:** Bruce (Executive Director, SafeSchool Foundation)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Organizational Structure](#2-organizational-structure)
3. [Platform Architecture](#3-platform-architecture)
4. [Website Requirements](#4-website-requirements)
5. [Core Platform (Open Source)](#5-core-platform-open-source)
6. [Certification System](#6-certification-system)
7. [Commercial Integrations](#7-commercial-integrations)
8. [Support System](#8-support-system)
9. [Installer Training Portal](#9-installer-training-portal)
10. [Infrastructure & Deployment](#10-infrastructure--deployment)
11. [API Design](#11-api-design)
12. [Database Schema](#12-database-schema)
13. [BLE Mesh Network Protocol](#13-ble-mesh-network-protocol)
14. [Alyssa's Law Compliance](#14-alyssas-law-compliance)
15. [Security Requirements](#15-security-requirements)
16. [Branding & Design System](#16-branding--design-system)
17. [Business Context](#17-business-context)
18. [QA Automation Bot System (Claude Code)](#18-qa-automation-bot-system-claude-code)
19. [Potential Sponsorships & Partnerships](#19-potential-sponsorships--partnerships)
20. [Development Priorities](#20-development-priorities)

---

## 1. Project Overview

### What is SafeSchool?

SafeSchool is a **free, open source platform** that unifies school safety technology from any hardware manufacturer. It acts as a universal standard — like USB for school safety — allowing readers, panic buttons, cameras, and intercoms from different manufacturers to work together on one platform.

### Core Principles

- **Free for schools** — The platform, cloud hosting, and basic support are 100% free for every school
- **Open source** — Core platform code is publicly available under AGPL license
- **Manufacturer-sponsored** — Annual membership fees from hardware manufacturers fund development and hosting
- **Vendor neutral** — No lock-in. Schools choose any certified hardware from any member manufacturer
- **Certification-driven** — All hardware in the ecosystem is tested and certified for compatibility
- **Alyssa's Law compliant** — Built-in support for silent panic alerts with location tracking and 911/PSAP integration

### Key Stakeholders

| Stakeholder | Relationship | What They Get |
|---|---|---|
| Schools | Free users | Complete safety platform at zero cost |
| Hardware Manufacturers | Paying members | Market access, certification, directory listing |
| Security Integrators | Certified installers | Training, directory listing, school customer access |
| SafeSchool Foundation (nonprofit) | Platform operator | Membership fees, support revenue, grant funding |
| Bruce's For-Profit LLC | Commercial products | BadgeKiosk and AccessIQ revenue, consulting |

---

## 2. Organizational Structure

### SafeSchool Foundation (501(c)(3) Nonprofit)

- Owns and maintains the open source platform
- Operates the certification program
- Provides free and paid support
- Runs installer training programs
- Funded by manufacturer memberships, paid support, and grants
- Incorporated in Rhode Island

### Bruce's For-Profit LLC

- Sells BadgeKiosk (visitor management & badge printing)
- Sells AccessIQ (AI-powered access control analytics)
- Provides consulting services (Alyssa's Law compliance, system design, grant writing)
- Operates independently but integrates with SafeSchool platform

### Membership Tiers

#### Charter Member (Sicunet)
- First and only charter member
- In-kind contribution (no cash payment)
- Hardware certified first
- Helped shape the platform architecture

#### Platinum — $25,000/year
- Unlimited product certifications included
- Advisory board seat
- Top placement in hardware directory
- Logo on SafeSchool dashboard ("Powered by" section)
- Logo on website
- Priority integration support
- Early API access
- Conference speaking opportunity

#### Gold — $15,000/year
- Up to 3 product certifications included
- Input on standard development / roadmap
- Listed in hardware directory
- Logo on website
- Standard integration support
- Early API access

#### Silver — $5,000/year
- 1 product certification included
- Listed in hardware directory
- Logo on website
- Community integration support

---

## 3. Platform Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SAFESCHOOL CLOUD (Railway)                 │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Web App      │  │  API Gateway │  │  Admin Dashboard  │  │
│  │  (React/Next) │  │  (Node.js)   │  │  (React)          │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────────┘  │
│         │                  │                   │              │
│  ┌──────┴──────────────────┴───────────────────┴──────────┐  │
│  │                   Core Services                         │  │
│  │                                                         │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐  │  │
│  │  │ Access      │ │ Emergency    │ │ Visitor          │  │  │
│  │  │ Control     │ │ Response     │ │ Management       │  │  │
│  │  │ Service     │ │ Service      │ │ Service          │  │  │
│  │  └─────────────┘ └──────────────┘ └─────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐  │  │
│  │  │ Location    │ │ Notification │ │ Device           │  │  │
│  │  │ Service     │ │ Service      │ │ Management       │  │  │
│  │  │ (BLE Mesh)  │ │ (911/PSAP)   │ │ Service          │  │  │
│  │  └─────────────┘ └──────────────┘ └─────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   Database (PostgreSQL)                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────┐  ┌───────────────────────────────┐  │
│  │ BadgeKiosk API      │  │ AccessIQ API                  │  │
│  │ (Commercial Plugin) │  │ (Commercial Plugin)           │  │
│  └─────────────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │   BLE Mesh Gateway  │
                    │   (On-Premise)      │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
        │ Door      │  │ Panic     │  │ Camera    │
        │ Reader    │  │ Button    │  │ /Intercom │
        │ (Mfg A)   │  │ (Mfg B)  │  │ (Mfg C)  │
        └───────────┘  └───────────┘  └───────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Frontend (Website) | Next.js / React | SEO for marketing pages, React for dashboard |
| API | Node.js / Express or Fastify | JavaScript ecosystem, async I/O for real-time |
| Database | PostgreSQL | Reliable, open source, great for relational data |
| Real-time | WebSockets / Socket.io | Live location tracking, emergency alerts |
| Hosting | Railway | Simple deployment, auto-scaling, affordable |
| BLE Protocol | Bluetooth Low Energy Mesh | On-premise communication between devices |
| Gateway | NanoPi NEO or similar SBC | Low-cost on-premise bridge to cloud |
| Open Source License | AGPL-3.0 | Copyleft prevents proprietary forks without contribution |
| CI/CD | GitHub Actions | Auto-deploy on push to main branch |

### ⚠️ CRITICAL: Architecture Principles

**This platform MUST be built with extreme modularity and a framework-centric approach. Every component should be independently testable, replaceable, and debuggable. This is non-negotiable.**

#### 1. Modular Service Architecture

Every feature domain is an isolated module with clear boundaries. No service directly imports from another service's internals. All communication happens through well-defined interfaces.

```
WRONG:  access-control-service imports from emergency-service/internal/alerts.js
RIGHT:  access-control-service calls emergency-service through its public API interface
```

Each module must have:
- Its own directory with a clear public interface (`index.ts` exporting only what's public)
- Its own types/interfaces file
- Its own error types
- Its own test suite
- Its own README explaining what it does, its API surface, and how to debug it
- A health check endpoint that reports module status

#### 2. Framework-Centric Design

Build reusable frameworks first, features second. Every pattern that appears twice should become a framework utility.

**Core Frameworks to Build:**

| Framework | Purpose |
|---|---|
| `@safeschool/api-framework` | Base route handlers, request validation, response formatting, error handling |
| `@safeschool/service-framework` | Service lifecycle, dependency injection, health checks, graceful shutdown |
| `@safeschool/event-framework` | Event bus, pub/sub, webhook dispatch, event sourcing |
| `@safeschool/auth-framework` | Authentication, authorization, RBAC, API key management |
| `@safeschool/test-framework` | Test utilities, fixtures, mocks, integration test helpers |
| `@safeschool/logging-framework` | Structured logging, correlation IDs, audit trail, debug modes |
| `@safeschool/device-framework` | Device communication abstraction, protocol adapters, heartbeat management |
| `@safeschool/certification-framework` | Test runner, report generator, compliance checker |

Every framework must include:
- TypeScript interfaces defining contracts
- Default implementations
- Extension points for customization
- Comprehensive JSDoc documentation
- Unit tests with >90% coverage

#### 3. Troubleshootability First

Debugging a production issue at 2 AM with a school in lockdown is the worst-case scenario. The architecture must make troubleshooting fast and obvious.

**Structured Logging — Every Log Tells a Story:**
```typescript
// WRONG: Unstructured, unhelpful
console.log("Error processing event");

// RIGHT: Structured, traceable, actionable
logger.error({
  correlationId: req.correlationId,
  module: "emergency-response",
  action: "process_panic_alert",
  deviceId: device.id,
  schoolId: school.id,
  buildingId: building.id,
  error: err.message,
  stack: err.stack,
  context: { alertType: "panic", triggerSource: "ble_button" },
  duration_ms: timer.elapsed(),
  suggestion: "Check BLE gateway connectivity for this building"
});
```

**Correlation IDs — Trace Any Request End-to-End:**
- Every incoming request gets a unique correlation ID
- The ID propagates through every service call, database query, and external API call
- Any log entry can be traced back to the original request
- Emergency events get a special `incidentId` that groups all related activity

**Health Check Dashboard:**
Every module exposes a health endpoint returning:
```json
{
  "module": "access-control",
  "status": "healthy",
  "uptime_seconds": 86400,
  "dependencies": {
    "database": { "status": "healthy", "latency_ms": 2 },
    "redis": { "status": "healthy", "latency_ms": 1 },
    "ble_gateway": { "status": "degraded", "latency_ms": 450, "note": "High latency on building-3 gateway" }
  },
  "metrics": {
    "events_processed_last_hour": 1247,
    "error_rate_percent": 0.02,
    "active_connections": 34
  }
}
```

**Debug Mode:**
Every module supports a debug mode that can be toggled per-module without restarting:
```
POST /api/v1/admin/debug/enable?module=emergency-response&level=verbose&duration=30m
```
This enables verbose logging for that specific module for 30 minutes, then automatically reverts. Critical for diagnosing issues without flooding logs.

**Error Taxonomy:**
Every error type is classified and documented:
```typescript
// Every custom error extends a base with classification
class SafeSchoolError extends Error {
  code: string;           // "DEVICE_OFFLINE"
  module: string;         // "access-control"
  severity: Severity;     // critical, warning, info
  recoverable: boolean;   // Can the system auto-recover?
  userMessage: string;    // Safe message for end users
  debugInfo: object;      // Full context for developers
  suggestedAction: string; // "Check gateway power and network"
}
```

#### 4. Detailed API Contracts

Every API endpoint must be fully documented with:
- OpenAPI 3.0 specification (auto-generated from code annotations)
- Request/response examples for every endpoint
- Error response catalog with every possible error code
- Rate limiting documentation
- Authentication requirements
- Webhook payload schemas
- SDK-ready: the OpenAPI spec should be usable for auto-generating client SDKs

**API Versioning:**
All endpoints are versioned (`/api/v1/`, `/api/v2/`). Breaking changes require a new version. Old versions are supported for minimum 12 months after deprecation notice.

**API Response Format — Always Consistent:**
```typescript
// Success
{
  "success": true,
  "data": { /* payload */ },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-01T14:30:00Z",
    "version": "v1",
    "pagination": { "page": 1, "pageSize": 50, "total": 234 }
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device with ID xyz was not found",
    "module": "device-management",
    "details": { "deviceId": "xyz", "searchedIn": "building-3" },
    "suggestion": "Verify the device ID or check if it has been decommissioned",
    "documentation": "https://docs.safeschool.org/errors/DEVICE_NOT_FOUND"
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-01T14:30:00Z"
  }
}
```

#### 5. Plugin Architecture for Integrations

Commercial products (BadgeKiosk, AccessIQ) and future third-party integrations connect through a formal plugin system, not direct code coupling.

```typescript
// Every plugin implements a standard interface
interface SafeSchoolPlugin {
  id: string;
  name: string;
  version: string;
  capabilities: PluginCapability[];

  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Event handling
  onEvent(event: PlatformEvent): Promise<void>;

  // API routes this plugin registers
  getRoutes(): PluginRoute[];
}
```

This means:
- BadgeKiosk is a plugin that registers visitor management routes and subscribes to access events
- AccessIQ is a plugin that subscribes to all access events and registers analytics routes
- Future third-party integrations follow the same pattern
- Any plugin can be enabled/disabled per school without touching the core platform
- Plugins are sandboxed — a broken plugin cannot crash the core platform

#### 6. Testing Strategy

| Test Type | Framework | Runs When | Coverage Target |
|---|---|---|---|
| Unit Tests | Jest / Vitest | Every commit | >90% per module |
| Integration Tests | Supertest + Test DB | Every PR | All API endpoints |
| E2E Tests | Playwright | Pre-deploy | Critical user journeys |
| Contract Tests | Pact | Pre-deploy | All inter-service contracts |
| Load Tests | k6 | Weekly + pre-release | Emergency alert path |
| Certification Tests | Custom (QA Bots) | On submission | Full hardware compliance |

Every module ships with:
- Unit tests for business logic
- Integration tests for API endpoints
- Test fixtures and factories for generating test data
- Mock implementations of dependencies
- A `DEBUG_TEST.md` explaining how to run tests in isolation and debug failures

#### 7. Documentation as Code

Documentation lives alongside code and is auto-generated where possible:
- API docs generated from OpenAPI annotations
- Type docs generated from TypeScript interfaces
- Architecture decision records (ADRs) in `/docs/decisions/`
- Module READMEs auto-checked for staleness in CI
- Runbook for every alert type (`/docs/runbooks/`)

---

## 4. Website Requirements

### Overview

The SafeSchool website serves as the marketing hub, member portal, and entry point for all stakeholders. It should be hosted on Railway alongside the platform.

### Pages Required

#### Public Pages

**Homepage (safeschool.org)**
- Hero section: Mission statement with "Sponsored by our founding members" and member logos
- Two clear CTAs: "I'm a School" and "I'm a Manufacturer"
- How it works (3-column: Schools, Manufacturers, Integrators)
- Founding member logos prominently displayed
- Quick stats (schools deployed, manufacturers certified, states covered)
- Premium integrations callout (BadgeKiosk, AccessIQ)
- Architecture highlights section: Modular, framework-centric, fully documented APIs, plugin-based integrations, open source transparency — schools and manufacturers need to see this is enterprise-grade engineering, not a hobby project
- "Built with" technology partners section near footer: Anthropic/Claude Code logo, Railway logo, and other technology sponsors. Separate from hardware founding member logos. Positioned as "Built with" or "Powered by" to distinguish from manufacturer sponsors
- Troubleshootability / reliability callout: Mention structured logging, correlation tracing, per-module health checks, 99.9% uptime target — schools making life-safety decisions need to trust the engineering
- Open source callout: Link to GitHub repo, invite developers to contribute, show commit activity / contributor count as social proof
- Footer: Founding member logos row ("Sponsored by our Founding Members"), technology partner logos row ("Built with"), links to docs/GitHub/contact

**For Schools (/schools)**
- What you get for free (full feature list)
- How to get started
- Certified hardware directory link
- Certified installer directory link
- Support options (free, standard, priority)
- Alyssa's Law compliance information
- "Sign Up" CTA

**For Manufacturers (/manufacturers)**
- Why join the ecosystem
- Membership tiers with pricing
- Certification process overview
- Current member logos ("Join these companies")
- "Become a Member" CTA → contact form or application

**For Integrators (/integrators)**
- Certified installer program overview
- Training schedule and locations
- Benefits of certification
- Directory listing preview
- "Get Certified" CTA

**Certified Hardware Directory (/directory/hardware)**
- Searchable/filterable catalog of all certified products
- Filter by: product type (reader, panel, panic button, camera, intercom), manufacturer, features
- Each product shows: manufacturer, model, certification date, features, compatibility notes
- Links to manufacturer's product page
- "SafeSchool Certified" badge on each listing

**Certified Installer Directory (/directory/installers)**
- Searchable by location/region
- Each installer shows: company name, region, certifications held, contact info
- Schools can find local certified installers

**About (/about)**
- Foundation mission and story
- Board of directors
- Annual transparency report (how membership fees are used)
- Open source philosophy

**Blog (/blog)**
- School safety best practices
- Alyssa's Law updates by state
- New member announcements
- Technical articles
- SEO content to drive organic traffic

#### Authenticated Pages

**School Dashboard (/dashboard)**
- Building overview with status indicators
- Device status (readers, panic buttons, cameras)
- Recent access events
- Emergency alert controls
- Visitor check-in (basic, or BadgeKiosk integration)
- Settings and configuration

**Manufacturer Portal (/portal/manufacturer)**
- Certification status for submitted products
- Certification test results and reports
- Directory listing management
- Membership status and billing
- API documentation and credentials
- Integration guides

**Admin Dashboard (/admin)**
- Foundation admin controls
- Membership management
- Certification workflow management
- Support ticket overview
- Platform analytics (schools, devices, events)
- Financial overview

### Design Requirements

- Clean, modern, professional design
- Mobile-responsive
- Accessibility compliant (WCAG 2.1 AA)
- Fast loading (Core Web Vitals optimized)
- See [Branding & Design System](#16-branding--design-system) for colors and typography

---

## 5. Core Platform (Open Source)

### Features — Free for All Schools

#### Access Control Management
- Unified door/reader management across manufacturers
- Credential management (cards, fobs, mobile)
- Access schedules and rules
- Real-time door status monitoring
- Event logging and basic reporting
- Lock/unlock controls

#### Emergency Response (Alyssa's Law)
- Silent panic button activation
- BLE mesh location tracking (room-level accuracy)
- 911/PSAP integration
- Mass notification to staff
- Lockdown controls (lock all doors)
- Incident timeline and logging
- First responder view with location data

#### Basic Visitor Management
- Simple check-in/check-out
- Visitor badge printing (basic)
- Visitor log
- Pre-registration
- Note: Advanced features available through BadgeKiosk commercial integration

#### Device Management
- Auto-discovery of certified devices on BLE mesh
- Firmware version tracking
- Health monitoring and alerts
- Configuration management
- Battery status (for wireless devices)

#### Location Services
- BLE mesh triangulation for room-level accuracy
- Real-time location display on floor plans
- Location history for incident review
- Geofencing for restricted areas

#### Reporting
- Access event reports
- Incident reports
- Compliance reports (Alyssa's Law)
- Device health reports
- Exportable data (CSV, PDF)

---

## 6. Certification System

### Overview

The certification system is a core differentiator. It ensures all hardware in the ecosystem works correctly with the platform and meets quality standards.

### Certification Workflow

```
Manufacturer Submits Product
        │
        ▼
  Documentation Review
  (specs, protocols, firmware)
        │
        ▼
  Integration Testing
  (API compliance, protocol conformance)
        │
        ▼
  Functional Testing
  (automated QA test suites)
        │
        ▼
  Security Review
  (firmware security, encryption, data handling)
        │
        ▼
  Certification Report Generated
        │
        ├── PASS → Listed in Directory
        │           Certification badge issued
        │           Annual recertification scheduled
        │
        └── FAIL → Detailed findings report
                    Remediation guidance
                    Resubmission when ready
```

### Certification Portal Features

- Manufacturer submission form (product details, documentation upload)
- Test progress tracker
- Automated test result display
- Certification report generation
- Certificate/badge download
- Recertification reminders and scheduling
- Public certification status lookup

### Automated Testing

Bruce is developing automated QA bots for certification testing. The system should support:

- API endpoint testing against the SafeSchool standard
- Protocol compliance verification
- Performance benchmarking
- Security scanning
- Regression testing against platform updates
- Test report generation

---

## 7. Commercial Integrations

### BadgeKiosk

**Description:** Full-featured visitor management and badge printing system.

**Integration Points:**
- Authenticates against SafeSchool platform
- Reads/writes to SafeSchool visitor database
- Integrates with SafeSchool access control for visitor credentials
- Shares watchlist data with SafeSchool emergency response
- Provides enhanced reporting through SafeSchool dashboard

**Features (beyond free visitor management):**
- Photo capture and ID scanning
- Watchlist screening (sex offender, custom lists)
- Custom badge templates and printing
- Pre-registration with QR code check-in
- Visitor NDAs and agreements
- Multi-location visitor tracking
- Comprehensive visitor analytics

**Pricing:** SaaS subscription, monthly per-school

### AccessIQ

**Description:** AI-powered analytics platform for access control systems.

**Integration Points:**
- Reads access control event data from SafeSchool platform
- Feeds anomaly alerts back to SafeSchool dashboard
- Can integrate with any access control system (not limited to SafeSchool)
- Connects with SafeSchool notification service for alert delivery

**Features:**
- Anomalous behavior pattern detection
- Credential usage analysis
- After-hours access alerts
- Credential sharing detection
- Tailgating pattern identification
- Cardholder direct notification
- Behavioral baseline learning
- Risk scoring per credential

**Pricing:** SaaS subscription, monthly per-building or per-credential-count

### Integration API for Commercial Products

Both BadgeKiosk and AccessIQ connect through the SafeSchool API. The API should support:

- OAuth 2.0 authentication
- Webhook subscriptions for real-time events
- REST endpoints for CRUD operations
- Rate limiting per commercial product
- Separate API keys for commercial vs. open source usage
- Usage tracking for billing purposes

---

## 8. Support System

### Tiers

#### Community (Free)
- Documentation site (Docusaurus or similar)
- Community forum or Discord
- GitHub Issues for bug reports
- Knowledge base with searchable articles

#### Standard Support (Paid)
- Email-based ticket system
- 24-hour response time SLA
- Access to premium knowledge base
- Direct technical assistance from SafeSchool support staff
- Pricing: Per-school monthly subscription

#### Priority Support (Paid)
- Phone support available
- 4-hour response time SLA
- Dedicated support contact
- Priority issue resolution
- Quarterly check-in calls
- Pricing: Per-district monthly subscription

### Technical Requirements

- Ticket system (could use open source like Zammad, or integrate with existing tools)
- Knowledge base with search
- SLA tracking and reporting
- Escalation workflows
- Customer satisfaction tracking

---

## 9. Installer Training Portal

### Overview

Regional training programs for security integrators at accessible pricing. Certified installers are listed in the SafeSchool directory.

### Portal Features

- Course catalog with descriptions
- Regional training schedule and registration
- Online pre-requisite courses
- Certification exam scheduling
- Digital certificate issuance
- Continuing education tracking
- Installer directory listing management
- Payment processing for training fees

### Training Curriculum

- SafeSchool platform overview and architecture
- Hardware installation best practices
- BLE mesh network deployment and configuration
- Alyssa's Law compliance requirements by state
- 911/PSAP integration configuration
- Troubleshooting and maintenance
- Hands-on practical assessment

---

## 10. Infrastructure & Deployment

### Railway Configuration

```
Railway Project: SafeSchool
├── Web Service (Next.js frontend + API)
├── PostgreSQL Database
├── Redis (session store, caching, pub/sub for real-time)
├── Worker Service (background jobs, certification tests, notifications)
└── Cron Service (recertification reminders, health checks, reports)
```

### Environment Strategy

| Environment | Purpose | URL |
|---|---|---|
| Production | Live platform | safeschool.org |
| Staging | Pre-release testing | staging.safeschool.org |
| Certification | Isolated testing for hardware certification | cert.safeschool.org |

### Domain Configuration

- `safeschool.org` — Main website and platform
- `api.safeschool.org` — Public API
- `dashboard.safeschool.org` — School dashboard (or route under main domain)
- `docs.safeschool.org` — Documentation

### Monitoring

- Uptime monitoring (critical for life-safety system)
- Error tracking (Sentry or similar)
- Performance monitoring
- Database health
- Alert escalation for downtime

---

## 11. API Design

### Public API (Open Source)

RESTful API available to all platform users and developers.

#### Authentication
- API keys for server-to-server
- OAuth 2.0 for user-facing applications
- JWT tokens for session management

#### Core Endpoints

```
# Schools
POST   /api/v1/schools                    # Register school
GET    /api/v1/schools/:id                # Get school details
PUT    /api/v1/schools/:id                # Update school
GET    /api/v1/schools/:id/buildings       # List buildings

# Devices
POST   /api/v1/devices                    # Register device
GET    /api/v1/devices                    # List devices (filterable)
GET    /api/v1/devices/:id                # Get device details
PUT    /api/v1/devices/:id                # Update device
DELETE /api/v1/devices/:id                # Remove device
GET    /api/v1/devices/:id/status         # Real-time device status
POST   /api/v1/devices/:id/command        # Send command (lock/unlock)

# Access Control
GET    /api/v1/access/events              # Access event log (filterable)
POST   /api/v1/access/credentials         # Create credential
GET    /api/v1/access/credentials         # List credentials
PUT    /api/v1/access/schedules           # Update access schedules

# Emergency Response
POST   /api/v1/emergency/alert            # Trigger panic alert
POST   /api/v1/emergency/lockdown         # Initiate lockdown
GET    /api/v1/emergency/active           # Active emergency status
POST   /api/v1/emergency/resolve          # Resolve emergency

# Location
GET    /api/v1/location/devices           # Real-time device locations
GET    /api/v1/location/history/:id       # Location history
GET    /api/v1/location/floorplan/:id     # Floor plan with positions

# Visitors
POST   /api/v1/visitors/checkin           # Check in visitor
POST   /api/v1/visitors/checkout          # Check out visitor
GET    /api/v1/visitors                   # Visitor log

# Notifications
POST   /api/v1/notifications/send         # Send notification
GET    /api/v1/notifications/templates     # Notification templates
POST   /api/v1/notifications/subscribe     # Subscribe to events (webhook)

# Directory (Public)
GET    /api/v1/directory/hardware          # Certified hardware catalog
GET    /api/v1/directory/installers        # Certified installer listing
GET    /api/v1/directory/manufacturers     # Member manufacturer listing
```

#### Webhook Events

Subscribers can register for real-time event notifications:

```json
{
  "events": [
    "device.status_change",
    "access.granted",
    "access.denied",
    "emergency.alert_triggered",
    "emergency.lockdown_initiated",
    "emergency.resolved",
    "visitor.checked_in",
    "visitor.checked_out",
    "device.offline",
    "device.low_battery",
    "certification.status_change"
  ]
}
```

### Manufacturer Integration API

For hardware manufacturers to integrate their devices:

```
# Device Registration & Heartbeat
POST   /api/v1/manufacturer/devices/register    # Register new device
POST   /api/v1/manufacturer/devices/heartbeat   # Device health check-in
POST   /api/v1/manufacturer/devices/event        # Report device event

# Firmware
GET    /api/v1/manufacturer/firmware/latest      # Check for updates
POST   /api/v1/manufacturer/firmware/report       # Report firmware version
```

---

## 12. Database Schema

### Core Tables

```sql
-- Schools and Buildings
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    district_name VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(2),
    zip VARCHAR(10),
    contact_email VARCHAR(255),
    support_tier VARCHAR(20) DEFAULT 'community', -- community, standard, priority
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE buildings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    floor_count INT,
    floor_plan_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Devices
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID REFERENCES buildings(id),
    manufacturer_id UUID REFERENCES manufacturers(id),
    device_type VARCHAR(50) NOT NULL, -- reader, panel, panic_button, camera, intercom, gateway
    model VARCHAR(255),
    serial_number VARCHAR(255) UNIQUE,
    firmware_version VARCHAR(50),
    status VARCHAR(20) DEFAULT 'offline', -- online, offline, error, maintenance
    location_description TEXT, -- "Room 204, Main Door"
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    floor_number INT,
    battery_level INT, -- for wireless devices
    last_heartbeat TIMESTAMPTZ,
    certification_id UUID REFERENCES certifications(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access Control
CREATE TABLE credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id),
    holder_name VARCHAR(255) NOT NULL,
    holder_type VARCHAR(50), -- staff, student, visitor, contractor
    credential_type VARCHAR(50), -- card, fob, mobile, pin
    credential_number VARCHAR(255),
    active BOOLEAN DEFAULT true,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE access_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES devices(id),
    credential_id UUID REFERENCES credentials(id),
    event_type VARCHAR(50) NOT NULL, -- granted, denied, forced, propped, alarm
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    details JSONB
);

-- Emergency Response
CREATE TABLE emergency_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id),
    building_id UUID REFERENCES buildings(id),
    event_type VARCHAR(50) NOT NULL, -- panic_alert, lockdown, all_clear
    triggered_by UUID, -- device_id or user_id
    trigger_location TEXT,
    floor_number INT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    status VARCHAR(20) DEFAULT 'active', -- active, resolved
    psap_notified BOOLEAN DEFAULT false,
    psap_notification_time TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manufacturers & Memberships
CREATE TABLE manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    website VARCHAR(255),
    contact_email VARCHAR(255),
    contact_name VARCHAR(255),
    membership_tier VARCHAR(20), -- charter, platinum, gold, silver
    membership_start DATE,
    membership_renewal DATE,
    logo_url TEXT,
    description TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Certifications
CREATE TABLE certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID REFERENCES manufacturers(id),
    product_name VARCHAR(255) NOT NULL,
    product_model VARCHAR(255),
    product_type VARCHAR(50), -- reader, panel, panic_button, camera, intercom
    status VARCHAR(20) DEFAULT 'submitted', -- submitted, in_testing, passed, failed, expired
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    tested_at TIMESTAMPTZ,
    certified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    test_report_url TEXT,
    certificate_url TEXT,
    notes TEXT
);

-- Installers
CREATE TABLE installers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    region VARCHAR(255),
    state VARCHAR(2),
    city VARCHAR(100),
    certifications_held JSONB, -- array of certification types
    certified_since DATE,
    renewal_date DATE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Visitors
CREATE TABLE visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id),
    building_id UUID REFERENCES buildings(id),
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    purpose VARCHAR(255),
    host_name VARCHAR(255),
    photo_url TEXT,
    id_scanned BOOLEAN DEFAULT false,
    badge_printed BOOLEAN DEFAULT false,
    checked_in_at TIMESTAMPTZ DEFAULT NOW(),
    checked_out_at TIMESTAMPTZ,
    notes TEXT
);

-- Support Tickets
CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id),
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, critical
    status VARCHAR(20) DEFAULT 'open', -- open, in_progress, waiting, resolved, closed
    assigned_to UUID,
    sla_tier VARCHAR(20), -- community, standard, priority
    sla_response_due TIMESTAMPTZ,
    first_response_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 13. BLE Mesh Network Protocol

### Overview

The BLE mesh network is the on-premise communication layer between devices. A cellular or Ethernet gateway bridges the mesh to the SafeSchool cloud.

### Device Roles

| Role | Description | Examples |
|---|---|---|
| Gateway | Bridge between BLE mesh and cloud | NanoPi NEO with cellular/Ethernet |
| Node | Full mesh participant, relays messages | Door readers, wall-mounted panic buttons |
| Low-Power Node | Battery-operated, limited relay | Wearable panic buttons, portable devices |

### Message Types

```json
{
  "type": "access_event",
  "device_id": "uuid",
  "timestamp": "iso8601",
  "credential": "card_number",
  "result": "granted|denied",
  "door_status": "locked|unlocked"
}

{
  "type": "panic_alert",
  "device_id": "uuid",
  "timestamp": "iso8601",
  "location": {
    "building_id": "uuid",
    "floor": 2,
    "room": "204",
    "rssi_data": [
      {"reader_id": "uuid", "rssi": -45},
      {"reader_id": "uuid", "rssi": -62},
      {"reader_id": "uuid", "rssi": -78}
    ]
  }
}

{
  "type": "heartbeat",
  "device_id": "uuid",
  "timestamp": "iso8601",
  "battery_level": 85,
  "firmware_version": "2.1.0",
  "mesh_neighbors": 4
}
```

### Location Triangulation

Room-level accuracy is achieved by triangulating RSSI (Received Signal Strength Indicator) data from multiple BLE readers installed at each door. When a panic button is activated, all nearby readers report the RSSI of the button's signal. The cloud service calculates position based on signal strength and known reader locations.

---

## 14. Alyssa's Law Compliance

### Requirements by Feature

| Requirement | SafeSchool Feature |
|---|---|
| Silent panic alarm | BLE panic button with no audible alert |
| Direct 911/PSAP notification | Integration with local PSAP via SIP/VoIP or API |
| Location data for responders | BLE mesh triangulation with floor plan display |
| Staff activation | Wearable panic buttons, wall-mounted buttons, mobile app |
| Mass notification | Push notifications, email, SMS to staff |
| Door lockdown | Remote lock/unlock through access control integration |

### States with Alyssa's Law

- New Jersey (origin state)
- Florida
- New York
- Texas
- Tennessee
- Utah
- Oklahoma
- Georgia
- Washington

Each state has slightly different requirements. The platform should track compliance requirements per state and help schools verify they meet local mandates.

---

## 15. Security Requirements

### Data Security
- All data encrypted at rest (AES-256)
- All data encrypted in transit (TLS 1.3)
- BLE mesh communication encrypted
- Database backups encrypted
- PII handling compliant with FERPA (student data) and state privacy laws

### Authentication & Authorization
- Multi-factor authentication for admin accounts
- Role-based access control (RBAC)
- Session management with timeout
- API key rotation support
- OAuth 2.0 for third-party integrations

### Infrastructure Security
- Regular security audits
- Penetration testing
- Vulnerability scanning
- Incident response plan
- SOC 2 compliance roadmap

### Life-Safety Considerations
- 99.9% uptime SLA for emergency features
- Failover for emergency alert processing
- Offline operation capability for on-premise gateway
- Regular disaster recovery testing

---

## 16. Branding & Design System

### Colors

| Name | Hex | Usage |
|---|---|---|
| Navy | `#1A2744` | Primary brand, headers, footer |
| Teal | `#0D9488` | Accent, CTAs, success states |
| Gold | `#D97706` | Premium/founding member highlights |
| Dark Gray | `#1E293B` | Body text |
| Medium Gray | `#475569` | Secondary text |
| Light Gray | `#F1F5F9` | Backgrounds, cards |
| White | `#FFFFFF` | Base background |

### Typography

| Element | Font | Weight | Size |
|---|---|---|---|
| H1 | Inter or Arial | Bold | 36-48px |
| H2 | Inter or Arial | Bold | 24-32px |
| H3 | Inter or Arial | SemiBold | 20-24px |
| Body | Inter or Arial | Regular | 16px |
| Small | Inter or Arial | Regular | 14px |
| Code | JetBrains Mono | Regular | 14px |

### Logo

The SafeSchool logo should convey: safety, openness, technology, and trust. Consider a shield motif combined with a network/mesh pattern. Colors should use navy and teal.

### Voice & Tone

- Professional but approachable
- Mission-driven without being preachy
- Technical credibility without jargon
- Emphasis on "free for schools" and "vendor neutral"
- Never disparage specific competitors

---

## 17. Business Context

### Key People

- **Bruce** — Executive Director of SafeSchool Foundation. 20 years QA experience in access control manufacturing at Sicunet. Builds software products (BadgeKiosk, AccessIQ) using AI-assisted development. Plans to transition to full-time RV lifestyle, running the foundation and consulting remotely while traveling seasonally.

- **Bruce's Son** — Consultant and trainer. Background in construction and IT. Delivers certified installer training regionally. Conducts field assessments and implementation consulting.

### Revenue Model

| Source | Entity | Type |
|---|---|---|
| Manufacturer memberships | Foundation | Annual recurring |
| Paid support subscriptions | Foundation | Monthly recurring |
| Installer training fees | Foundation | Per-event |
| Grant funding | Foundation | Variable |
| BadgeKiosk licenses | For-Profit LLC | Monthly SaaS |
| AccessIQ licenses | For-Profit LLC | Monthly SaaS |
| Consulting fees | For-Profit LLC | Project/hourly |

### Competitive Landscape

| Competitor | Weakness SafeSchool Addresses |
|---|---|
| CENTEGIX CrisisAlert | Proprietary, expensive, single-vendor lock-in |
| Raptor | Software-only, requires school IT, limited hardware flexibility |
| Verkada | Expensive, proprietary ecosystem |
| 911Cellular | Mobile-app focused, limited hardware integration |

SafeSchool's differentiator is being **open, free, and vendor-neutral** while providing a **unified platform** that no single manufacturer can match alone.

---

## 18. QA Automation Bot System (Claude Code)

### Overview

SafeSchool's certification program is powered by a multi-phase AI apprentice bot architecture, developed and orchestrated through Claude Code. This system is a core differentiator — it scales Bruce's 20 years of QA expertise into an automated, reusable testing platform that can certify hardware from any manufacturer with minimal manual effort.

The system is designed to be **completely reusable** — point it at any website, API, or hardware integration and it learns what it is, builds a test framework, creates comprehensive test suites, and runs continuously.

### Bot Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE (Master Trainer)                    │
│                    Oversees all bots, provides corrections              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
   ┌─────────┐    ┌─────────┐ ┌─────────┐ ┌─────────┐    ┌─────────┐
   │ PHASE 1 │───▶│ PHASE 2 │─▶│ PHASE 3 │─▶│ PHASE 4 │───▶│ PHASE 5 │
   │Discovery│    │Framework│ │  Test   │ │  Intel  │    │  Ops    │
   │   Bot   │    │   Bot   │ │  Bot    │ │   Bot   │    │   Bot   │
   └─────────┘    └─────────┘ └─────────┘ └─────────┘    └─────────┘
        │               │           │           │               │
        ▼               ▼           ▼           ▼               ▼
   Site Map &      Framework    Test Suite   Insights &    Continuous
   App Model       Code Base    & Coverage   Reports       Monitoring
```

### Phase 1: Discovery Bot

The Discovery Bot is the foundation. It crawls and interacts with a target system (website, API, hardware interface) to learn what it IS and what it DOES. This creates the application model that all other bots consume.

**Capabilities:**
- Page type detection and classification
- Component fingerprinting (navigation, tables, modals, forms, tabs)
- Form field extraction with type, validation rules, and requirements
- User journey inference through the application
- Data entity detection (Users, Credentials, Devices, Events)
- Business logic and rule inference
- Auth mechanism detection
- API endpoint discovery and documentation

**Output:** `discovery_output.json` — a complete application model

**For SafeSchool Certification:** The Discovery Bot is pointed at a manufacturer's hardware integration API. It learns the device's capabilities, communication patterns, and data formats. This becomes the foundation for automated certification testing.

### Phase 2: Framework Bot

Consumes the Discovery Bot output and generates a reusable automation framework:
- Page objects for every discovered page/endpoint
- Reusable component wrappers for every detected component type
- Utility functions based on discovered patterns
- Test configuration files ready to execute
- Custom locator strategies for each application

### Phase 3: Test Bot

Uses both Discovery + Framework outputs to generate comprehensive test suites:

| Test Category | What It Covers |
|---|---|
| Smoke Tests | Critical paths work (device connects, events flow, alerts fire) |
| Journey Tests | Complete user flows (school onboarding, device registration, emergency response) |
| Form Tests | Validation, submission, error handling for all forms |
| Component Tests | Reusable UI/API components function correctly |
| UX Tests | Customer experience quality checks |
| Design Tests | Visual consistency and accessibility |
| Security Tests | Input sanitization, injection prevention, auth bypass attempts |
| Protocol Tests | BLE mesh communication, API compliance, data format validation |
| Business Rule Tests | Access schedules enforced, credential rules applied, alert routing correct |

### Phase 4: Intelligence Bot

Analyzes data from multiple sources to provide strategic insights:
- Support ticket pattern analysis
- Bug trend identification and correlation
- Feature suggestion based on usage patterns
- Usability issue detection
- Test coverage gap identification
- Certification failure pattern analysis (which manufacturers struggle with what)

### Phase 5: Operations Bot

Runs continuously in production:
- Scheduled test execution against the SafeSchool platform
- Change detection (re-triggers Discovery Bot when platform updates)
- Regression monitoring after deployments
- Alert on failures with automated triage
- Report generation for certification and compliance
- Manufacturer notification when their integration breaks

### How This Powers Certification

The entire certification workflow is automated through these bots:

```
Manufacturer Submits Hardware
        │
        ▼
  Discovery Bot → Learns device API, capabilities, communication patterns
        │
        ▼
  Framework Bot → Generates custom test framework for this hardware type
        │
        ▼
  Test Bot → Creates certification test suite (hundreds of scenarios)
        │
        ▼
  Test Execution → Automated test run against SafeSchool API standard
        │
        ▼
  Intelligence Bot → Analyzes results, identifies failure patterns
        │
        ▼
  Certification Report → Auto-generated with pass/fail, findings, recommendations
        │
        ▼
  Ops Bot → Monitors ongoing compatibility, alerts on regression
```

### Continuous Certification

Manufacturers can subscribe to **Continuous Certification** — ongoing automated testing against every new version of the SafeSchool platform. When the platform updates, the Ops Bot automatically re-runs the manufacturer's certification tests and alerts both the manufacturer and SafeSchool if anything breaks. This is recurring revenue and a massive value-add for manufacturers who want peace of mind.

### Claude Code as Development Environment

The entire SafeSchool platform, website, certification system, and QA bot architecture are developed using Claude Code as the primary AI-assisted development environment. Claude Code enables:
- Rapid feature development across the full stack
- Automated code review and quality checks
- Real-time debugging and troubleshooting
- Documentation generation from code
- Test generation aligned with the bot architecture
- Infrastructure-as-code for Railway deployments

### Reusability

The bot system is not limited to SafeSchool. It can be pointed at **any target system**:
- A manufacturer's existing software for competitive analysis
- A school district's current safety setup for gap analysis
- Any web application for comprehensive QA automation
- Client systems during consulting engagements

This reusability makes the bot system itself a potential product or service offering.

---

## 19. Potential Sponsorships & Partnerships

### Anthropic / Claude Code Sponsorship

SafeSchool is built entirely using Claude Code and Claude AI. This makes Anthropic a natural sponsorship partner.

**Why Anthropic Should Sponsor SafeSchool:**
- SafeSchool is a compelling real-world case study: open source school safety platform built entirely with AI-assisted development
- Demonstrates Claude Code's ability to architect and build production-grade, life-safety software
- Mission-aligned: Anthropic's focus on AI safety and beneficial AI use maps directly to protecting children
- Public-facing: every school using SafeSchool sees the "Built with Claude Code" attribution
- Nonprofit/education: strong PR angle for Anthropic — AI protecting schools, not replacing jobs
- Developer community: open source project attracts developers who see Claude Code in action
- The QA automation bot system is a showcase of advanced Claude Code capabilities (multi-agent orchestration, autonomous testing, continuous operation)

**What SafeSchool Would Request:**
- Claude Code Pro subscription sponsorship for development team
- "Built with Claude Code" co-branding on SafeSchool website and materials
- Featured case study on Anthropic's website/blog
- Potential conference co-presentation (ISC West, EdTech events)
- API credits for AccessIQ (which uses Claude AI for anomaly detection)
- Mention in Anthropic's education/safety initiatives
- Access to early Claude Code features for the QA bot system

**What Anthropic Gets:**
- Real-world showcase of Claude Code building mission-critical software
- Association with school safety (universally positive branding)
- Open source project that demonstrates AI-assisted development to thousands of developers
- Ongoing case study content as platform grows
- The QA bot architecture as an advanced example of multi-agent Claude Code workflows
- Access to education/government market awareness
- "AI for Good" narrative that reinforces Anthropic's mission

**How to Approach:**
1. Document the SafeSchool development journey with Claude Code (screenshots, metrics, code quality stats)
2. Prepare a one-page partnership proposal for Anthropic
3. Reach out through Anthropic's partnerships or developer relations team
4. Offer to present at Anthropic events or contribute to their case study library
5. Position as ongoing relationship, not one-time sponsorship
6. Emphasize the QA bot system as a showcase of Claude Code's advanced capabilities

### Other Potential Technology Sponsors

| Company | Why They'd Sponsor | What We'd Ask |
|---|---|---|
| **Railway** | SafeSchool showcases Railway for production workloads | Hosting credits, case study |
| **GitHub** | Open source school safety project | GitHub Team plan, featured project |
| **Cloudflare** | CDN/security for life-safety platform | Pro plan, DDoS protection |
| **Vercel** | Next.js framework showcase (if used) | Pro plan, deployment credits |
| **Auth0 / Clerk** | Authentication for school safety platform | Free tier upgrade, case study |
| **Sentry** | Error monitoring for life-safety system | Team plan sponsorship |
| **PostHog** | Analytics for open source project | Open source tier |

### Technology Sponsor Tier

Consider adding a **Technology Sponsor** tier to the founding member structure:

**Technology Sponsors** — Companies providing infrastructure, tools, or services to SafeSchool at no cost in exchange for:
- "Powered by [Company]" attribution on website and documentation
- Logo in "Technology Partners" section (separate from hardware manufacturer logos)
- Case study and testimonial rights
- Not a voting member (no advisory board seat)
- Separate from hardware manufacturer membership tiers

This keeps the hardware directory clean (only hardware manufacturers) while giving technology companies a way to participate and get credit. The website footer would show:

```
"Sponsored by our Founding Members"
[Sicunet logo] [Manufacturer logos...]

"Built with"
[Anthropic/Claude Code logo] [Railway logo] [GitHub logo] ...
```

---

## 20. Development Priorities

### Phase 1 — ISC West Ready (March 2026)
1. Marketing website (homepage, schools page, manufacturers page, integrators page)
2. Founding member application form
3. "Coming Soon" signup for schools
4. Member logo display section
5. Basic brand presence online

### Phase 2 — Platform Beta (Q2 2026)
1. School registration and onboarding
2. Device management (register, monitor, configure)
3. Basic access control event logging
4. School dashboard
5. Manufacturer portal (certification submission)
6. Hardware directory (public)
7. Installer directory (public)

### Phase 3 — Emergency Response (Q3 2026)
1. Panic button alert system
2. BLE mesh location tracking
3. 911/PSAP integration framework
4. Lockdown controls
5. Mass notification system
6. First responder view

### Phase 4 — Commercial Integrations (Q3-Q4 2026)
1. BadgeKiosk integration API
2. AccessIQ integration API
3. Paid support tier infrastructure
4. Billing and subscription management

### Phase 5 — Scale (2027)
1. Multi-district management
2. Advanced reporting
3. Mobile apps (staff, admin)
4. Expanded certification automation
5. International considerations

---

## Appendix: Quick Reference for Claude Code

### Key Commands

```bash
# Start development server
npm run dev

# Run tests
npm test

# Deploy to Railway
railway up

# Database migrations
npx prisma migrate dev
```

### File Structure (Required — Modular Monorepo)

```
safeschool/
│
├── README.md                           # Project overview, quick start, links to docs
├── ARCHITECTURE.md                     # High-level architecture diagram and principles
├── CONTRIBUTING.md                     # How to contribute to the open source project
├── docker-compose.yml                  # Local development environment
├── railway.toml                        # Railway deployment config
├── turbo.json                          # Turborepo config (monorepo build orchestration)
├── package.json                        # Root workspace config
│
├── docs/                               # Documentation site (Docusaurus or similar)
│   ├── decisions/                      # Architecture Decision Records (ADRs)
│   │   ├── 001-modular-architecture.md
│   │   ├── 002-agpl-license.md
│   │   ├── 003-ble-mesh-protocol.md
│   │   └── ...
│   ├── runbooks/                       # Operational runbooks for every alert type
│   │   ├── gateway-offline.md
│   │   ├── emergency-alert-failure.md
│   │   ├── database-connection-loss.md
│   │   └── ...
│   ├── api/                            # Auto-generated API documentation
│   │   └── openapi.yaml                # OpenAPI 3.0 spec (auto-generated)
│   └── guides/                         # Developer guides
│       ├── getting-started.md
│       ├── creating-a-plugin.md
│       ├── certification-testing.md
│       └── gateway-development.md
│
├── packages/                           # Shared frameworks and libraries
│   │
│   ├── api-framework/                  # Base API framework
│   │   ├── README.md                   # What it does, how to use it, how to debug
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts                # Public exports only
│   │   │   ├── types.ts                # Request, Response, Route interfaces
│   │   │   ├── errors.ts               # Error taxonomy (SafeSchoolError base class)
│   │   │   ├── middleware/
│   │   │   │   ├── validation.ts       # Request validation (Zod schemas)
│   │   │   │   ├── correlation-id.ts   # Generates/propagates correlation IDs
│   │   │   │   ├── rate-limiter.ts     # Per-endpoint rate limiting
│   │   │   │   ├── error-handler.ts    # Catches errors, formats consistent responses
│   │   │   │   └── request-logger.ts   # Structured request/response logging
│   │   │   ├── response/
│   │   │   │   ├── formatter.ts        # Consistent success/error response format
│   │   │   │   └── pagination.ts       # Cursor and offset pagination helpers
│   │   │   └── openapi/
│   │   │       └── generator.ts        # Auto-generates OpenAPI spec from routes
│   │   └── tests/
│   │       ├── validation.test.ts
│   │       ├── error-handler.test.ts
│   │       └── fixtures/
│   │
│   ├── service-framework/              # Service lifecycle management
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── service-base.ts         # Base class all services extend
│   │   │   ├── dependency-injection.ts # DI container
│   │   │   ├── health-check.ts         # Health check endpoint builder
│   │   │   ├── graceful-shutdown.ts    # Clean shutdown on SIGTERM
│   │   │   └── debug-mode.ts           # Per-module debug toggle
│   │   └── tests/
│   │
│   ├── event-framework/                # Event bus, pub/sub, webhooks
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts                # PlatformEvent, EventHandler interfaces
│   │   │   ├── event-bus.ts            # In-process event bus
│   │   │   ├── event-store.ts          # Event sourcing / audit trail
│   │   │   ├── webhook-dispatcher.ts   # Outbound webhook delivery with retry
│   │   │   └── subscribers/
│   │   │       └── registry.ts         # Subscriber registration and management
│   │   └── tests/
│   │
│   ├── auth-framework/                 # Authentication and authorization
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts                # User, Role, Permission interfaces
│   │   │   ├── jwt.ts                  # JWT token creation/validation
│   │   │   ├── api-keys.ts             # API key management
│   │   │   ├── oauth.ts                # OAuth 2.0 provider
│   │   │   ├── rbac.ts                 # Role-based access control
│   │   │   └── middleware/
│   │   │       ├── authenticate.ts     # Verify identity
│   │   │       └── authorize.ts        # Check permissions
│   │   └── tests/
│   │
│   ├── logging-framework/              # Structured logging and audit trail
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── logger.ts              # Structured JSON logger
│   │   │   ├── correlation.ts         # Correlation ID management
│   │   │   ├── audit-trail.ts         # Security-relevant event logging
│   │   │   └── formatters/
│   │   │       ├── development.ts     # Pretty-printed for local dev
│   │   │       └── production.ts      # JSON for log aggregation
│   │   └── tests/
│   │
│   ├── device-framework/               # Hardware communication abstraction
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts               # Device, Command, Event interfaces
│   │   │   ├── device-registry.ts     # Track all connected devices
│   │   │   ├── protocol-adapter.ts    # Abstract adapter for device protocols
│   │   │   ├── heartbeat-monitor.ts   # Device health tracking
│   │   │   ├── command-dispatcher.ts  # Send commands to devices
│   │   │   └── adapters/              # Protocol-specific implementations
│   │   │       ├── ble-mesh.ts
│   │   │       ├── tcp-ip.ts
│   │   │       └── mock.ts           # Mock adapter for testing
│   │   └── tests/
│   │
│   ├── test-framework/                 # Shared test utilities
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── factories/            # Test data factories
│   │   │   │   ├── school.factory.ts
│   │   │   │   ├── device.factory.ts
│   │   │   │   ├── credential.factory.ts
│   │   │   │   └── emergency.factory.ts
│   │   │   ├── mocks/                # Mock implementations
│   │   │   │   ├── database.mock.ts
│   │   │   │   ├── event-bus.mock.ts
│   │   │   │   └── device.mock.ts
│   │   │   ├── helpers/
│   │   │   │   ├── api-client.ts     # Test HTTP client with auth helpers
│   │   │   │   ├── database.ts       # Test DB setup/teardown
│   │   │   │   └── assertions.ts     # Custom assertion helpers
│   │   │   └── DEBUG_TEST.md         # How to run and debug tests
│   │   └── tests/
│   │
│   ├── certification-framework/        # Hardware certification test engine
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts              # CertificationTest, TestResult interfaces
│   │   │   ├── test-runner.ts        # Executes certification test suites
│   │   │   ├── report-generator.ts   # Generates certification reports
│   │   │   ├── compliance-checker.ts # Checks against SafeSchool standard
│   │   │   └── test-suites/
│   │   │       ├── reader.suite.ts
│   │   │       ├── panic-button.suite.ts
│   │   │       ├── gateway.suite.ts
│   │   │       ├── camera.suite.ts
│   │   │       └── intercom.suite.ts
│   │   └── tests/
│   │
│   ├── plugin-framework/               # Plugin system for integrations
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts              # SafeSchoolPlugin interface
│   │   │   ├── plugin-loader.ts      # Discovers and loads plugins
│   │   │   ├── plugin-sandbox.ts     # Isolates plugins from core
│   │   │   ├── plugin-registry.ts    # Tracks active plugins per school
│   │   │   └── lifecycle.ts          # Init, health check, shutdown
│   │   └── tests/
│   │
│   ├── database/                       # Database schema and access
│   │   ├── README.md
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Full database schema
│   │   │   └── migrations/           # Version-controlled migrations
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts             # Prisma client singleton
│   │   │   └── repositories/         # Data access layer (one per entity)
│   │   │       ├── school.repo.ts
│   │   │       ├── device.repo.ts
│   │   │       ├── credential.repo.ts
│   │   │       ├── emergency.repo.ts
│   │   │       ├── manufacturer.repo.ts
│   │   │       ├── certification.repo.ts
│   │   │       ├── installer.repo.ts
│   │   │       ├── visitor.repo.ts
│   │   │       └── support-ticket.repo.ts
│   │   └── tests/
│   │
│   └── shared/                         # Shared types, constants, utilities
│       ├── README.md
│       ├── src/
│       │   ├── index.ts
│       │   ├── types/                 # Shared TypeScript interfaces
│       │   │   ├── school.types.ts
│       │   │   ├── device.types.ts
│       │   │   ├── emergency.types.ts
│       │   │   ├── api.types.ts       # Standard API response format
│       │   │   └── events.types.ts    # All platform event types
│       │   ├── constants/
│       │   │   ├── device-types.ts
│       │   │   ├── event-types.ts
│       │   │   ├── error-codes.ts     # Complete error code registry
│       │   │   └── permissions.ts
│       │   └── utils/
│       │       ├── validation.ts
│       │       ├── formatting.ts
│       │       └── crypto.ts
│       └── tests/
│
├── services/                           # Core platform services (each independently deployable)
│   │
│   ├── access-control/                 # Access control management
│   │   ├── README.md                   # Service overview, API surface, debug guide
│   │   ├── DEBUG.md                    # How to troubleshoot this service specifically
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts               # Service entry point
│   │   │   ├── routes/                # API route handlers
│   │   │   │   ├── credentials.routes.ts
│   │   │   │   ├── events.routes.ts
│   │   │   │   ├── schedules.routes.ts
│   │   │   │   └── doors.routes.ts
│   │   │   ├── services/              # Business logic
│   │   │   │   ├── credential.service.ts
│   │   │   │   ├── access-event.service.ts
│   │   │   │   ├── schedule.service.ts
│   │   │   │   └── door-control.service.ts
│   │   │   ├── validators/            # Request validation schemas (Zod)
│   │   │   │   ├── credential.schema.ts
│   │   │   │   └── schedule.schema.ts
│   │   │   └── events/                # Events this service emits/consumes
│   │   │       ├── emitters.ts
│   │   │       └── handlers.ts
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── fixtures/
│   │
│   ├── emergency-response/             # Panic alerts, lockdowns, 911 integration
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── alert.service.ts
│   │   │   │   ├── lockdown.service.ts
│   │   │   │   ├── psap-integration.service.ts  # 911/PSAP notification
│   │   │   │   ├── notification.service.ts
│   │   │   │   └── incident-timeline.service.ts
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── device-management/              # Device registration, monitoring, commands
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── device-registry.service.ts
│   │   │   │   ├── health-monitor.service.ts
│   │   │   │   ├── firmware.service.ts
│   │   │   │   └── command.service.ts
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── location/                       # BLE mesh location tracking
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── triangulation.service.ts
│   │   │   │   ├── floor-plan.service.ts
│   │   │   │   └── location-history.service.ts
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── visitor-management/             # Basic visitor check-in (free tier)
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── notification/                   # Email, SMS, push, mass notification
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── email.service.ts
│   │   │   │   ├── sms.service.ts
│   │   │   │   ├── push.service.ts
│   │   │   │   └── mass-notification.service.ts
│   │   │   ├── templates/             # Notification templates
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── certification/                  # Manufacturer certification workflow
│   │   ├── README.md
│   │   ├── DEBUG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   │   ├── submission.service.ts
│   │   │   │   ├── testing.service.ts
│   │   │   │   ├── report.service.ts
│   │   │   │   └── continuous-cert.service.ts
│   │   │   ├── validators/
│   │   │   └── events/
│   │   └── tests/
│   │
│   └── directory/                      # Hardware and installer directories
│       ├── README.md
│       ├── DEBUG.md
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   │   ├── hardware.routes.ts
│       │   │   ├── installers.routes.ts
│       │   │   └── manufacturers.routes.ts
│       │   ├── services/
│       │   ├── validators/
│       │   └── events/
│       └── tests/
│
├── apps/                               # User-facing applications
│   │
│   ├── web/                            # Next.js website + dashboards
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── pages/                 # Next.js pages (routes)
│   │   │   │   ├── index.tsx          # Homepage
│   │   │   │   ├── schools/
│   │   │   │   ├── manufacturers/
│   │   │   │   ├── integrators/
│   │   │   │   ├── directory/
│   │   │   │   ├── about/
│   │   │   │   ├── blog/
│   │   │   │   ├── dashboard/         # School dashboard (authenticated)
│   │   │   │   ├── portal/            # Manufacturer portal (authenticated)
│   │   │   │   └── admin/             # Foundation admin (authenticated)
│   │   │   ├── components/            # Reusable UI components
│   │   │   │   ├── layout/
│   │   │   │   ├── forms/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── directory/
│   │   │   │   └── common/
│   │   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── lib/                   # Client-side utilities
│   │   │   │   ├── api-client.ts      # Type-safe API client (generated from OpenAPI)
│   │   │   │   └── websocket.ts       # Real-time connection
│   │   │   └── styles/
│   │   │       └── design-system/     # Colors, typography, spacing tokens
│   │   └── tests/
│   │
│   └── gateway/                        # SafeSchool Gateway OS (runs on-premise hardware)
│       ├── README.md
│       ├── package.json
│       ├── src/
│       │   ├── index.ts               # Gateway entry point
│       │   ├── ble/                   # BLE mesh management
│       │   │   ├── mesh-manager.ts
│       │   │   ├── device-scanner.ts
│       │   │   └── message-handler.ts
│       │   ├── cloud/                 # Cloud connectivity
│       │   │   ├── connection.ts
│       │   │   ├── sync.ts
│       │   │   └── failover.ts        # Cellular backup
│       │   ├── buffer/                # Local event buffer (offline mode)
│       │   │   └── event-buffer.ts
│       │   ├── updater/               # OTA update manager
│       │   │   └── auto-update.ts
│       │   └── diagnostics/           # On-device troubleshooting
│       │       ├── health-reporter.ts
│       │       ├── network-test.ts
│       │       └── ble-diagnostics.ts
│       └── tests/
│
├── plugins/                            # Plugin implementations
│   │
│   ├── badgekiosk/                     # BadgeKiosk integration plugin
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts               # Implements SafeSchoolPlugin interface
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── events/
│   │   └── tests/
│   │
│   └── accessiq/                       # AccessIQ integration plugin
│       ├── README.md
│       ├── package.json
│       ├── src/
│       │   ├── index.ts               # Implements SafeSchoolPlugin interface
│       │   ├── routes/
│       │   ├── services/
│       │   │   ├── anomaly-detection.service.ts
│       │   │   ├── pattern-analysis.service.ts
│       │   │   └── alert.service.ts
│       │   └── events/
│       └── tests/
│
├── certification-bots/                 # QA Automation Bot System
│   ├── README.md
│   ├── orchestrator.ts                 # Master bot orchestrator
│   ├── phase1-discovery/
│   ├── phase2-framework/
│   ├── phase3-test/
│   ├── phase4-intelligence/
│   └── phase5-ops/
│
└── .github/
    └── workflows/
        ├── ci.yml                      # Run tests on every PR
        ├── deploy-staging.yml          # Auto-deploy to staging on merge
        ├── deploy-production.yml       # Manual deploy to production
        ├── certification-tests.yml     # Run certification suite
        └── docs-check.yml             # Verify docs are not stale
```

**Key Rules:**
- Every directory with code has a `README.md` explaining what it does
- Every service has a `DEBUG.md` with troubleshooting steps specific to that service
- No service imports from another service's `src/` — only through `packages/` interfaces
- All shared types live in `packages/shared`
- All framework code lives in `packages/` — services consume frameworks, never reinvent them
- Tests live alongside the code they test, not in a separate top-level directory

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Railway
RAILWAY_ENVIRONMENT=production

# Auth
JWT_SECRET=...
OAUTH_CLIENT_ID=...
OAUTH_CLIENT_SECRET=...

# Email
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...

# 911 Integration
PSAP_API_KEY=...
PSAP_ENDPOINT=...

# BadgeKiosk Integration
BADGEKIOSK_API_KEY=...

# AccessIQ Integration  
ACCESSIQ_API_KEY=...
```

---

*This document is the authoritative technical reference for the SafeSchool platform. All development work should align with the architecture, priorities, and business context described here. When in doubt, prioritize: (1) school safety, (2) openness and vendor neutrality, (3) modularity and troubleshootability, (4) simplicity and maintainability. Every module must be independently testable. Every API must be fully documented. Every error must be traceable. Every log must tell a story. Build frameworks first, features second.*
