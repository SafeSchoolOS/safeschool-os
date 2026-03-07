#!/usr/bin/env node
/**
 * Cloud <-> PAC Emulator Sync Bridge
 *
 * Connects a SafeSchoolOS cloud dashboard to a PAC (Physical Access Control)
 * emulator using HMAC-signed sync push for events, doors, cameras, and cardholders.
 *
 * This is useful for:
 * - Demo environments with simulated access control hardware
 * - Integration testing with vendor PAC systems
 * - Development without physical hardware
 *
 * Configuration via environment variables:
 *   CLOUD_SYNC_KEY    - Required. HMAC key for sync authentication.
 *   PAC_TOKEN         - Required. Bearer token for PAC emulator API.
 *   CLOUD_URL         - Cloud dashboard URL (default: https://edge.safeschool.org)
 *   PAC_URL           - PAC emulator URL (default: http://localhost:8080)
 *   ORG_ID            - Organization ID (default: demo)
 *   SYNC_INTERVAL     - Sync interval in ms (default: 30000)
 *   PORT              - Health endpoint port (default: 3000)
 *
 * Deploy as a Docker container or Railway worker service.
 */

import crypto from 'node:crypto';
import http from 'node:http';

const SYNC_KEY = process.env.CLOUD_SYNC_KEY;
if (!SYNC_KEY) { console.error('ERROR: Set CLOUD_SYNC_KEY env var'); process.exit(1); }
const PAC_TOKEN = process.env.PAC_TOKEN;
if (!PAC_TOKEN) { console.error('ERROR: Set PAC_TOKEN env var'); process.exit(1); }

const CLOUD_URL = process.env.CLOUD_URL || 'https://edge.safeschool.org';
const PAC_URL = process.env.PAC_URL || 'http://localhost:8080';
const ORG_ID = process.env.ORG_ID || 'demo';
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL || '30000', 10);
const PORT = process.env.PORT || 3000;

const SERVICE = { name: 'SafeSchool', cloudUrl: CLOUD_URL, pacUrl: PAC_URL, orgId: ORG_ID };

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// ── HMAC helpers ────────────────────────────────────────────

