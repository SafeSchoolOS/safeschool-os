# SafeSchool SOC 2 Type II Preparation

**Document Version:** 1.0
**Date:** February 2026
**Classification:** Internal -- Confidential
**Prepared By:** Engineering Team
**Review Cycle:** Quarterly

---

## Executive Summary

SafeSchool OS is an Alyssa's Law compliant school safety platform operating in a
hybrid cloud (Railway) and on-site edge (Docker on mini PC) architecture. The
platform handles sensitive data including student records (FERPA-regulated),
visitor identity information, transportation tracking, anonymous safety tips,
and 911 dispatch records.

This document assesses SafeSchool's current security posture against the AICPA
SOC 2 Type II Trust Service Criteria (TSC) across all five categories: Security,
Availability, Processing Integrity, Confidentiality, and Privacy. It provides an
honest assessment of implemented controls, identifies gaps, and establishes a
prioritized roadmap for achieving SOC 2 Type II audit readiness.

**Current Posture Summary:**
- **Implemented:** 22 controls across authentication, authorization, input
  validation, TLS enforcement, structured logging, backup rotation, and
  Docker network isolation.
- **Partial:** 6 controls requiring additional tooling or process formalization
  (encryption at rest, vulnerability scanning, change management documentation).
- **Gaps:** 8 controls requiring new processes or tooling (formal incident
  response plan, penetration testing, vendor risk management, data retention
  policies, employee security training program).

---

## Trust Service Criteria Assessment

### 1. Security (Common Criteria CC1--CC9)

The Security category is the foundation of SOC 2. All five trust service
categories depend on the common criteria established here.

#### CC1: Control Environment

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Organizational structure | Gap | -- | No formal security org chart or RACI matrix |
| Board/management oversight | Gap | -- | Need documented security governance structure |
| Code of conduct | Gap | -- | Need formal employee security policy |
| Security awareness training | Gap | -- | Need annual training program with tracking |

**Evidence Files:**
- None yet. Organizational policies must be created as foundational documents.

#### CC2: Communication and Information

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Internal security communication | Partial | GitHub repo, MEMORY.md | Need formal internal security bulletin process |
| External communication channels | Partial | Marketing site contact form | Need security disclosure policy (security.txt) |
| Vulnerability disclosure policy | Gap | -- | Need responsible disclosure program |

#### CC3: Risk Assessment

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Risk assessment process | Gap | -- | Need formal risk register and annual review |
| Fraud risk consideration | Partial | RBAC, audit logs | Role hierarchy prevents privilege abuse |
| Change risk evaluation | Partial | CI/CD pipeline | PRs required but no formal change advisory board |

#### CC4: Monitoring Activities

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Application monitoring | Implemented | Sentry integration | `packages/api/src/plugins/sentry.ts` -- error tracking with user context, request context, performance tracing |
| Health monitoring | Implemented | `/health`, `/ready` endpoints | `server.ts` lines 153-170 -- readiness checks DB + Redis connectivity |
| Audit logging | Implemented | AuditLog model + API | `packages/db/prisma/schema.prisma` line 371 -- captures action, entity, entityId, userId, ipAddress, site-scoped |
| Audit log access control | Implemented | RBAC gated (OPERATOR+) | `packages/api/src/routes/audit-log.ts` -- site-scoped queries, minimum role enforcement |
| Container health checks | Implemented | Docker healthchecks | `deploy/edge/docker-compose.yml` -- all services have health checks with intervals, timeouts, retries |
| Log redaction | Implemented | Pino redact config | `server.ts` line 67 -- redacts `req.headers.authorization` and `req.headers.cookie` from logs |

