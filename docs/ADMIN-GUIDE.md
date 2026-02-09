# SafeSchool OS -- Administrator Guide

This guide covers day-to-day administration of the SafeSchool platform for Site Administrators and Operators.

---

## Table of Contents

- [First-Time Setup](#first-time-setup)
- [User Management](#user-management)
- [Site Configuration](#site-configuration)
- [Integration Setup](#integration-setup)
- [Floor Plan Editor](#floor-plan-editor)
- [Drill Management and Compliance](#drill-management-and-compliance)
- [Visitor Management](#visitor-management)
- [Transportation Tracking](#transportation-tracking)
- [Threat Assessment](#threat-assessment)
- [Social Media Monitoring](#social-media-monitoring)
- [Anonymous Tips](#anonymous-tips)
- [Environmental Monitoring](#environmental-monitoring)
- [Reunification](#reunification)
- [Notifications](#notifications)
- [Reports and Analytics](#reports-and-analytics)
- [Audit Log](#audit-log)
- [Troubleshooting](#troubleshooting)

---

## First-Time Setup

After deployment, the platform seeds an initial admin account and sample site data.

### Default Credentials

| Field    | Value                        |
|----------|------------------------------|
| Email    | `bwattendorf@gmail.com`      |
| Password | `safeschool123`              |
| Role     | SITE_ADMIN                   |

Change the default password immediately after first login.

### Onboarding Checklist

1. **Log in** to the dashboard at your deployment URL.
2. **Update your password** via the account settings.
3. **Configure your site** -- set the correct address, timezone, and coordinates.
4. **Add buildings and rooms** -- define the physical layout of your school.
5. **Register doors** -- add access-controlled doors and their locations.
6. **Upload floor plans** -- position rooms and doors on the floor plan map.
7. **Create user accounts** -- add staff with appropriate roles.
8. **Configure integrations** -- connect your access control, 911 dispatch, and notification systems.
9. **Run a test notification** -- verify SMS/email delivery.
10. **Schedule your first drill** -- test the full alert-to-lockdown workflow.

---

## User Management

### Roles and Permissions

SafeSchool uses a hierarchical role-based access control (RBAC) system. Higher roles inherit all permissions of lower roles.

| Role              | Level | Permissions                                                     |
|-------------------|-------|-----------------------------------------------------------------|
| PARENT            | 0     | View transportation status, receive notifications               |
| TEACHER           | 1     | View alerts, sites, drills, environmental data, bus status      |
| FIRST_RESPONDER   | 2     | Create alerts, lock/unlock doors, initiate lockdown, manage reunification |
| OPERATOR          | 3     | Manage visitors, transportation, notifications, tips, threat assessments |
| SITE_ADMIN        | 4     | Full site management, user admin, drill scheduling, floor plans, integrations |
| SUPER_ADMIN       | 5     | Cross-site access, system configuration                         |

### Creating a User

Users are created through the admin dashboard or via API:

```bash
# API example
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@school.org", "password": "..."}'
```

When using Clerk SSO (`AUTH_PROVIDER=clerk`):
1. Users sign up through Clerk's authentication flow.
2. A Clerk webhook (`POST /api/v1/auth/clerk-webhook`) links the Clerk user to the SafeSchool user record.
3. The admin must pre-create the user in SafeSchool with the correct email, role, and site assignment.
4. On first Clerk login, the systems are automatically linked.

### User-Site Assignment

Each user is assigned to one or more sites. Users can only access data for their assigned sites. SUPER_ADMIN users have cross-site access.

---

## Site Configuration

### Site Hierarchy

```
Organization (District)
  +-- Site (School)
       +-- Building
            +-- Room
            +-- Door
```

### Managing Sites

Navigate to **Sites** in the dashboard to view and edit site details:

- **Name** -- School name
- **Address** -- Full street address
- **GPS Coordinates** -- Latitude and longitude (used for 911 dispatch location data)
- **Timezone** -- IANA timezone identifier (e.g., `America/New_York`)
- **District** -- Parent school district name

### Managing Buildings

Each site can have multiple buildings. Buildings contain rooms and doors.

### Managing Rooms and Doors

Rooms and doors are registered with their physical location information. Each door tracks:
- **Status** -- LOCKED, UNLOCKED, UNKNOWN
- **Is Emergency Exit** -- Emergency exit doors are excluded from lockdown commands
- **Building and Floor** -- Physical location
- **Map Position** -- X/Y coordinates on the floor plan

---

## Integration Setup

SafeSchool uses an adapter pattern for all third-party integrations. Set the adapter via environment variables and restart the service.

### Access Control

Controls physical door locks during lockdowns and individual door operations.

| Adapter        | Env Value      | Configuration Required                    |
|----------------|----------------|-------------------------------------------|
| Mock (testing) | `mock`         | None                                       |
| Sicunet        | `sicunet`      | `AC_API_URL`, `AC_API_KEY`                |
| Genetec        | `genetec`      | `AC_API_URL`, `AC_API_KEY` (WebSDK)      |
| Brivo          | `brivo`        | `AC_API_URL`, `AC_API_KEY` (OAuth2)       |
| Verkada        | `verkada`      | `AC_API_URL`, `AC_API_KEY`                |
| LenelS2        | `lenel`        | `AC_API_URL`, `AC_API_KEY` (OpenAccess)   |
| Openpath       | `openpath`     | `AC_API_URL`, `AC_API_KEY`                |
| HID Mercury    | `hid-mercury`  | `AC_API_URL`, `AC_API_KEY` (OAuth2)       |

Set in `.env`:
```env
ACCESS_CONTROL_ADAPTER=sicunet
AC_API_URL=https://sicunet.myschool.org/api
AC_API_KEY=your-api-key
```

### 911 Dispatch

Handles emergency dispatch to local PSAPs (Public Safety Answering Points).

| Adapter      | Env Value     | Configuration Required                         |
|--------------|---------------|------------------------------------------------|
| Console (dev)| `console`     | None (logs to stdout)                          |
| RapidSOS     | `rapidsos`    | `RAPIDSOS_CLIENT_ID`, `RAPIDSOS_CLIENT_SECRET` |
| Rave 911     | `rave-911`    | `RAVE_API_KEY`, `RAVE_ORGANIZATION_ID`          |
| SIP Direct   | `sip-direct`  | `SIP_TRUNK_HOST`, `SIP_LOCAL_DOMAIN`            |
| Cellular     | `cellular`    | `CELLULAR_DEVICE_PATH`                          |

The platform supports **dispatch chains** -- multiple adapters can be configured in sequence for failover. The edge device fires the primary path directly while the cloud fires a backup path simultaneously.

### Notifications

| Adapter       | Env Value     | Configuration Required                             |
|---------------|---------------|----------------------------------------------------|
| Console (dev) | `console`     | None                                                |
| Twilio SMS    | `twilio`      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| SendGrid Email| `sendgrid`    | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`          |
| FCM Push      | `fcm`         | `FCM_SERVICE_ACCOUNT_KEY`                          |
| PA/Intercom   | `pa-intercom` | System-specific configuration                       |

### Camera Systems

| Adapter       | Env Value      | Configuration Required                    |
|---------------|----------------|-------------------------------------------|
| None          | `none`         | No camera integration                      |
| ONVIF         | `onvif`        | Auto-discovered on local network           |
| Genetec VMS   | `genetec-vms`  | `GENETEC_VMS_URL`                          |

### Threat Intelligence (ZeroEyes)

ZeroEyes provides AI-powered weapon detection via camera feeds. Configure the webhook:

1. Set `ZEROEYES_WEBHOOK_SECRET` in your environment.
2. In the ZeroEyes dashboard, configure the webhook URL: `https://api.example.com/webhooks/zeroeyes`
3. High-confidence detections automatically create ACTIVE_THREAT alerts and trigger lockdown.

---

## Floor Plan Editor

The floor plan editor allows you to position rooms and doors on a building map for visual situational awareness during incidents.

### Updating Floor Plan Positions

1. Navigate to **Sites > [Your Site] > Floor Plans**.
2. Drag rooms and doors to their correct positions on the map.
3. Save positions.

Positions are stored as `mapX`, `mapY`, `mapW`, `mapH` (rooms) and `mapX`, `mapY` (doors).

The floor plan is accessible via the API:
```
PUT /api/v1/sites/:id/floor-plan
```

---

## Drill Management and Compliance

SafeSchool tracks safety drills to ensure compliance with Alyssa's Law and state regulations.

### Drill Types

| Type           | Alyssa's Law Minimum | Description                          |
|----------------|----------------------|--------------------------------------|
| LOCKDOWN       | 2 per year           | Full lockdown practice               |
| FIRE           | 2 per year           | Fire evacuation drill                |
| EVACUATION     | 1 per year           | Building evacuation drill            |
| ACTIVE_THREAT  | 1 per year           | Active threat response drill         |

### Scheduling a Drill

1. Navigate to **Drills > Schedule New Drill**.
2. Select the drill type, date/time, and optional building scope.
3. Save. The drill appears in the schedule with status `SCHEDULED`.

### Running a Drill

1. When ready, update the drill status to `IN_PROGRESS`.
2. Add participants and mark attendance as staff check in.
3. When complete, set status to `COMPLETED` and record:
   - Evacuation time (seconds)
   - Head count
   - Issues encountered
   - Whether compliance was met

### Compliance Report

Navigate to **Drills > Compliance Report** to view a summary of completed drills for the current year against Alyssa's Law requirements. The report shows:
- Number completed vs. required for each drill type
- Overall compliance status
- Historical drill records

---

## Visitor Management

### Visitor Workflow

```
Pre-Register --> Check-In --> Screening --> Badge Issued --> Check-Out
```

### Pre-Registering Visitors

Staff can pre-register expected visitors with:
- First name, last name
- Purpose of visit
- Destination (room/area)
- Host (staff member)
- ID type and number (hashed for privacy)

### Kiosk Check-In

The kiosk application (`apps/kiosk/`) provides a self-service check-in flow:
1. Visitor scans ID
2. System checks against sex offender database (NSOPW via screening adapter)
3. Visitor confirms details
4. Badge prints automatically
5. Host is notified

### Monitoring Active Visitors

The dashboard Visitor page shows:
- Currently checked-in visitors
- Check-in/check-out history
- Screening status and flags

### Check-Out

Visitors check out via the kiosk or are manually checked out by staff. The system tracks total visit duration.

---

## Transportation Tracking

When `TRANSPORT_TRACKING_ENABLED=true`, the platform tracks school buses with GPS and RFID student scanning.

### Bus Management

1. **Register buses** -- Add bus number, driver, capacity, and equipment flags (RFID reader, panic button, cameras).
2. **Create routes** -- Define route name, number, schedule times, and ordered stops with GPS coordinates.
3. **Assign students** -- Link student RFID cards to routes and stops.
4. **Add parent contacts** -- Register parent phone/email for notifications.

### Real-Time Tracking

- **GPS Updates** -- Bus hardware sends GPS coordinates via `POST /api/v1/transportation/gps`. The system detects geofence arrivals/departures.
- **RFID Scans** -- Student board/exit events via `POST /api/v1/transportation/scan`. Parents receive instant notifications.
- **Missed Bus Detection** -- If a student's assigned stop passes without a scan, the system alerts parents.

### Parent Notification Preferences

Parents can configure which alerts they receive:
- Board/exit alerts
- ETA alerts
- Delay alerts
- Missed bus alerts
- Channel preferences (SMS, email, push)

---

## Threat Assessment

The Behavioral Threat Assessment module uses CSTAG-based risk scoring to evaluate reported threats.

### Submitting a Report

1. Navigate to **Threat Assessments > New Report**.
2. Enter subject information, category, description, and evidence.
3. Select risk factors for CSTAG scoring.
4. The system automatically calculates the risk level.

### Risk Levels and Auto-Actions

| Risk Level | Auto-Action                                           |
|------------|-------------------------------------------------------|
| LOW        | Report saved, available for review                    |
| MODERATE   | Report saved, flagged for team review                 |
| HIGH       | Staff notified, review required within 24 hours       |
| IMMINENT   | Auto-escalated to law enforcement, ACTIVE_THREAT alert|

### Re-Scoring

Reports can be re-scored with updated risk factors at any time via the dashboard or API.

---

## Social Media Monitoring

Integrates with social media monitoring services (Bark, Gaggle) to detect concerning student behavior online.

### Alert Sources

| Source | Integration Method      |
|--------|-------------------------|
| Bark   | Webhook endpoint        |
| Gaggle | Webhook endpoint        |
| Manual | Dashboard form or API   |

### Reviewing Alerts

1. Navigate to **Social Media > Alerts**.
2. Review flagged content, severity, and student information.
3. Update status: NEW -> REVIEWING -> RESOLVED / DISMISSED.
4. Record action taken.

HIGH and CRITICAL severity alerts automatically notify staff.

### Webhook Configuration

Configure the social media provider to send webhooks to:
```
POST https://api.example.com/api/v1/social-media/webhook
```

---

## Anonymous Tips

The anonymous tip system allows students, parents, and community members to report safety concerns without authentication.

### How It Works

- Tips are submitted via `POST /api/v1/tips` (no authentication required).
- The submitter's IP address is hashed (not stored in cleartext) for abuse detection.
- HIGH and CRITICAL severity tips automatically notify site administrators.

### Reviewing Tips

1. Navigate to **Tips** in the dashboard (SITE_ADMIN access required).
2. Filter by status, category, or severity.
3. Update status: NEW -> REVIEWING -> INVESTIGATING -> RESOLVED / DISMISSED.
4. Add review notes.

### Tip Categories

- Bullying
- Weapons
- Drugs
- Self-harm
- Suspicious activity
- Other

---

## Environmental Monitoring

Track environmental conditions from sensors placed throughout the facility.

### Sensor Types

- Air quality (AQI, CO2, particulates)
- Temperature
- Humidity
- Water leak detection
- Smoke/fire detection

### Setup

1. Register sensors via **Environmental > Add Sensor**.
2. Configure the sensor hardware to post readings to `POST /api/v1/environmental/readings`.
3. Set alert thresholds per sensor.

### Monitoring

The **Environmental > Status** page shows:
- Total sensors and online count
- Active alerts (readings that exceed thresholds)
- Last reading for each sensor

Alert readings automatically trigger system notifications.

---

## Reunification

The reunification module manages student-guardian release during or after an emergency.

### Starting a Reunification Event

1. Navigate to **Reunification > Start Event**.
2. Enter the reunification location and (optionally) the triggering alert.
3. Add students as they arrive at the reunification point.

### Releasing Students

1. Select a student entry.
2. Enter guardian name and verify ID.
3. Mark as released. The system tracks who released each student and when.

### Completing the Event

When all students are accounted for, set the event status to COMPLETED. The system records:
- Total students processed
- Total reunified
- Time to completion
- Per-student release records

---

## Notifications

### Mass Notifications

Operators can send mass notifications to staff or parents:

1. Navigate to **Notifications > Send**.
2. Select channels (SMS, Email, Push, PA).
3. Choose recipient scope: all staff, all parents, or specific users.
4. Write the message and send.

The notification is queued as a background job and delivery status is logged.

### Test Notifications

Send a test notification to verify your notification adapter configuration:

1. Navigate to **Notifications > Test**.
2. A test message will be sent to your own phone/email.

### Notification History

All sent notifications are logged with recipient count, delivery status, and timestamps. View history at **Notifications > Log**.

---

## Reports and Analytics

### Available Reports

| Report                  | Location                              | Description                          |
|-------------------------|---------------------------------------|--------------------------------------|
| Drill Compliance        | Drills > Compliance Report            | Alyssa's Law drill requirements      |
| Alert History           | Alerts                                | All alerts with status and timeline  |
| Visitor Log             | Visitors                              | Check-in/check-out history           |
| Notification History    | Notifications > Log                   | All sent notifications               |
| Audit Log               | Admin > Audit Log                     | All system actions with user/timestamp|
| Threat Assessment Stats | Threat Assessments > Dashboard        | Reports by status and risk level     |
| Social Media Stats      | Social Media > Dashboard              | Alerts by source, severity, status   |
| Environmental Status    | Environmental > Status                | Sensor health and recent readings    |
| Grant Opportunities     | Grants > Search                       | Matching federal/state grants        |
| Funding Estimates       | Grants > Estimate                     | Projected funding by module          |

### Audit Log

Every action in the system is recorded in the audit log with:
- Timestamp
- User who performed the action
- Action type (e.g., LOCKDOWN_INITIATED, VISITOR_PRE_REGISTERED)
- Entity type and ID
- Additional details
- IP address

Access the audit log at **Admin > Audit Log**. Filter by action, entity type, or user.

---

## Troubleshooting

### API Returns 502 (Railway)

Railway routes traffic based on the Dockerfile `EXPOSE` directive. Ensure `PORT=3000` is set as a build variable for each service.

### WebSocket Connection Fails

1. Verify the JWT token is valid and not expired.
2. Check that the WebSocket URL includes the token: `wss://api.example.com/ws?token=JWT_TOKEN`
3. Ensure `CORS_ORIGINS` includes the dashboard URL.

### Lockdown Release Blocked

Lockdown release (`DELETE /api/v1/lockdown/:id`) is restricted to edge devices only. This is a safety measure -- lockdowns must be released from the on-site mini PC, not remotely from the cloud. The response will include error code `EDGE_ONLY_OPERATION`.

### Notifications Not Sending

1. Verify the notification adapter env vars are correctly set.
2. Send a test notification via **Notifications > Test**.
3. Check the worker logs: `docker compose logs -f worker`
4. Verify the Redis connection is healthy: `curl https://api.example.com/ready`

### Edge Not Syncing to Cloud

1. Check `CLOUD_SYNC_URL` and `CLOUD_SYNC_KEY` are set in the edge `.env`.
2. Verify internet connectivity from the mini PC.
3. Check API logs for sync errors: `docker compose logs -f api | grep sync`
4. The edge operates in STANDALONE mode when sync is unavailable -- data queues locally.

### Cameras Show "Service Unavailable"

1. Verify `CAMERA_ADAPTER` is set (not `none`).
2. For ONVIF cameras, ensure the mini PC is on the same network.
3. For Genetec VMS, verify `GENETEC_VMS_URL` is reachable.
4. Camera routes return 503 with a descriptive error message when the adapter fails.

### Database Migration Fails

1. Check the `migrate` container logs: `docker compose logs migrate`
2. Verify `DATABASE_URL` is correctly set.
3. For manual recovery: `npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma`

### Docker Containers Keep Restarting

```bash
# Check container status
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml ps

# View logs for the failing container
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml logs api

# Common causes:
# - DATABASE_URL not set or incorrect
# - REDIS_URL not set or incorrect
# - Port conflicts (another service on port 443/3000)
# - Insufficient memory (minimum 4 GB recommended)
```

### Reset Admin Password

If you lose access to the admin account, re-run the seed script on the API container:

```bash
# Edge
docker compose -f /opt/safeschool/deploy/edge/docker-compose.yml exec api \
  node -e "const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcryptjs'); const p = new PrismaClient(); (async () => { await p.user.update({ where: { email: 'bwattendorf@gmail.com' }, data: { passwordHash: bcrypt.hashSync('safeschool123', 10) } }); console.log('Password reset'); await p.\$disconnect(); })()"
```
