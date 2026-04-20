// @ts-nocheck
/**
 * Demo Seed — Populates database with initial entity data from a recipe.
 *
 * Creates doors, cameras, cardholders, and visitors in sync_entities
 * and access_events tables so the dashboard has data on first load.
 *
 * Uses the same DB patterns as pac-emulator.ts — direct PostgreSQL writes
 * to access_events and sync_entities tables.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { DemoRecipe, ZoneDef, RoleDef } from '../../../adapters/emulators/recipes/types.js';
import type { SyncDatabaseAdapter } from './types.js';

const log = createLogger('cloud-sync:demo-seed');

// ─── Name Data (compact, no external deps) ──────────────────────────

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Emily', 'Andrew', 'Donna', 'Kenneth', 'Michelle', 'Joshua', 'Carol',
  'Kevin', 'Amanda', 'Brian', 'Dorothy', 'George', 'Melissa', 'Timothy', 'Deborah',
  'Ronald', 'Stephanie', 'Jason', 'Rebecca', 'Ryan', 'Sharon', 'Jacob', 'Laura',
  'Gary', 'Cynthia', 'Nicholas', 'Kathleen', 'Eric', 'Amy', 'Jonathan', 'Angela',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
  'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell',
  'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz',
];

const VISITOR_COMPANIES = [
  'Acme Corp', 'TechStart Inc', 'Global Services', 'FedEx', 'UPS', 'Amazon',
  'Sysco Foods', 'Aramark', 'Cintas', 'Office Depot', 'IT Solutions LLC',
];

const VISITOR_PURPOSES = [
  'Meeting', 'Delivery', 'Interview', 'Maintenance', 'Tour', 'Contractor',
  'Inspection', 'Vendor Demo', 'Audit', 'Parent Visit', 'Emergency Repair',
];

const CAMERA_MODELS = [
  'Axis P3245-LVE', 'Axis M3106-L', 'vendor CD52', 'vendor CD42',
  'Bosch FlexiDome', 'Avigilon H5A', 'Hanwha XNV-8080R',
];

// ─── Helpers ──────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function badgeNumber(): string {
  return String(10000 + Math.floor(Math.random() * 90000));
}

function phone(): string {
  return `555-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function pastDate(maxDaysAgo: number): Date {
  return new Date(Date.now() - Math.floor(Math.random() * maxDaysAgo * 86400000));
}

// ─── Entity Builders ─────────────────────────────────────────────────

interface SeededDoor {
  id: string;
  name: string;
  zone: string;
  building: string;
  status: string;
  type: string;
}

interface SeededCamera {
  id: string;
  name: string;
  zone: string;
  building: string;
  status: string;
  manufacturer: string;
  model: string;
}

interface SeededCardholder {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  role: string;
  department: string;
  badgeNumber: string;
  zones: string[];
  status: string;
}

interface SeededVisitor {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  purpose: string;
  hostName: string;
  badgeNumber: string;
  status: string;
  checkedInAt: string;
}

function buildDoors(recipe: DemoRecipe): SeededDoor[] {
  const doors: SeededDoor[] = [];
  let idx = 0;
  for (const zone of recipe.zones) {
    const building = zone.building || recipe.buildings[0]?.name || 'Main Building';
    for (let d = 0; d < zone.doors; d++) {
      idx++;
      const doorName = zone.doors === 1
        ? `${zone.name} Door`
        : `${zone.name} - Door ${d + 1}`;
      doors.push({
        id: `door-${String(idx).padStart(4, '0')}`,
        name: doorName,
        zone: zone.name,
        building,
        status: Math.random() > 0.02 ? 'LOCKED' : 'UNLOCKED',
        type: zone.access === 'OPEN' ? 'ENTRANCE' : zone.access === 'RESTRICTED' ? 'RESTRICTED' : 'INTERIOR',
      });
    }
  }
  return doors;
}

function buildCameras(recipe: DemoRecipe): SeededCamera[] {
  const cameras: SeededCamera[] = [];
  let idx = 0;
  for (const zone of recipe.zones) {
    const count = zone.cameraCount || 0;
    const building = zone.building || recipe.buildings[0]?.name || 'Main Building';
    for (let c = 0; c < count; c++) {
      idx++;
      cameras.push({
        id: `cam-${String(idx).padStart(4, '0')}`,
        name: `CAM-${String(idx).padStart(3, '0')} ${zone.name}`,
        zone: zone.name,
        building,
        status: Math.random() > 0.03 ? 'ONLINE' : 'OFFLINE',
        manufacturer: pick(['Axis', 'vendor', 'Bosch', 'Avigilon', 'Hanwha']),
        model: pick(CAMERA_MODELS),
      });
    }
  }
  return cameras;
}

function buildCardholders(recipe: DemoRecipe): SeededCardholder[] {
  const cardholders: SeededCardholder[] = [];
  const staff = recipe.people.staff;
  if (!staff) return cardholders;

  let idx = 0;
  for (const roleDef of staff.roles) {
    for (let r = 0; r < roleDef.count; r++) {
      idx++;
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      cardholders.push({
        id: `ch-${String(idx).padStart(5, '0')}`,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        role: roleDef.role,
        department: roleDef.role,
        badgeNumber: badgeNumber(),
        zones: roleDef.zones,
        status: Math.random() > 0.03 ? 'ACTIVE' : 'SUSPENDED',
      });
    }
  }
  return cardholders;
}

function buildVisitors(recipe: DemoRecipe): SeededVisitor[] {
  const visitors: SeededVisitor[] = [];
  const visitorConfig = recipe.people.visitors;
  // Seed a few active visitors
  const count = visitorConfig ? Math.min(visitorConfig.perHour * 2, 20) : 5;

  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const isCheckedIn = i < Math.ceil(count * 0.4); // 40% still checked in
    visitors.push({
      id: `vis-${String(i + 1).padStart(4, '0')}`,
      firstName,
      lastName,
      company: pick(VISITOR_COMPANIES),
      purpose: visitorConfig?.types ? pick(visitorConfig.types) : pick(VISITOR_PURPOSES),
      hostName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      badgeNumber: `V-${String(i + 1).padStart(4, '0')}`,
      status: isCheckedIn ? 'CHECKED_IN' : 'CHECKED_OUT',
      checkedInAt: pastDate(1).toISOString(),
    });
  }
  return visitors;
}

// ─── Database Writer ─────────────────────────────────────────────────

export interface SeedResult {
  doors: number;
  cameras: number;
  cardholders: number;
  visitors: number;
  errors: number;
}

/**
 * Seed demo data into the database from a recipe definition.
 *
 * Writes entities to sync_entities table (same pattern as pac-emulator).
 * Requires a pg.Pool-compatible connection or a DATABASE_URL env var.
 */