#### CC5: Control Activities

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Logical access controls | Implemented | JWT + Clerk SSO | Dual auth strategy: `plugins/auth.ts` (JWT) and `plugins/clerk-auth.ts` (Clerk SSO with token verification) |
| Role-based access control | Implemented | 6-role hierarchy | `middleware/rbac.ts` -- PARENT < TEACHER < FIRST_RESPONDER < OPERATOR < SITE_ADMIN < SUPER_ADMIN |
| Multi-site data isolation | Implemented | Site-scoped queries | All data queries filter by `user.siteIds` preventing cross-tenant data access |
| Password hashing | Implemented | bcrypt (cost 10) | `packages/db/src/seed.ts`, `packages/api/src/routes/auth.ts` -- bcryptjs with salt rounds 10 |
| Input validation / XSS prevention | Implemented | sanitizeText(), escapeHtml() | `packages/api/src/utils/sanitize.ts` -- HTML tag stripping, entity escaping, applied to all user-facing inputs |
| Rate limiting | Implemented | Global + per-route | `server.ts` line 84 -- 100 req/min global; `routes/tips.ts` line 11 -- 3/min on anonymous endpoints |
| CORS policy | Implemented | Origin restriction in prod | `server.ts` lines 72-81 -- blocks all cross-origin in production unless CORS_ORIGINS explicitly set |
| API versioning | Implemented | `/api/v1/` prefix | All routes under versioned prefix for safe evolution |
| Inactive user enforcement | Implemented | `isActive` check | `clerk-auth.ts` line 54 -- inactive users rejected at authentication |

#### CC6: Logical and Physical Access Controls

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Network security -- TLS | Implemented | Caddy reverse proxy | `deploy/edge/Caddyfile` -- TLS on all endpoints (443, 8443, 3443), HTTP-to-HTTPS redirect, HSTS with 2-year max-age and preload |
| Security headers | Implemented | Caddy snippet | `Caddyfile` lines 10-20 -- X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, Server header removed |
| Docker network isolation | Implemented | Bridge network | `docker-compose.yml` line 296 -- all services on isolated `safeschool` bridge network; internal services use `expose` not `ports` |
| Database access control | Implemented | Internal network only | PostgreSQL not exposed externally; only accessible within Docker network via `postgres:5432` |
| Redis access control | Partial | Internal network only | Redis within Docker network but no AUTH password configured |
| Service port exposure | Implemented | Minimal exposure | Only Caddy (80, 443, 8443, 3443) and admin panel (9090) exposed; API/DB/Redis use internal `expose` |
| JWT token expiration | Implemented | 24-hour expiry | `plugins/auth.ts` line 8 -- `sign: { expiresIn: '24h' }` |
| Webhook signature verification | Implemented | Signature-verified | `server.ts` line 205 -- ZeroEyes webhook routes bypass JWT auth but verify signatures |
| Encryption at rest | Partial | PostgreSQL default | Recommend LUKS full-disk encryption on edge mini PC; no application-level field encryption |
| Physical security (edge) | Gap | -- | Need physical security policy for on-site mini PC hardware |

#### CC7: System Operations

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| CI/CD pipeline | Implemented | GitHub Actions | `.github/workflows/ci.yml` -- lint, typecheck, test with real Postgres/Redis, auto-deploy to Railway on main |
| Automated testing | Implemented | Vitest test suite | Tests run across api, core, dispatch, edge, cameras, threat-intel packages |
| Database migrations | Implemented | Prisma Migrate | `docker-compose.yml` -- init container runs `prisma migrate deploy` before API starts |
| Auto-update mechanism | Implemented | Watchtower | `docker-compose.yml` lines 271-284 -- polls for new images, auto-restarts, cleanup |
| Change management | Partial | GitHub PRs | Code review via PRs required but no formal change advisory board or approval matrix |
| Vulnerability scanning | Partial | npm audit available | Recommend automating `npm audit` in CI and adding Snyk/Dependabot |

#### CC8: Change Management

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Version control | Implemented | Git + GitHub | All code changes tracked with commit history |
| Branch protection | Partial | CI checks on PRs | Need formal branch protection rules (required reviewers, status checks) |
| Deployment gating | Implemented | CI must pass | Deploy job requires lint-and-typecheck + test jobs to succeed |
| Rollback capability | Partial | Railway deployment | Railway supports rollbacks; edge uses Watchtower (can pin image versions) |

#### CC9: Risk Mitigation

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Vendor risk management | Gap | -- | Multiple third-party integrations (Twilio, SendGrid, Clerk, RapidSOS, Sentry) need formal vendor assessment |
| Business continuity plan | Partial | Edge standalone mode | Edge operates independently during cloud outages; need formal BCP document |
| Incident response plan | Gap | -- | Need formal IRP with roles, escalation, communication procedures |
| Penetration testing | Gap | -- | Need annual third-party penetration test |

