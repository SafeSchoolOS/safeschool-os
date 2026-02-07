# SafeSchool System Architecture

## Overview

SafeSchool follows a **hub-and-spoke architecture** with redundancy at every layer. The cloud instance (Railway) serves as the primary hub for management, reporting, and multi-site coordination. Each school site runs a local edge node (mini PC) that can operate independently.

## Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │      RAILWAY CLOUD HUB      │
                          │                             │
                          │  ┌──────────┐ ┌──────────┐ │
                          │  │ API      │ │ Dashboard│ │
                          │  │ Server   │ │ (React)  │ │
                          │  └────┬─────┘ └──────────┘ │
                          │       │                     │
                          │  ┌────┴─────┐ ┌──────────┐ │
                          │  │PostgreSQL│ │  Redis   │ │
                          │  │          │ │ (PubSub) │ │
                          │  └──────────┘ └──────────┘ │
                          └──────────┬──────────────────┘
                                     │
                          Encrypted WebSocket + REST
                          (with cellular failover)
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────┴──────────┐ ┌────────┴───────────┐ ┌───────┴──────────┐
    │   SCHOOL SITE A    │ │   SCHOOL SITE B    │ │   SCHOOL SITE C  │
    │   (Mini PC Edge)   │ │   (Mini PC Edge)   │ │   (Mini PC Edge) │
    │                    │ │                    │ │                  │
    │ ┌──────┐ ┌──────┐ │ │                    │ │                  │
    │ │API   │ │Sync  │ │ │      (same)        │ │     (same)       │
    │ │Local │ │Engine│ │ │                    │ │                  │
    │ └──┬───┘ └──────┘ │ │                    │ │                  │
    │    │               │ │                    │ │                  │
    │ ┌──┴───┐ ┌──────┐ │ │                    │ │                  │
    │ │PgSQL │ │Redis │ │ │                    │ │                  │
    │ │Local │ │Local │ │ │                    │ │                  │
    │ └──────┘ └──────┘ │ │                    │ │                  │
    └────────┬───────────┘ └────────────────────┘ └──────────────────┘
             │
    ┌────────┼────────────────────────────────────┐
    │        │           SCHOOL NETWORK           │
    │  ┌─────┴──────┐  ┌───────────┐  ┌────────┐ │
    │  │ BLE Mesh   │  │  Access   │  │ Camera │ │
    │  │ (Wearables)│  │  Control  │  │  VMS   │ │
    │  └────────────┘  └───────────┘  └────────┘ │
    │  ┌────────────┐  ┌───────────┐  ┌────────┐ │
    │  │Badge Kiosk │  │ PA System │  │ Fire   │ │
    │  │(Visitors)  │  │           │  │ Panel  │ │
    │  └────────────┘  └───────────┘  └────────┘ │
    └─────────────────────────────────────────────┘
```

## Redundancy Design

### 911 Dispatch - Dual Path
```
Alert Triggered
      │
      ├──► Path 1: Edge Mini PC ──► RapidSOS API ──► Local 911 PSAP
      │                          ──► Direct SIP Call ──► 911
      │
      └──► Path 2: Cloud (Railway) ──► Rave 911 Suite ──► Local 911 PSAP
                                    ──► Backup PSAP
```

Both paths fire simultaneously. If either path confirms receipt, the alert is considered delivered. If neither confirms within 10 seconds, the cellular failover activates a direct cellular 911 call from the on-site modem.

### Network Failover
```
Primary:   School Ethernet ──► ISP ──► Internet ──► Railway
Failover:  Cellular Modem (Cradlepoint/Peplink) ──► 4G/5G ──► Internet ──► Railway
Standalone: Edge operates independently, queues sync data
```

### Data Redundancy
- PostgreSQL on Railway (cloud) - primary data store
- PostgreSQL on Mini PC (edge) - local replica with independent operation
- Redis on both layers for real-time pub/sub and caching
- Conflict resolution: Last-write-wins for config, append-only for alerts/events

## Integration Architecture

All third-party integrations use an **adapter pattern**:

```typescript
interface IntegrationAdapter {
  name: string;
  type: 'access-control' | 'dispatch' | 'cameras' | 'notifications' | 'threat-intel' | 'visitor-mgmt';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

interface AccessControlAdapter extends IntegrationAdapter {
  lockDoor(doorId: string): Promise<void>;
  unlockDoor(doorId: string): Promise<void>;
  lockdownBuilding(buildingId: string): Promise<void>;
  getDoorStatus(doorId: string): Promise<DoorStatus>;
  getAllDoorStatuses(): Promise<Map<string, DoorStatus>>;
}

interface DispatchAdapter extends IntegrationAdapter {
  sendAlert(alert: Alert): Promise<DispatchRecord>;
  getStatus(dispatchId: string): Promise<DispatchStatus>;
  cancelAlert(dispatchId: string): Promise<void>;
}
```

This allows schools to mix and match vendors while the core platform remains vendor-agnostic.

## Event Flow: Panic Alert

```
1. Teacher presses wearable panic button
2. BLE signal received by nearest beacon → room-level location determined
3. Edge API receives alert via BLE gateway
4. Alert engine processes:
   a. Validate alert (debounce, prevent duplicates)
   b. Determine alert level (configurable per activation type)
   c. Persist to local DB
   d. Publish to Redis pub/sub
5. Parallel actions triggered:
   a. 911 Dispatch (dual-path: edge direct + cloud backup)
   b. Access Control lockdown (if configured for alert level)
   c. Mass notification (SMS/email/push to staff, push to first responders)
   d. Camera integration (start recording, tag footage)
   e. Dashboard update (WebSocket push to all connected clients)
   f. Sync to cloud (if connectivity available)
6. Dashboard shows real-time alert with:
   - Location on floor plan
   - Camera feed from nearest cameras
   - Door status overlay
   - Responding officer locations (if available)
7. Auto-escalation timer starts (if no acknowledgment in X seconds)
```

## Security Considerations

- All API communication over TLS 1.3
- WebSocket connections authenticated with JWT
- Sync key rotation every 30 days
- Edge-to-cloud communication uses mutual TLS
- All PII encrypted at rest (AES-256)
- FERPA compliance for student data
- Audit log for all actions (immutable, append-only)
- Role-based access control (RBAC) with principle of least privilege
- No student data stored in cloud - stays on-site only