export async function seedDemoData(
  pool: import('pg').Pool,
  recipe: DemoRecipe,
  orgId = 'demo',
): Promise<SeedResult> {
  const result: SeedResult = { doors: 0, cameras: 0, cardholders: 0, visitors: 0, errors: 0 };

  const doors = buildDoors(recipe);
  const cameras = buildCameras(recipe);
  const cardholders = buildCardholders(recipe);
  const visitors = buildVisitors(recipe);

  log.info({
    recipe: recipe.name,
    doors: doors.length,
    cameras: cameras.length,
    cardholders: cardholders.length,
    visitors: visitors.length,
  }, 'Seeding demo data from recipe');

  // ─── Seed Doors ───────────────────────────────────────────────
  for (const door of doors) {
    try {
      await pool.query(`
        INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
        VALUES ($1, 'door', $2, $3, $4, 'create', NOW(), NOW())
        ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $4, updated_at = NOW()
      `, [door.id, orgId, door.building, JSON.stringify({
        id: door.id,
        name: door.name,
        zone: door.zone,
        building: door.building,
        status: door.status,
        type: door.type,
        lastEvent: new Date().toISOString(),
        readerCount: Math.random() > 0.3 ? 2 : 1,
        hasRex: true,
      })]);
      result.doors++;
    } catch (err) {
      log.warn({ err, door: door.id }, 'Failed to seed door');
      result.errors++;
    }
  }

  // ─── Seed Cameras ─────────────────────────────────────────────
  for (const cam of cameras) {
    try {
      await pool.query(`
        INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
        VALUES ($1, 'camera', $2, $3, $4, 'create', NOW(), NOW())
        ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $4, updated_at = NOW()
      `, [cam.id, orgId, cam.building, JSON.stringify({
        id: cam.id,
        name: cam.name,
        zone: cam.zone,
        building: cam.building,
        status: cam.status,
        manufacturer: cam.manufacturer,
        model: cam.model,
        location: cam.zone,
        streamUrl: `rtsp://emulator:554/${cam.id}`,
        resolution: pick(['1080p', '4K', '4K']),
        capabilities: {
          ptz: Math.random() > 0.7,
          audio: Math.random() > 0.5,
          analytics: Math.random() > 0.4,
        },
      })]);
      result.cameras++;
    } catch (err) {
      log.warn({ err, camera: cam.id }, 'Failed to seed camera');
      result.errors++;
    }
  }

  // ─── Seed Cardholders ─────────────────────────────────────────
  for (const ch of cardholders) {
    try {
      await pool.query(`
        INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
        VALUES ($1, 'cardholder', $2, 'default', $3, 'create', NOW(), NOW())
        ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $3, updated_at = NOW()
      `, [ch.id, orgId, JSON.stringify({
        id: ch.id,
        firstName: ch.firstName,
        lastName: ch.lastName,
        name: ch.name,
        role: ch.role,
        department: ch.department,
        badgeNumber: ch.badgeNumber,
        email: `${ch.firstName.toLowerCase()}.${ch.lastName.toLowerCase()}@example.com`,
        phone: phone(),
        status: ch.status,
        zones: ch.zones,
        createdAt: pastDate(365).toISOString(),
      })]);
      result.cardholders++;
    } catch (err) {
      log.warn({ err, cardholder: ch.id }, 'Failed to seed cardholder');
      result.errors++;
    }
  }

  // ─── Seed Visitors ────────────────────────────────────────────
  for (const vis of visitors) {
    try {
      await pool.query(`
        INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
        VALUES ($1, 'visitor', $2, 'default', $3, 'create', NOW(), NOW())
        ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $3, updated_at = NOW()
      `, [vis.id, orgId, JSON.stringify({
        id: vis.id,
        firstName: vis.firstName,
        lastName: vis.lastName,
        name: `${vis.firstName} ${vis.lastName}`,
        company: vis.company,
        purpose: vis.purpose,
        hostName: vis.hostName,
        badgeNumber: vis.badgeNumber,
        status: vis.status,
        checkedInAt: vis.checkedInAt,
        checkedOutAt: vis.status === 'CHECKED_OUT' ? new Date().toISOString() : null,
        phone: phone(),
      })]);
      result.visitors++;
    } catch (err) {
      log.warn({ err, visitor: vis.id }, 'Failed to seed visitor');
      result.errors++;
    }
  }

  log.info(result, 'Demo data seeded from recipe');
  return result;
}

// ─── Exported builders (used by DemoEmulator for live event gen) ─────

export { buildDoors, buildCameras, buildCardholders, buildVisitors };
export type { SeededDoor, SeededCamera, SeededCardholder, SeededVisitor };