---

### 2. Availability (A1)

Availability controls ensure the system meets its operational commitments for
uptime and disaster recovery.

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Health endpoints | Implemented | `/health`, `/ready` | Liveness check returns timestamp; readiness check confirms DB + Redis connectivity |
| Backup strategy | Implemented | 7 daily + 4 weekly | `deploy/edge/backup.sh` -- pg_dump with compression, rotation, empty-file validation, optional S3 upload |
| Backup scheduling | Implemented | Daily at 02:00 UTC | Docker backup container with built-in scheduler; also standalone bash script for cron |
| Backup verification | Partial | Empty-file check | `backup.sh` line 70 -- verifies backup is not empty; recommend periodic restore testing |
| Edge standalone mode | Implemented | OPERATING_MODE=edge | `server.ts` lines 209-218 -- edge mode loads admin routes, cloud mode loads sync routes; offline queue with SQLite |
| Offline data queue | Implemented | SQLite offline queue | `packages/edge/` -- offline-queue persists operations during connectivity loss |
| Conflict resolution | Implemented | Per-entity strategy | `packages/edge/` -- conflict-resolver handles bidirectional sync conflicts |
| Container restart policy | Implemented | `unless-stopped` | All Docker services configured with `restart: unless-stopped` |
| Dual-path 911 dispatch | Implemented | DispatchChain failover | RapidSOS -> Rave 911 -> SIP Direct -> Cellular Failover chain |
| Disaster recovery plan | Gap | -- | Need formal DR plan with RTO/RPO targets |
| Uptime SLA documentation | Gap | -- | Need published SLA with availability commitments |
| Off-site backup storage | Partial | Optional S3 upload | `backup.sh` lines 104-123 -- S3 upload supported but not enforced |
| Backup encryption | Gap | -- | Backups stored unencrypted; recommend GPG encryption before S3 upload |

---

### 3. Processing Integrity (PI1)

Processing Integrity controls ensure system processing is complete, valid,
accurate, timely, and authorized.

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Database transactions | Implemented | Prisma transactions | Multi-step operations (lockdown + door lock, visitor check-in + screening) use database transactions |
| Schema-level constraints | Implemented | Prisma schema | Foreign keys, unique constraints (`email`, `clerkId`), enums for valid states, `@default` values |
| Input sanitization | Implemented | sanitizeText() | Applied to all user-input fields; HTML stripping + trimming on unauthenticated endpoints (tips, visitors) |
| Date validation | Implemented | isValidDateString() | `utils/sanitize.ts` line 43 -- ISO date string validation |
| Audit trail for mutations | Implemented | AuditLog on write ops | Alert creation, lockdown initiation, tip submission/review, visitor check-in all create audit entries |
| Request/response logging | Implemented | Pino structured logging | `server.ts` lines 50-68 -- structured JSON logs with method, URL, remoteAddress; redacted auth headers |
| Error handling | Implemented | Global error handler | `server.ts` lines 118-138 -- 500 errors return generic message (no stack traces); 4xx return error message |
| Data integrity monitoring | Gap | -- | Need checksums or integrity verification on critical records |
| Output validation | Gap | -- | API responses not schema-validated; recommend response schemas |

---

### 4. Confidentiality (C1)