function hmacFetch(path, body) {
  const bodyStr = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = crypto
    .createHmac('sha256', SYNC_KEY)
    .update(`${timestamp}.POST.${path}.${bodyStr}`)
    .digest('hex');

  return fetch(`${CLOUD_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-key': SYNC_KEY,
      'x-sync-timestamp': timestamp,
      'x-sync-signature': signature,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15000),
  }).then(r => r.json());
}

const SITE_ID = `pac-bridge-safeschool`;

function hmacHeartbeat() {
  return hmacFetch('/api/v1/sync/heartbeat', {
    siteId: SITE_ID,
    orgId: ORG_ID,
    mode: 'CLOUD_BRIDGE',
    pendingChanges: 0,
    version: '1.0.0',
    hostname: 'pac-bridge',
  });
}

function hmacPush(entities) {
  return hmacFetch('/api/v1/sync/push', { siteId: SITE_ID, entities });
}

// ── PAC fetch ───────────────────────────────────────────────

async function pacGet(url) {
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${PAC_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// ── Sync functions ──────────────────────────────────────────

async function syncCardholders() {
  const data = await pacGet(`${PAC_URL}/api/v1/cardholders`);
  if (!data?.items) return 0;

  const entities = data.items.map(ch => ({
    type: 'cardholder',
    action: 'update',
    data: {
      id: `pac-${ch.ID}`,
      firstName: ch.FIRSTNAME || 'Unknown',
      lastName: ch.LASTNAME || 'Person',
      badgeNumber: ch.SSNO || '',
      personType: 'STAFF',
      isActive: ch.STATUS === 1,
      externalId: ch.ID,
      accessLevels: ch.accessLevels || [],
    },
    timestamp: new Date().toISOString(),
  }));

  const result = await hmacPush(entities);
  return result.synced || 0;
}

let lastEventTs = '';
const seenEventIds = new Set();

async function syncEvents() {
  let url = `${PAC_URL}/api/v1/events?limit=50`;
  if (lastEventTs) {
    url += `&since=${encodeURIComponent(lastEventTs)}`;
  }

  const data = await pacGet(url);
  const events = data?.events || [];
  if (events.length === 0) return 0;

  const accessEvents = events.filter(e =>
    e.event_type && (
      e.event_type.startsWith('access_') ||
      e.event_type === 'door_forced_open' ||
      e.event_type === 'door_held_open'
    ) && !seenEventIds.has(e.id)
  );

  if (accessEvents.length === 0) {
    updateLastTs(events);
    return 0;
  }

  const entities = accessEvents.map(e => {
    seenEventIds.add(e.id);
    return {
      type: 'access_event',
      action: 'create',
      data: {
        id: e.id,
        eventType: e.event_type,
        doorName: e.door_name || 'Unknown',
        doorId: e.door_id || '',
        userName: e.cardholder_name || 'Unknown',
        badgeId: e.badge_number || '',
        accessGranted: e.access_granted === true,
        timestamp: e.timestamp,
        severity: e.severity || 'info',
        source: 'pac-emulator',
        connectorType: 'lenel-onguard',
      },
      timestamp: e.timestamp,
    };
  });

  let synced = 0;
  for (let i = 0; i < entities.length; i += 100) {
    const batch = entities.slice(i, i + 100);
    const result = await hmacPush(batch);
    synced += result.synced || 0;
  }

  updateLastTs(events);
  if (seenEventIds.size > 5000) {
    const arr = [...seenEventIds];
    seenEventIds.clear();
    arr.slice(-2000).forEach(id => seenEventIds.add(id));
  }

  return synced;
}

function updateLastTs(events) {
  const latest = events.reduce((max, e) => {
    const t = e.timestamp || '';
    return t > max ? t : max;
  }, lastEventTs);
  if (latest) lastEventTs = latest;
}

async function syncDoors() {
  const resp = await fetch(`${PAC_URL}/admin/state`, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) return 0;
  const state = await resp.json();
  const doors = state.doors || [];
  if (doors.length === 0) return 0;

  const entities = doors.map(d => ({
    type: 'door_status',
    action: 'update',
    data: {
      id: d.id,
      name: d.name,
      status: (d.status || 'locked').toUpperCase(),
      mode: d.mode || 'card_only',
      location: d.location || '',
      panelId: d.panelId,
    },
    timestamp: new Date().toISOString(),
  }));

  const result = await hmacPush(entities);
  return result.synced || 0;
}

async function syncCameras() {
  const resp = await fetch(`${PAC_URL}/admin/state`, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) return 0;
  const state = await resp.json();
  const cameras = state.cameras || [];
  if (cameras.length === 0) return 0;

  const entities = cameras.map(c => ({
    type: 'camera_status',
    action: 'update',
    data: {
      id: c.id || c.name,
      name: c.name || 'Camera',
      status: (c.status || 'online').toUpperCase(),
      recording: c.recording || false,
      type: c.type || 'fixed',
      resolution: c.resolution || '1920x1080',
      ptzCapable: c.ptzCapable || false,
      location: c.location || '',
      associatedDoorId: c.associatedDoorId || '',
      manufacturer: c.manufacturer || 'Unknown',
      model: c.model || 'Unknown',
      lastSeen: new Date().toISOString(),
      snapshotUrl: `${PAC_URL}/vms/cameras/${c.id || c.name}/snapshot`,
      streamUrl: `${PAC_URL}/vms/cameras/${c.id || c.name}/stream`,
    },
    timestamp: new Date().toISOString(),
  }));

  const result = await hmacPush(entities);
  return result.synced || 0;
}

// ── Main ────────────────────────────────────────────────────

const stats = {};

async function syncAll() {
  try {
    const hb = await hmacHeartbeat();
    if (!hb.ack) {
      log('Heartbeat failed:', JSON.stringify(hb));
      return;
    }

    const [ch, ev, doors, cams] = await Promise.all([
      syncCardholders().catch(e => { log('Cardholder err:', e.message); return 0; }),
      syncEvents().catch(e => { log('Event err:', e.message); return 0; }),
      syncDoors().catch(e => { log('Door err:', e.message); return 0; }),
      syncCameras().catch(e => { log('Camera err:', e.message); return 0; }),
    ]);

    Object.assign(stats, { cardholders: ch, events: ev, doors, cameras: cams, lastSync: new Date().toISOString() });
    log(`Synced: ${ch} cardholders, ${ev} events, ${doors} doors, ${cams} cameras`);
  } catch (e) {
    log('Sync error:', e.message);
    stats.lastError = e.message;
    stats.lastErrorAt = new Date().toISOString();
  }
}

// Health endpoint
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', stats, uptime: process.uptime() }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('PAC Sync Bridge running');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Health endpoint on port ${PORT}`);
});

log('PAC Sync Bridge');
log(`  Cloud: ${CLOUD_URL}`);
log(`  PAC:   ${PAC_URL}`);
log(`  Org:   ${ORG_ID}`);
log(`  Interval: ${SYNC_INTERVAL / 1000}s`);

// Initial sync
await syncAll();

// Ongoing sync
setInterval(syncAll, SYNC_INTERVAL);
