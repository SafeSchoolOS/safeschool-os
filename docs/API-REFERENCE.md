# SafeSchool OS -- API Reference

REST API for the SafeSchool school safety platform. Built with Fastify 5 on Node.js 20.

**Base URL:** `https://api-production-XXXX.up.railway.app` (cloud) or `https://<edge-ip>:3443` (edge)

**API Version:** v1 (all routes prefixed with `/api/v1/`)

**OpenAPI Docs:** Available at `/docs` (Swagger UI)

---

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Responses](#error-responses)
- [Health Endpoints](#health-endpoints)
- [Auth](#auth)
- [Alerts](#alerts)
- [Lockdown](#lockdown)
- [Doors](#doors)
- [Sites](#sites)
- [Visitors](#visitors)
- [Transportation](#transportation)
- [Drills](#drills)
- [Anonymous Tips](#anonymous-tips)
- [Reunification](#reunification)
- [Environmental](#environmental)
- [Threat Assessments](#threat-assessments)
- [Social Media](#social-media)
- [Notifications](#notifications)
- [Cameras](#cameras)
- [Grants](#grants)
- [Audit Log](#audit-log)
- [Organizations](#organizations)
- [Webhooks](#webhooks)
- [WebSocket Events](#websocket-events)

---

## Authentication

### JWT (Default / Dev Mode)

Obtain a token via `POST /api/v1/auth/login`, then include it in all requests:

```
Authorization: Bearer <token>
```

Tokens expire after 24 hours.

### Clerk SSO

When `AUTH_PROVIDER=clerk`, users authenticate through Clerk's frontend SDK. The Clerk session token is verified server-side using `@clerk/backend`. The `/login` endpoint is disabled in Clerk mode.

### JWT Payload

```json
{
  "id": "user-uuid",
  "email": "user@school.org",
  "role": "SITE_ADMIN",
  "siteIds": ["site-uuid-1"],
  "iat": 1707436800,
  "exp": 1707523200
}
```

---

## Rate Limiting

| Scope               | Limit              |
|----------------------|--------------------|
| Global (all routes)  | 100 requests/minute |
| Login                | 10 requests/minute  |
| Create Alert         | 5 requests/minute   |
| Submit Tip           | 3 requests/minute   |

Rate limit responses return HTTP 429 with a `Retry-After` header.

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "statusCode": 400
}
```

For authorization errors:

```json
{
  "error": "Insufficient permissions",
  "code": "ROLE_LEVEL_REQUIRED",
  "requiredMinRole": "OPERATOR"
}
```

| Code | Meaning                                |
|------|----------------------------------------|
| 400  | Bad request / validation error         |
| 401  | Unauthorized / invalid token           |
| 403  | Forbidden / insufficient role          |
| 404  | Resource not found                     |
| 429  | Rate limited                           |
| 500  | Internal server error                  |
| 503  | Service unavailable (integration down) |

---

## Health Endpoints

### GET /health

Liveness check. No authentication required.

```json
{ "status": "ok", "timestamp": "2026-02-09T12:00:00.000Z" }
```

### GET /ready

Readiness check. Confirms PostgreSQL and Redis connectivity.

```json
{ "status": "ready" }
```

Returns 503 if dependencies are unavailable.

---

## Auth

### POST /api/v1/auth/login

Authenticate with email and password. Returns a JWT token.

**Rate limit:** 10/minute

```bash
curl -X POST /api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@school.org", "password": "secret123"}'
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "uuid",
    "email": "admin@school.org",
    "name": "Admin User",
    "role": "SITE_ADMIN",
    "siteIds": ["site-uuid"]
  }
}
```

### GET /api/v1/auth/me

Get current authenticated user info. Requires: any authenticated user.

**Response (200):**
```json
{
  "id": "uuid",
  "email": "admin@school.org",
  "name": "Admin User",
  "role": "SITE_ADMIN",
  "phone": "+1234567890",
  "siteIds": ["site-uuid"],
  "isActive": true
}
```

### POST /api/v1/auth/push-token

Register a push notification token (mobile app). Requires: any authenticated user.

**Body:** `{ "token": "fcm-device-token" }`

### POST /api/v1/auth/clerk-webhook

Clerk webhook for `user.created` / `user.updated` events. Verified via Svix HMAC signature. No JWT required.

---

## Alerts

### POST /api/v1/alerts

Create a panic alert. Triggers 911 dispatch, lockdown, and mass notifications based on alert level.

**Requires:** FIRST_RESPONDER+
**Rate limit:** 5/minute

```bash
curl -X POST /api/v1/alerts \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "ACTIVE_THREAT",
    "source": "DASHBOARD",
    "buildingId": "building-uuid",
    "floor": 1,
    "roomId": "room-uuid",
    "message": "Armed intruder spotted near main entrance"
  }'
```

**Alert Levels:** `LOCKDOWN`, `ACTIVE_THREAT`, `MEDICAL`, `FIRE`, `WEATHER`, `HAZMAT`, `CUSTOM`

**Response (201):** Full alert object with dispatch records.

### GET /api/v1/alerts

List alerts with filters. Requires: any authenticated user.

| Query Param | Type   | Description                |
|-------------|--------|----------------------------|
| `siteId`    | string | Filter by site             |
| `status`    | string | ACTIVE, ACKNOWLEDGED, RESOLVED, CANCELLED |
| `level`     | string | Alert level filter         |
| `limit`     | number | Max results (default 50, max 100) |

### GET /api/v1/alerts/:id

Get alert detail with dispatch records and lockdown commands. Requires: any authenticated user.

### PATCH /api/v1/alerts/:id

Update alert status. Requires: FIRST_RESPONDER+

**Body:** `{ "status": "ACKNOWLEDGED" }`

Valid transitions: `ACKNOWLEDGED`, `RESOLVED`, `CANCELLED`

---

## Lockdown

### POST /api/v1/lockdown

Initiate a lockdown. Locks all non-emergency-exit doors in scope. Requires: FIRST_RESPONDER+

```bash
curl -X POST /api/v1/lockdown \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "BUILDING",
    "targetId": "building-uuid",
    "alertId": "alert-uuid"
  }'
```

**Scopes:** `SITE`, `BUILDING`, `FLOOR`

**Response (201):**
```json
{
  "id": "lockdown-uuid",
  "siteId": "site-uuid",
  "scope": "BUILDING",
  "targetId": "building-uuid",
  "doorsLocked": 8,
  "initiatedAt": "2026-02-09T12:00:00.000Z",
  "releasedAt": null
}
```

### DELETE /api/v1/lockdown/:id

Release a lockdown. **Edge only** -- returns 403 with `EDGE_ONLY_OPERATION` if called from cloud. Requires: OPERATOR+

### GET /api/v1/lockdown/active

Get all active (unreleased) lockdowns for user's sites. Requires: any authenticated user.

---

## Doors

### GET /api/v1/doors

List all door statuses. Requires: any authenticated user.

| Query Param  | Type   | Description                |
|--------------|--------|----------------------------|
| `siteId`     | string | Filter by site             |
| `buildingId` | string | Filter by building         |

### POST /api/v1/doors/:id/lock

Lock a specific door. Requires: FIRST_RESPONDER+

### POST /api/v1/doors/:id/unlock

Unlock a specific door. Requires: FIRST_RESPONDER+

---

## Sites

### GET /api/v1/sites

List user's assigned sites with building counts. Requires: TEACHER+

### GET /api/v1/sites/:id

Get site detail with buildings, rooms, and doors. Requires: TEACHER+

### PUT /api/v1/sites/:id/floor-plan

Update room and door map positions. Requires: SITE_ADMIN+

```json
{
  "rooms": [
    { "id": "room-uuid", "mapX": 100, "mapY": 200, "mapW": 150, "mapH": 100 }
  ],
  "doors": [
    { "id": "door-uuid", "mapX": 175, "mapY": 200 }
  ]
}
```

---

## Visitors

### POST /api/v1/visitors

Pre-register a visitor. Requires: OPERATOR+

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "purpose": "Parent meeting",
  "destination": "Room 101",
  "hostUserId": "user-uuid",
  "idType": "drivers_license",
  "idNumberHash": "sha256hash"
}
```

### POST /api/v1/visitors/:id/check-in

Check in a visitor. Triggers screening. Requires: OPERATOR+

### POST /api/v1/visitors/:id/check-out

Check out a visitor. Requires: OPERATOR+

### GET /api/v1/visitors

List visitors with filters. Requires: OPERATOR+

| Query Param | Type   | Description                         |
|-------------|--------|-------------------------------------|
| `siteId`    | string | Filter by site                      |
| `status`    | string | PRE_REGISTERED, CHECKED_IN, CHECKED_OUT, DENIED |
| `date`      | string | Filter by date (YYYY-MM-DD)         |
| `limit`     | number | Max results (default 50, max 100)   |

### GET /api/v1/visitors/active

Currently checked-in visitors. Requires: OPERATOR+

### GET /api/v1/visitors/:id

Visitor detail with screening results. Requires: OPERATOR+

---

## Transportation

### GET /api/v1/transportation/buses

List buses for site. Requires: TEACHER+

### POST /api/v1/transportation/buses

Create a bus. Requires: OPERATOR+

```json
{
  "busNumber": "42",
  "driverId": "user-uuid",
  "capacity": 60,
  "hasRfidReader": true,
  "hasPanicButton": true,
  "hasCameras": true
}
```

### PATCH /api/v1/transportation/buses/:id

Update bus details. Requires: OPERATOR+

### GET /api/v1/transportation/routes

List routes with stops. Requires: TEACHER+

### POST /api/v1/transportation/routes

Create a route with stops. Requires: OPERATOR+

```json
{
  "name": "Morning Route 1",
  "routeNumber": "AM-1",
  "scheduledDepartureTime": "07:00",
  "scheduledArrivalTime": "08:00",
  "isAmRoute": true,
  "stops": [
    {
      "name": "Oak Street",
      "address": "123 Oak St",
      "latitude": 40.7357,
      "longitude": -74.1724,
      "scheduledTime": "07:15",
      "stopOrder": 1
    }
  ]
}
```

### GET /api/v1/transportation/routes/:id

Route detail with stops and student assignments. Requires: TEACHER+

### POST /api/v1/transportation/gps

GPS position update from bus hardware. Requires: OPERATOR+

```json
{
  "busId": "bus-uuid",
  "latitude": 40.7357,
  "longitude": -74.1724,
  "speed": 25.5,
  "heading": 180
}
```

### POST /api/v1/transportation/scan

RFID student scan from bus reader. Requires: OPERATOR+

```json
{
  "cardId": "RFID-CARD-ID",
  "busId": "bus-uuid",
  "scanType": "BOARD"
}
```

**Scan Types:** `BOARD`, `EXIT`

### GET /api/v1/transportation/student/:cardId/status

Student transportation status (ON_BUS / OFF_BUS). Requires: TEACHER+

### GET /api/v1/transportation/parents/:studentCardId

List parent contacts for a student. Requires: TEACHER+

### POST /api/v1/transportation/parents

Add parent contact. Requires: OPERATOR+

### PATCH /api/v1/transportation/parents/:id/preferences

Update parent notification preferences. Requires: OPERATOR+

```json
{
  "boardAlerts": true,
  "exitAlerts": true,
  "etaAlerts": false,
  "delayAlerts": true,
  "missedBusAlerts": true,
  "smsEnabled": true,
  "emailEnabled": true,
  "pushEnabled": false
}
```

---

## Drills

### GET /api/v1/drills

List drills with optional filters. Requires: TEACHER+

| Query Param | Type   | Description                          |
|-------------|--------|--------------------------------------|
| `status`    | string | SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED |
| `type`      | string | LOCKDOWN, FIRE, EVACUATION, ACTIVE_THREAT |

### POST /api/v1/drills

Schedule a new drill. Requires: SITE_ADMIN+

```json
{
  "type": "LOCKDOWN",
  "scheduledAt": "2026-03-15T14:00:00Z",
  "buildingId": "building-uuid",
  "notes": "Spring lockdown drill"
}
```

### GET /api/v1/drills/:id

Get drill detail with participants. Requires: TEACHER+

### PATCH /api/v1/drills/:id

Update drill status and results. Requires: SITE_ADMIN+

```json
{
  "status": "COMPLETED",
  "evacuationTimeS": 180,
  "headCount": 450,
  "issues": ["Room 203 door jammed"],
  "complianceMet": true,
  "notes": "Smooth drill, minor door issue"
}
```

### POST /api/v1/drills/:id/participants

Add a participant. Requires: SITE_ADMIN+

```json
{ "name": "Jane Smith", "role": "Teacher" }
```

### PATCH /api/v1/drills/:drillId/participants/:participantId/checkin

Mark participant as checked in. Requires: SITE_ADMIN+

### GET /api/v1/drills/compliance/report

Compliance summary against Alyssa's Law minimums. Requires: TEACHER+

| Query Param | Type   | Description                     |
|-------------|--------|---------------------------------|
| `year`      | number | Target year (default: current)  |

**Response (200):**
```json
{
  "year": 2026,
  "totalDrills": 5,
  "requirements": [
    { "type": "LOCKDOWN", "label": "Lockdown Drills", "required": 2, "completed": 2, "compliant": true },
    { "type": "FIRE", "label": "Fire Drills", "required": 2, "completed": 1, "compliant": false },
    { "type": "EVACUATION", "label": "Evacuation Drills", "required": 1, "completed": 1, "compliant": true },
    { "type": "ACTIVE_THREAT", "label": "Active Threat Drills", "required": 1, "completed": 1, "compliant": true }
  ],
  "overallCompliant": false
}
```

---

## Anonymous Tips

### POST /api/v1/tips

Submit an anonymous tip. **No authentication required.**

**Rate limit:** 3/minute

```json
{
  "siteId": "site-uuid",
  "category": "WEAPONS",
  "message": "Saw a student with what looked like a weapon in their backpack near the gym.",
  "severity": "HIGH",
  "contactInfo": "optional@email.com"
}
```

**Categories:** `BULLYING`, `WEAPONS`, `DRUGS`, `SELF_HARM`, `SUSPICIOUS_ACTIVITY`, `OTHER`

**Severity:** `LOW`, `MODERATE`, `HIGH`, `CRITICAL`

**Response (201):**
```json
{
  "id": "tip-uuid",
  "message": "Tip submitted successfully. Thank you for helping keep our school safe."
}
```

### GET /api/v1/tips

List tips (admin only). Requires: SITE_ADMIN+

| Query Param | Type   | Description                |
|-------------|--------|----------------------------|
| `status`    | string | NEW, REVIEWING, INVESTIGATING, RESOLVED, DISMISSED |
| `category`  | string | Tip category               |
| `severity`  | string | Severity level             |

### GET /api/v1/tips/:id

Tip detail. Requires: SITE_ADMIN+

### PATCH /api/v1/tips/:id

Update tip status and notes. Requires: SITE_ADMIN+

```json
{ "status": "INVESTIGATING", "notes": "Assigned to SRO for follow-up" }
```

---

## Reunification

All reunification routes require FIRST_RESPONDER+ role.

### GET /api/v1/reunification

List reunification events.

### POST /api/v1/reunification

Start a reunification event.

```json
{
  "location": "Main Parking Lot",
  "alertId": "alert-uuid",
  "totalStudents": 450
}
```

### GET /api/v1/reunification/:id

Event detail with entries.

### POST /api/v1/reunification/:id/entries

Add a student to reunification.

```json
{ "studentName": "Jane Smith", "studentGrade": "5" }
```

### PATCH /api/v1/reunification/:eventId/entries/:entryId/release

Release student to guardian.

```json
{
  "guardianName": "John Smith",
  "guardianIdType": "drivers_license",
  "guardianIdCheck": true
}
```

### PATCH /api/v1/reunification/:id

Update event status (COMPLETED / CANCELLED).

---

## Environmental

All environmental routes require authentication.

### GET /api/v1/environmental/sensors

List sensors. Requires: TEACHER+

| Query Param | Type   | Description    |
|-------------|--------|----------------|
| `type`      | string | Sensor type    |

### POST /api/v1/environmental/sensors

Register a sensor. Requires: OPERATOR+

```json
{
  "name": "Gym CO2 Sensor",
  "type": "AIR_QUALITY",
  "location": "Gymnasium",
  "buildingId": "building-uuid"
}
```

### POST /api/v1/environmental/readings

Ingest a sensor reading. Requires: OPERATOR+

```json
{
  "sensorId": "sensor-uuid",
  "value": 450,
  "unit": "ppm",
  "isAlert": false
}
```

### GET /api/v1/environmental/readings

Get readings for a sensor. Requires: TEACHER+

| Query Param | Type   | Description                   |
|-------------|--------|-------------------------------|
| `sensorId`  | string | Required. Sensor ID.          |
| `hours`     | number | Lookback hours (default 24)   |

### GET /api/v1/environmental/status

Overview of all sensors with latest readings and alert counts. Requires: TEACHER+

---

## Threat Assessments

### GET /api/v1/threat-assessments

List threat reports. Requires: OPERATOR+

| Query Param | Type   | Description                     |
|-------------|--------|---------------------------------|
| `siteId`    | string | Filter by site                  |
| `status`    | string | REPORTED, UNDER_REVIEW, ESCALATED_TO_LE, RESOLVED, CLOSED |
| `riskLevel` | string | LOW, MODERATE, HIGH, IMMINENT   |
| `limit`     | number | Max results (default 50)        |

### POST /api/v1/threat-assessments

Submit a threat report with CSTAG risk scoring. Requires: OPERATOR+

```json
{
  "subjectName": "John Doe",
  "subjectGrade": "10",
  "subjectRole": "student",
  "category": "VERBAL_THREAT",
  "description": "Student made threatening statements in class",
  "riskFactors": [
    "VERBAL_THREAT",
    "SOCIAL_ISOLATION",
    "RECENT_DISCIPLINE"
  ]
}
```

**Response (201):**
```json
{
  "report": { "id": "uuid", "riskLevel": "HIGH", "status": "REPORTED", "..." : "..." },
  "assessment": {
    "level": "HIGH",
    "score": 7,
    "recommendation": "Immediate threat assessment team meeting required",
    "actions": ["Notify administration", "Contact parents", "SRO interview"]
  }
}
```

### GET /api/v1/threat-assessments/:id

Report detail. Requires: OPERATOR+

### PATCH /api/v1/threat-assessments/:id

Update report status/assignment. Requires: OPERATOR+

```json
{
  "status": "UNDER_REVIEW",
  "assignedToId": "user-uuid",
  "actionTaken": "SRO contacted, parents notified"
}
```

### POST /api/v1/threat-assessments/:id/score

Re-score risk with updated factors. Requires: OPERATOR+

```json
{ "riskFactors": ["VERBAL_THREAT", "ACCESS_TO_WEAPONS"] }
```

### GET /api/v1/threat-assessments/dashboard

Summary statistics (total, active, by status, by risk level). Requires: OPERATOR+

---

## Social Media

### GET /api/v1/social-media/alerts

List social media alerts. Requires: OPERATOR+

| Query Param | Type   | Description              |
|-------------|--------|--------------------------|
| `siteId`    | string | Filter by site           |
| `status`    | string | NEW, REVIEWING, RESOLVED, DISMISSED |
| `severity`  | string | LOW, MODERATE, HIGH, CRITICAL |
| `source`    | string | BARK, GAGGLE, MANUAL     |
| `limit`     | number | Max results              |

### POST /api/v1/social-media/alerts

Create an alert. Requires: OPERATOR+

```json
{
  "source": "BARK",
  "platform": "Instagram",
  "contentType": "text",
  "flaggedContent": "Concerning post content...",
  "category": "SELF_HARM",
  "severity": "HIGH",
  "studentName": "Jane Doe",
  "studentGrade": "8"
}
```

### GET /api/v1/social-media/alerts/:id

Alert detail. Requires: OPERATOR+

### PATCH /api/v1/social-media/alerts/:id

Review/update alert. Requires: OPERATOR+

```json
{ "status": "RESOLVED", "actionTaken": "Counselor notified, student seen" }
```

### GET /api/v1/social-media/dashboard

Summary statistics. Requires: OPERATOR+

### POST /api/v1/social-media/webhook

External webhook endpoint for social media monitoring services. No JWT required -- payload signature verified by the adapter.

```json
{
  "event_type": "alert.created",
  "data": {
    "id": "external-id",
    "platform": "Instagram",
    "content_type": "text",
    "content": "Flagged content",
    "category": "BULLYING",
    "severity": "MODERATE",
    "student": { "name": "Jane Doe", "grade": "8" },
    "flagged_at": "2026-02-09T12:00:00Z"
  }
}
```

---

## Notifications

### POST /api/v1/notifications/send

Send mass notification. Requires: OPERATOR+

```json
{
  "channels": ["SMS", "EMAIL", "PUSH"],
  "message": "Lockdown drill starting in 5 minutes. This is a drill.",
  "recipientScope": "all-staff",
  "alertId": "alert-uuid"
}
```

**Channels:** `SMS`, `EMAIL`, `PUSH`, `PA`

**Recipient Scopes:** `all-staff`, `all-parents`, `specific-users`

### GET /api/v1/notifications/log

Notification history. Requires: TEACHER+

### GET /api/v1/notifications/log/:id

Specific notification detail. Requires: TEACHER+

### POST /api/v1/notifications/test

Send test notification to yourself. Requires: OPERATOR+

---

## Cameras

### GET /api/v1/cameras

List all cameras. Requires: FIRST_RESPONDER+

Returns 503 if camera adapter is not configured or unavailable.

### GET /api/v1/cameras/:id/stream

Get RTSP/HLS stream URL for a camera. Requires: FIRST_RESPONDER+

### GET /api/v1/cameras/:id/snapshot

Get JPEG snapshot from a camera. Requires: FIRST_RESPONDER+

Returns `Content-Type: image/jpeg` with `Cache-Control: no-cache`.

---

## Grants

### GET /api/v1/grants/search

Search available grants. Requires: SITE_ADMIN+

| Query Param | Type   | Description                           |
|-------------|--------|---------------------------------------|
| `schoolType`| string | PUBLIC, PRIVATE, CHARTER              |
| `state`     | string | Two-letter state code                 |
| `source`    | string | FEDERAL, STATE, PRIVATE               |
| `modules`   | string | Comma-separated module names          |

### GET /api/v1/grants/estimate

Estimate potential funding for selected modules. Requires: SITE_ADMIN+

| Query Param | Type   | Description                    |
|-------------|--------|--------------------------------|
| `modules`   | string | Required. Comma-separated list |

### GET /api/v1/grants/budget-template

Generate budget template for grant applications. Requires: SITE_ADMIN+

---

## Audit Log

### GET /api/v1/audit-log

List audit log entries with pagination. Requires: OPERATOR+

| Query Param | Type   | Description              |
|-------------|--------|--------------------------|
| `action`    | string | Filter by action type    |
| `entity`    | string | Filter by entity type    |
| `userId`    | string | Filter by user           |
| `limit`     | number | Max results (default 50) |
| `offset`    | number | Pagination offset        |

**Response (200):**
```json
{
  "entries": [
    {
      "id": "uuid",
      "siteId": "site-uuid",
      "userId": "user-uuid",
      "action": "LOCKDOWN_INITIATED",
      "entity": "LockdownCommand",
      "entityId": "lockdown-uuid",
      "details": { "scope": "BUILDING", "doorsLocked": 8 },
      "ipAddress": "192.168.1.100",
      "createdAt": "2026-02-09T12:00:00.000Z",
      "user": { "id": "uuid", "name": "Admin User", "email": "admin@school.org", "role": "SITE_ADMIN" }
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

### GET /api/v1/audit-log/entities

List distinct entity types. Requires: OPERATOR+

### GET /api/v1/audit-log/actions

List distinct action types. Requires: OPERATOR+

---

## Organizations

### Prefix: /api/v1/organizations

Multi-district organization management. Supports hierarchical org structures (state agency > district > school).

---

## Webhooks

Webhook endpoints use signature verification instead of JWT authentication.

### POST /webhooks/zeroeyes

Receives weapon detection events from ZeroEyes AI camera system.

**Headers:**
- `X-Signature` -- HMAC SHA-256 signature of the request body

**Behavior:**
- Verifies HMAC signature using `ZEROEYES_WEBHOOK_SECRET`
- Parses the detection payload
- If confidence exceeds threshold, automatically creates an `ACTIVE_THREAT` alert
- Returns acknowledgment with alert creation status

**Response (200):**
```json
{
  "received": true,
  "alertCreated": true,
  "alertId": "alert-uuid",
  "threatEvent": {
    "id": "detection-uuid",
    "type": "HANDGUN",
    "confidence": 0.95
  }
}
```

### POST /api/v1/social-media/webhook

Receives alerts from social media monitoring services (Bark, Gaggle). See [Social Media](#social-media) section.

### POST /api/v1/auth/clerk-webhook

Receives user lifecycle events from Clerk. Verified via Svix HMAC signature. See [Auth](#auth) section.

---

## WebSocket Events

Connect to the WebSocket endpoint for real-time updates:

```
wss://api.example.com/ws?token=JWT_TOKEN
```

### Connection Flow

1. Connect with JWT token as query parameter.
2. Subscribe to a site:
   ```json
   { "type": "subscribe", "siteId": "site-uuid" }
   ```
3. Receive confirmation:
   ```json
   { "event": "subscribed", "data": { "siteId": "site-uuid" }, "timestamp": "..." }
   ```
4. Receive real-time events for the subscribed site.

### Keepalive

Send periodic pings to keep the connection alive:
```json
{ "type": "ping" }
```
Response:
```json
{ "event": "pong", "timestamp": "2026-02-09T12:00:00.000Z" }
```

### Event Types

| Event                  | Trigger                           | Data                              |
|------------------------|-----------------------------------|-----------------------------------|
| `lockdown:initiated`   | Lockdown command issued           | LockdownCommand object            |
| `lockdown:released`    | Lockdown released                 | LockdownCommand object            |
| `door:updated`         | Door locked/unlocked              | Door object                       |
| `visitor:checked-in`   | Visitor checked in                | Visitor object                    |
| `visitor:checked-out`  | Visitor checked out               | Visitor object                    |
| `bus:gps-update`       | Bus GPS position update           | `{ busId, busNumber, latitude, longitude, speed, heading }` |
| `bus:rfid-scan`        | Student RFID scan on bus          | `{ studentName, busNumber, scanType, scannedAt }` |
| `notification:sent`    | Mass notification dispatched      | `{ id, channels, recipientCount, message }` |

### Error Event

```json
{
  "event": "error",
  "data": { "message": "Not authorized for this site" }
}
```

### Connection Errors

| Close Code | Reason          |
|------------|-----------------|
| 4401       | Unauthorized    |

---

## Sync API (Cloud Only)

Available only when `OPERATING_MODE=cloud`.

### Prefix: /api/v1/sync

Edge-to-cloud synchronization endpoints. Used by the edge sync engine to push local events and pull configuration updates. Authenticated via sync key, not JWT.

---

## Admin API (Edge Only)

Available only when `OPERATING_MODE=edge`.

### Prefix: /api/v1/admin

Edge device administration endpoints. Includes system update triggers and edge-specific configuration.