Confidentiality controls protect information designated as confidential.

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| FERPA compliance posture | Implemented | Site-scoped data isolation | Student data (transportation, contacts) isolated by site; RBAC limits access by role |
| Credential redaction in logs | Implemented | Pino redact config | `server.ts` line 67 -- `authorization` and `cookie` headers redacted from all log output |
| Visitor ID hashing | Implemented | `idNumberHash` field | `schema.prisma` line 401 -- visitor ID numbers stored as hashes, not plaintext |
| Anonymous tip IP hashing | Implemented | SHA-256 + salt | `routes/tips.ts` line 39 -- IP hashed with JWT_SECRET as salt, truncated to 16 chars |
| Error message sanitization | Implemented | Generic 500 responses | Internal errors return `"Internal Server Error"` without stack traces or implementation details |
| Server header removal | Implemented | Caddy config | `Caddyfile` line 18 -- `-Server` directive removes server identification header |
| Version concealment | Implemented | Minimal root response | `server.ts` lines 173-178 -- API root returns only `{ status, docs }`, no version number |
| Secrets management | Partial | Environment variables | Secrets passed via `.env` files and Railway env vars; no formal secrets vault (HashiCorp Vault, AWS Secrets Manager) |
| Data classification policy | Gap | -- | Need formal data classification (public, internal, confidential, restricted) |
| Confidential data inventory | Gap | -- | Need inventory of all PII/sensitive fields across database models |
| Key rotation policy | Gap | -- | No documented rotation schedule for JWT_SECRET, API keys, integration credentials |

---

### 5. Privacy (P1--P8)

Privacy controls address personal information collection, use, retention,
disclosure, and disposal.

#### P1: Notice

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Privacy policy | Gap | -- | Need published privacy policy covering data collection, use, sharing |
| Data collection notice | Partial | Kiosk visitor flow | Visitor check-in kiosk collects consent implicitly; needs explicit consent screen |

#### P2: Choice and Consent

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Opt-in consent mechanisms | Gap | -- | Need explicit consent capture for visitor data, parent contact info, push notifications |
| Consent record storage | Gap | -- | No database model for consent records |

#### P3: Collection

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Data minimization | Implemented | Schema design | Only essential fields collected; visitor ID stored as hash not plaintext; tip IP hashed |
| Purpose limitation | Partial | Field-level | Data collected for stated safety purposes; need formal purpose documentation |

#### P4: Use, Retention, and Disposal

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Data retention policy | Gap | -- | No automated data purging; audit logs, tips, visitor records retained indefinitely |
| Data disposal procedures | Gap | -- | Need defined deletion procedures for aged-out records |
| Backup retention limits | Implemented | 7 daily + 4 weekly | `backup.sh` enforces rotation; old backups automatically deleted |

#### P5: Access

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Data subject access requests | Gap | -- | No mechanism for individuals to request their data (DSAR) |
| Data portability | Gap | -- | No data export functionality for data subjects |

#### P6: Disclosure

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Third-party data sharing | Partial | Integration adapters | Data shared with RapidSOS, Twilio, SendGrid for operational purposes; need data processing agreements |
| Subprocessor list | Gap | -- | Need documented list of all third-party data processors |

#### P7: Quality

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Data accuracy mechanisms | Partial | Schema validation | Prisma schema enforces types and constraints; no user-facing data correction flow |

#### P8: Monitoring and Enforcement

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Privacy breach detection | Gap | -- | No specific privacy breach detection beyond general error monitoring |
| Privacy training | Gap | -- | Need privacy-specific training for personnel handling student/visitor data |

---

## Gap Analysis

The following table prioritizes identified gaps by risk severity and provides
remediation recommendations with estimated timelines.

| Priority | Gap | Risk Level | Recommendation | Estimated Effort | Target Date |
|----------|-----|-----------|----------------|-----------------|-------------|
| P0 | Incident Response Plan | Critical | Draft formal IRP with roles, escalation matrix, communication templates, post-mortem process. Alyssa's Law incidents require documented response procedures. | 2 weeks | Q2 2026 |
| P0 | Encryption at Rest | Critical | Enable LUKS full-disk encryption on all edge mini PCs. Evaluate PostgreSQL TDE or application-level encryption for PII fields (visitor names, student data). | 1 week (LUKS) + 3 weeks (app-level) | Q2 2026 |
| P1 | Penetration Testing | High | Engage third-party security firm for annual penetration test covering API, dashboard, edge deployment. Address findings within 30 days. | 1 week coordination + vendor timeline | Q2 2026 |
| P1 | Vulnerability Scanning Automation | High | Add `npm audit --audit-level=high` to CI pipeline. Enable GitHub Dependabot or Snyk for continuous dependency monitoring. Set up alerts for critical CVEs. | 1 day | Q1 2026 |
| P1 | Redis Authentication | High | Configure Redis `requirepass` in Docker Compose and update REDIS_URL connection strings to include password. Even on internal networks, defense-in-depth requires authentication. | 2 hours | Q1 2026 |
| P1 | Backup Encryption | High | Encrypt database backups with GPG before writing to disk and S3. Store encryption key separately from backup storage. | 1 day | Q1 2026 |
| P1 | Privacy Policy | High | Publish comprehensive privacy policy covering FERPA obligations, data collection scope, third-party sharing, retention periods, and individual rights. | 2 weeks (legal review) | Q2 2026 |
| P2 | Key Rotation Policy | Medium | Document rotation schedule: JWT_SECRET (quarterly), API keys (annually), integration credentials (per vendor policy). Implement zero-downtime rotation for JWT. | 1 week | Q2 2026 |
| P2 | Data Retention Policy | Medium | Define retention periods per data type: audit logs (7 years for compliance), visitor records (1 year), anonymous tips (3 years), transportation events (1 year). Implement automated purge jobs. | 2 weeks | Q2 2026 |
| P2 | Vendor Risk Assessment | Medium | Create vendor risk questionnaire. Assess Twilio, SendGrid, Clerk, RapidSOS, Sentry, Railway, ZeroEyes. Obtain SOC 2 reports from critical vendors. Establish DPAs. | 4 weeks | Q3 2026 |
| P2 | Security Awareness Training | Medium | Establish annual security training for all personnel. Topics: phishing, password hygiene, FERPA obligations, incident reporting. Track completion. | 3 weeks (program setup) | Q3 2026 |
| P2 | Branch Protection Rules | Medium | Enable GitHub branch protection on `main`: require 1+ approving review, require CI status checks, prevent force push, require signed commits. | 1 hour | Q1 2026 |
| P3 | Data Subject Access Requests | Medium | Build admin tooling for DSAR fulfillment: data export per individual (visitor, parent, student), right to deletion with cascade handling. | 3 weeks | Q3 2026 |
| P3 | Consent Management | Medium | Add explicit consent capture to visitor kiosk, parent contact registration, and push notification enrollment. Store consent records with timestamps. | 2 weeks | Q3 2026 |
| P3 | Formal Change Management | Low | Document change management process: change request template, risk assessment criteria, approval matrix, rollback procedures. | 1 week | Q3 2026 |
| P3 | Disaster Recovery Plan | Low | Document DR plan with RTO (4 hours cloud, 15 minutes edge), RPO (24 hours), failover procedures, communication plan. Test annually. | 2 weeks | Q3 2026 |
| P4 | Security Governance Structure | Low | Define security roles (Security Lead, Data Protection Officer), responsibilities, and reporting structure. Even for a small team, documented accountability matters. | 1 week | Q3 2026 |
| P4 | Physical Security Policy (Edge) | Low | Document physical security requirements for on-site mini PCs: locked server cabinet, restricted access, tamper detection, asset inventory. | 1 week | Q4 2026 |

---

## Recommendations

### Top 10 Priority Items for SOC 2 Readiness

**1. Write and Adopt a Formal Incident Response Plan (IRP)**

This is the single most critical gap. School safety platforms must have a
documented, tested plan for security incidents. The IRP should cover:
- Incident classification (P0-P4 severity levels)
- Escalation matrix with contact information
- Communication templates (internal, law enforcement, affected parties)
- Evidence preservation procedures
- Post-incident review and root cause analysis process
- Annual tabletop exercises

Given SafeSchool's Alyssa's Law compliance obligations, the IRP must address
scenarios where a security compromise could impact emergency response
capabilities.

**2. Enable Encryption at Rest on Edge Deployments**

Edge mini PCs in schools contain sensitive data including student records,
visitor information, and 911 dispatch logs. Implement:
- LUKS full-disk encryption on the host OS
- Encrypted Docker volumes for `postgres_data`, `redis_data`, `backup_data`
- Application-level encryption for the most sensitive fields (visitor names,
  parent contact info) using envelope encryption with a key management service

**3. Add Automated Vulnerability Scanning to CI/CD**

The current CI pipeline runs lint, typecheck, and tests but does not scan for
known vulnerabilities. Add:
- `npm audit --audit-level=high` as a CI step (fail the build on high/critical)
- GitHub Dependabot or Snyk integration for continuous monitoring
- Container image scanning (Trivy or Snyk Container) for Docker images
- SAST scanning (Semgrep or CodeQL) for code-level vulnerabilities

**4. Secure Redis with Authentication**

Redis is currently deployed without a password within the Docker network
(`deploy/edge/docker-compose.yml`). While network isolation provides a layer of
defense, SOC 2 requires defense-in-depth:
- Add `--requirepass ${REDIS_PASSWORD}` to the Redis command
- Update all `REDIS_URL` connection strings to include the password
- Consider enabling Redis TLS for in-transit encryption within the Docker network

**5. Encrypt Database Backups**

The backup strategy (`deploy/edge/backup.sh`) produces unencrypted `pg_dump`
files. Before writing to disk or uploading to S3:
- Pipe through `gpg --symmetric --batch --passphrase-file /run/secrets/backup-key`
- Store the encryption key in a Docker secret or external vault, separate
  from backup storage
- Test restore procedures quarterly with encrypted backups

**6. Publish a Privacy Policy and Implement Consent Management**

FERPA compliance is referenced in the codebase but not formalized:
- Publish a privacy policy covering all data collection, use, and sharing
- Add explicit consent capture to the visitor kiosk check-in flow
- Record consent with timestamps in a new `Consent` database model
- Implement data subject access request (DSAR) tooling for parents/guardians

**7. Enforce Branch Protection and Formalize Change Management**

The CI pipeline gates deployments, but GitHub branch protection should be
hardened:
- Require at least 1 approving review for PRs to `main`
- Require all CI status checks to pass before merge
- Prevent force push and branch deletion on `main`
- Document a lightweight change management policy covering risk assessment,
  approval criteria, and rollback procedures

**8. Conduct Annual Penetration Testing**

Engage a third-party security firm specializing in web application and API
security. Scope should include:
- API endpoint testing (authentication bypass, IDOR, injection)
- Dashboard and kiosk application testing (XSS, CSRF, session management)
- Edge deployment assessment (network segmentation, container escape)
- 911 dispatch path integrity testing
- Remediate critical and high findings within 30 days

**9. Establish Vendor Risk Management Program**

SafeSchool integrates with numerous third parties that process sensitive data:
- Collect SOC 2 Type II reports from Clerk, Twilio, SendGrid, Railway, Sentry
- Execute Data Processing Agreements (DPAs) with all vendors processing PII
- Maintain a subprocessor list and notify customers of changes
- Conduct annual vendor risk reviews using a standardized questionnaire

**10. Implement Data Retention and Key Rotation Policies**

Define and enforce data lifecycle management:
- Audit logs: 7 years (regulatory compliance)
- Visitor records: 1 year after last visit
- Anonymous tips: 3 years (legal retention requirements)
- Transportation events: 1 academic year
- Build automated purge jobs as BullMQ scheduled tasks
- Establish key rotation: JWT_SECRET quarterly, API keys annually, integration
  credentials per vendor policy

---

## Current Security Architecture Summary

### Authentication Flow

```
Client Request
    |
    v
[Caddy TLS Termination] -- HTTPS enforced, security headers injected
    |
    v
[Fastify Rate Limiter] -- 100 req/min global, stricter per-route
    |
    v
[Auth Plugin Selection] -- AUTH_PROVIDER env var
    |
    +--> [JWT Auth] -- @fastify/jwt, 24h expiry, HMAC signing
    |        |
    |        v
    |    request.jwtVerify() -> request.jwtUser
    |
    +--> [Clerk SSO] -- @clerk/backend token verification
             |
             v
         clerk.verifyToken() -> DB lookup by clerkId/email -> request.jwtUser
    |
    v
[RBAC Middleware] -- requireRole() or requireMinRole()
    |
    v
[Route Handler] -- site-scoped data queries via user.siteIds
    |
    v
[Audit Log] -- mutation operations create AuditLog entries
```

### Edge Deployment Security Layers

```
[Internet / School LAN]
    |
    v
[Caddy Reverse Proxy] -- TLS (self-signed or Let's Encrypt)
    |                      HSTS, security headers
    |                      HTTP -> HTTPS redirect
    |
    +---> :443  Dashboard (internal port 80)
    +---> :8443 Kiosk (internal port 80)
    +---> :3443 API (internal port 3000)
    |
    v
[Docker Bridge Network: safeschool] -- isolated, no external exposure
    |
    +---> API container (expose 3000, not published)
    +---> Worker container (no ports)
    +---> PostgreSQL (expose 5432, not published)
    +---> Redis (expose 6379, not published)
    +---> Backup container (cron, pg_dump, rotation)
    +---> Watchtower (auto-update)
```

### Data Protection Measures

| Data Type | Protection | Storage |
|-----------|-----------|---------|
| User passwords | bcrypt hash (cost 10) | `users.password_hash` |
| Visitor ID numbers | Not stored in plaintext | `visitors.id_number_hash` |
| Anonymous tip IPs | SHA-256 hash + salt, truncated | `anonymous_tips.ip_hash` |
| Auth headers | Redacted from logs | Pino `redact` config |
| JWT tokens | HMAC-signed, 24h expiry | Client-side only |
| Database backups | Compressed (pg_dump custom format) | Local + optional S3 |
| Student transport data | Site-scoped access only | `ridership_events`, `bus_routes` |

---

## Compliance Crosswalk

SafeSchool operates under multiple regulatory frameworks. The following maps SOC 2
criteria to related compliance requirements.

| SOC 2 Criteria | Related Regulation | SafeSchool Relevance |
|---------------|-------------------|---------------------|
| CC5 (Access Controls) | FERPA 34 CFR 99.31 | Student records access restricted by role and site |
| CC6 (Encryption) | FERPA Technical Safeguards | PII must be encrypted in transit (TLS) and at rest |
| A1 (Availability) | Alyssa's Law (NJ, FL, NY) | 911 dispatch path must be highly available; edge mode provides resilience |
| PI1 (Processing Integrity) | NENA i3 | 911 call data must be accurate and complete |
| C1 (Confidentiality) | FERPA 34 CFR 99.30 | Student data disclosure requires consent or exception |
| P1-P8 (Privacy) | COPPA, State Student Privacy Laws | Parental consent for under-13 data; state-specific student data protections |

---

## Audit Readiness Checklist

Use this checklist to track progress toward SOC 2 Type II audit readiness.

- [ ] **Policies and Procedures**
  - [ ] Information Security Policy
  - [ ] Acceptable Use Policy
  - [ ] Incident Response Plan
  - [ ] Change Management Policy
  - [ ] Data Classification Policy
  - [ ] Data Retention and Disposal Policy
  - [ ] Vendor Risk Management Policy
  - [ ] Business Continuity / Disaster Recovery Plan
  - [ ] Privacy Policy (public-facing)
  - [ ] Physical Security Policy (edge deployments)

- [ ] **Technical Controls**
  - [x] TLS enforcement (Caddy HTTPS + HSTS)
  - [x] Authentication (JWT + Clerk SSO)
  - [x] Authorization (RBAC 6-role hierarchy)
  - [x] Input validation (sanitizeText, rate limiting)
  - [x] Audit logging (AuditLog model, site-scoped)
  - [x] Log redaction (authorization, cookie headers)
  - [x] Health monitoring (/health, /ready endpoints)
  - [x] Error handling (generic 500 messages, no stack traces)
  - [x] Backup rotation (7 daily, 4 weekly)
  - [x] Container health checks and restart policies
  - [x] Docker network isolation
  - [x] Security headers (HSTS, CSP, XSS protection)
  - [ ] Encryption at rest (LUKS, field-level encryption)
  - [ ] Redis authentication
  - [ ] Backup encryption
  - [ ] Automated vulnerability scanning in CI
  - [ ] Container image scanning
  - [ ] SAST code scanning
  - [ ] Key rotation automation
  - [ ] Data retention automation

- [ ] **Organizational Controls**
  - [ ] Security governance structure documented
  - [ ] Annual security awareness training
  - [ ] Annual penetration test
  - [ ] Vendor SOC 2 report collection
  - [ ] Data Processing Agreements with vendors
  - [ ] Quarterly access reviews
  - [ ] Annual risk assessment
  - [ ] Tabletop incident response exercise
  - [ ] Backup restore testing (quarterly)

- [ ] **Evidence Collection**
  - [x] Git commit history (change tracking)
  - [x] CI/CD pipeline logs (GitHub Actions)
  - [x] Audit log database (queryable, site-scoped)
  - [x] Sentry error tracking (with user context)
  - [ ] Security training completion records
  - [ ] Penetration test reports
  - [ ] Vendor risk assessment records
  - [ ] Incident response logs
  - [ ] Access review documentation

---

## Timeline and Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| Quick wins (Redis auth, branch protection, npm audit in CI) | Q1 2026 | Not Started |
| Encryption at rest (LUKS on edge devices) | Q2 2026 | Not Started |
| Incident Response Plan drafted and approved | Q2 2026 | Not Started |
| Privacy policy published | Q2 2026 | Not Started |
| First penetration test completed | Q2 2026 | Not Started |
| Data retention policy and automation | Q3 2026 | Not Started |
| Vendor risk assessments complete | Q3 2026 | Not Started |
| Security awareness training program launched | Q3 2026 | Not Started |
| SOC 2 Type II audit engagement begins | Q4 2026 | Not Started |
| SOC 2 Type II observation period (6-12 months) | Q4 2026 - Q2 2027 | Not Started |
| SOC 2 Type II report issued | Q2-Q3 2027 | Not Started |

---

## Appendix A: Key Source Files Referenced

| File | Purpose |
|------|---------|
| `packages/api/src/server.ts` | Fastify server configuration, CORS, rate limiting, error handling, log redaction |
| `packages/api/src/middleware/rbac.ts` | Role-based access control with 6-level hierarchy |
| `packages/api/src/utils/sanitize.ts` | XSS prevention utilities (stripHtml, escapeHtml, sanitizeText) |
| `packages/api/src/plugins/auth.ts` | JWT authentication plugin with 24h token expiry |
| `packages/api/src/plugins/clerk-auth.ts` | Clerk SSO authentication with DB user lookup |
| `packages/api/src/plugins/sentry.ts` | Sentry error tracking with user/request context |
| `packages/api/src/routes/audit-log.ts` | Audit log API with RBAC and site-scoping |
| `packages/api/src/routes/tips.ts` | Anonymous tip submission with IP hashing, input sanitization, rate limiting |
| `packages/db/prisma/schema.prisma` | Database schema with AuditLog, User, Visitor models |
| `deploy/edge/docker-compose.yml` | Edge deployment with network isolation, health checks, backup scheduler |
| `deploy/edge/Caddyfile` | TLS termination, security headers, HTTPS enforcement |
| `deploy/edge/backup.sh` | Database backup with rotation, validation, optional S3 upload |
| `.github/workflows/ci.yml` | CI/CD pipeline: lint, typecheck, test, deploy |

## Appendix B: Third-Party Integrations Requiring Vendor Assessment

| Vendor | Data Processed | Risk Level | DPA Required |
|--------|---------------|-----------|-------------|
| Clerk | User authentication, email, SSO tokens | High | Yes |
| Twilio | SMS messages, phone numbers | High | Yes |
| SendGrid | Email addresses, notification content | High | Yes |
| RapidSOS | 911 call data, location, caller info | Critical | Yes |
| Rave 911 Suite | 911 dispatch data, school location | Critical | Yes |
| Sentry | Error traces, user IDs, request metadata | Medium | Yes |
| Railway | Application hosting, database, secrets | High | Yes |
| ZeroEyes | Camera feeds, threat detection results | Critical | Yes |
| Navigate360 | Threat assessment data, student info | Critical | Yes |
| Bark / Gaggle | Social media monitoring, student data | High | Yes |
| Sicunet | Door access control, badge data | High | Yes |
| Genetec | Camera/VMS integration, video data | High | Yes |

---

*This document should be reviewed quarterly and updated as controls are
implemented. It will serve as the foundation for the SOC 2 Type II readiness
assessment and the basis for evidence collection during the observation period.*
