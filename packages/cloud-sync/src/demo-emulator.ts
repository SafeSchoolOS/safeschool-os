// @ts-nocheck
/**
 * Demo Emulator — Recipe-driven live event engine for dashboards.
 *
 * Takes a DemoRecipe and generates a continuous stream of realistic events
 * that make the dashboard feel alive: door opens, access grants/denials,
 * visitor check-ins, camera motion, alarms, and emergency scenarios.
 *
 * Events are written directly to PostgreSQL (access_events + sync_entities)
 * using the same patterns as pac-emulator.ts.
 *
 * Usage:
 *   const emulator = new DemoEmulator(pool, recipe);
 *   await emulator.start();   // seeds data + begins event generation
 *   emulator.getStats();      // { eventsGenerated, uptime, currentRate }
 *   await emulator.stop();    // clears all timers
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { DemoRecipe, EmergencyDef, NormalScenario } from '../../../adapters/emulators/recipes/types.js';
import {
  seedDemoData,
  buildDoors,
  buildCameras,
  buildCardholders,
  buildVisitors,
  type SeededDoor,
  type SeededCamera,
  type SeededCardholder,
  type SeededVisitor,
} from './demo-seed.js';

const log = createLogger('cloud-sync:demo-emulator');

// ─── Event Types & Weights ──────────────────────────────────────────

/**
 * Associates an event type with a numeric weight and a generator function.
 * The weight controls how frequently this event type is selected relative to others
 * (e.g., access_granted at weight 80 is ~16x more likely than access_denied at weight 5).
 */
interface EventWeight {
  type: string;
  weight: number;
  generator: (ctx: EmulatorContext) => AccessEventRow | null;
}

interface AccessEventRow {
  id: string;
  event_type: string;
  timestamp: string;
  cardholder_id: string | null;
  cardholder_name: string | null;
  credential_type: string | null;
  door_id: string | null;
  door_name: string | null;
  reader_id: string | null;
  reader_name: string | null;
  facility_code: string | null;
  location: string;
  building: string;
  floor: string;
  zone: string;
  result: string;
  source_system: string;
  source_event_id: string | null;
  metadata: Record<string, unknown>;
  device_id: string | null;
  created_at: string;
}

interface EmulatorContext {
  doors: SeededDoor[];
  cameras: SeededCamera[];
  cardholders: SeededCardholder[];
  visitors: SeededVisitor[];
  recipe: DemoRecipe;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Select an event type using weighted random selection.
 *
 * Algorithm: compute cumulative weight sum, generate a random number in [0, total),
 * then walk the weight array subtracting each weight until the roll goes to zero.
 * This gives O(n) selection proportional to weight distribution.
 *
 * With default weights: ~80% access_granted, ~5% denied, ~3% each for
 * door_held/motion/visitor_in/alarm, ~2% visitor_out, ~1% door_forced.
 */
function pickWeighted(weights: EventWeight[]): EventWeight {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w;
  }
  return weights[weights.length - 1]!;
}

const DENY_REASONS = ['EXPIRED_BADGE', 'INVALID_ZONE', 'ANTI_PASSBACK', 'UNKNOWN_CARD', 'WRONG_TIME_ZONE', 'SUSPENDED_BADGE'];
const CREDENTIAL_TYPES = ['BADGE', 'BADGE_PIN', 'MOBILE', 'BIOMETRIC'];
const SOURCE_SYSTEMS = ['lenel-onguard', 'genetec', 'brivo', 'sicunet', 'verkada'];

// ─── Event Generators ────────────────────────────────────────────────
// Each generator creates a single AccessEventRow for its event type.
// Generators randomly select entities from the seeded caches (doors, cameras,
// cardholders, visitors) to produce realistic-looking event data.
// Returning null (genAlarmEvent) signals "skip this event" when no emergencies are defined.

/** Generate a successful badge swipe event at a random door by a random cardholder. */
function genAccessGranted(ctx: EmulatorContext): AccessEventRow {
  const door = pick(ctx.doors);
  const ch = pick(ctx.cardholders);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'access_granted',
    timestamp: now,
    cardholder_id: ch.id,
    cardholder_name: ch.name,
    credential_type: pick(CREDENTIAL_TYPES),
    door_id: door.id,
    door_name: door.name,
    reader_id: `${door.id}-reader-1`,
    reader_name: `${door.name} Reader`,
    facility_code: String(100 + Math.floor(Math.random() * 900)),
    location: door.zone,
    building: door.building,
    floor: '1',
    zone: door.zone,
    result: 'granted',
    source_system: pick(SOURCE_SYSTEMS),
    source_event_id: uuid(),
    metadata: { direction: Math.random() > 0.5 ? 'IN' : 'OUT', badgeNumber: ch.badgeNumber },
    device_id: null,
    created_at: now,
  };
}

/** Generate a denied access event with a random deny reason (expired badge, anti-passback, etc.). */
function genAccessDenied(ctx: EmulatorContext): AccessEventRow {
  const door = pick(ctx.doors.filter(d => d.type === 'RESTRICTED') || ctx.doors);
  const ch = pick(ctx.cardholders);
  const reason = pick(DENY_REASONS);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'access_denied',
    timestamp: now,
    cardholder_id: ch.id,
    cardholder_name: ch.name,
    credential_type: pick(CREDENTIAL_TYPES),
    door_id: door.id,
    door_name: door.name,
    reader_id: `${door.id}-reader-1`,
    reader_name: `${door.name} Reader`,
    facility_code: null,
    location: door.zone,
    building: door.building,
    floor: '1',
    zone: door.zone,
    result: 'denied',
    source_system: pick(SOURCE_SYSTEMS),
    source_event_id: uuid(),
    metadata: { reason, badgeNumber: ch.badgeNumber },
    device_id: null,
    created_at: now,
  };
}

/** Generate a door-held-open alarm (propped door, 30-150 second duration). */
function genDoorHeldOpen(ctx: EmulatorContext): AccessEventRow {
  const door = pick(ctx.doors);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'door_held_open',
    timestamp: now,
    cardholder_id: null,
    cardholder_name: null,
    credential_type: null,
    door_id: door.id,
    door_name: door.name,
    reader_id: null,
    reader_name: null,
    facility_code: null,
    location: door.zone,
    building: door.building,
    floor: '1',
    zone: door.zone,
    result: 'alarm',
    source_system: pick(SOURCE_SYSTEMS),
    source_event_id: uuid(),
    metadata: { durationSeconds: 30 + Math.floor(Math.random() * 120), severity: 'MEDIUM' },
    device_id: null,
    created_at: now,
  };
}

/** Generate a door-forced-open alarm (HIGH severity, requires acknowledgment). */
function genDoorForced(ctx: EmulatorContext): AccessEventRow {
  const door = pick(ctx.doors);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'door_forced',
    timestamp: now,
    cardholder_id: null,
    cardholder_name: null,
    credential_type: null,
    door_id: door.id,
    door_name: door.name,
    reader_id: null,
    reader_name: null,
    facility_code: null,
    location: door.zone,
    building: door.building,
    floor: '1',
    zone: door.zone,
    result: 'alarm',
    source_system: pick(SOURCE_SYSTEMS),
    source_event_id: uuid(),
    metadata: { severity: 'HIGH', requiresAck: true },
    device_id: null,
    created_at: now,
  };
}

/** Generate a visitor check-in event at the nearest ENTRANCE door. */
function genVisitorCheckIn(ctx: EmulatorContext): AccessEventRow {
  const vis = pick(ctx.visitors);
  const entryDoor = ctx.doors.find(d => d.type === 'ENTRANCE') || pick(ctx.doors);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'visitor_check_in',
    timestamp: now,
    cardholder_id: vis.id,
    cardholder_name: `${vis.firstName} ${vis.lastName}`,
    credential_type: 'VISITOR_BADGE',
    door_id: entryDoor.id,
    door_name: entryDoor.name,
    reader_id: null,
    reader_name: null,
    facility_code: null,
    location: entryDoor.zone,
    building: entryDoor.building,
    floor: '1',
    zone: entryDoor.zone,
    result: 'granted',
    source_system: 'visitor-management',
    source_event_id: uuid(),
    metadata: {
      company: vis.company,
      purpose: vis.purpose,
      hostName: vis.hostName,
      badgeNumber: vis.badgeNumber,
    },
    device_id: null,
    created_at: now,
  };
}

/** Generate a visitor check-out event (badge returned at exit door). */
function genVisitorCheckOut(ctx: EmulatorContext): AccessEventRow {
  const vis = pick(ctx.visitors);
  const exitDoor = ctx.doors.find(d => d.type === 'ENTRANCE') || pick(ctx.doors);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'visitor_check_out',
    timestamp: now,
    cardholder_id: vis.id,
    cardholder_name: `${vis.firstName} ${vis.lastName}`,
    credential_type: 'VISITOR_BADGE',
    door_id: exitDoor.id,
    door_name: exitDoor.name,
    reader_id: null,
    reader_name: null,
    facility_code: null,
    location: exitDoor.zone,
    building: exitDoor.building,
    floor: '1',
    zone: exitDoor.zone,
    result: 'granted',
    source_system: 'visitor-management',
    source_event_id: uuid(),
    metadata: { company: vis.company, badgeNumber: vis.badgeNumber },
    device_id: null,
    created_at: now,
  };
}

/** Generate a camera motion detection event with random confidence (0.7-1.0). */
function genCameraMotion(ctx: EmulatorContext): AccessEventRow {
  const cam = pick(ctx.cameras);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: 'camera_motion',
    timestamp: now,
    cardholder_id: null,
    cardholder_name: null,
    credential_type: null,
    door_id: null,
    door_name: null,
    reader_id: cam.id,
    reader_name: cam.name,
    facility_code: null,
    location: cam.zone,
    building: cam.building,
    floor: '1',
    zone: cam.zone,
    result: 'detected',
    source_system: 'vms',
    source_event_id: uuid(),
    metadata: { cameraId: cam.id, cameraName: cam.name, confidence: 0.7 + Math.random() * 0.3 },
    device_id: null,
    created_at: now,
  };
}

/** Generate an alarm event from the recipe's emergency definitions. Returns null if none defined. */
function genAlarmEvent(ctx: EmulatorContext): AccessEventRow | null {
  const emergencies = ctx.recipe.scenarios.emergencies;
  if (!emergencies || emergencies.length === 0) return null;

  const emergency = pick(emergencies);
  const door = pick(ctx.doors);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    event_type: emergency.type.toLowerCase(),
    timestamp: now,
    cardholder_id: null,
    cardholder_name: null,
    credential_type: null,
    door_id: door.id,
    door_name: door.name,
    reader_id: null,
    reader_name: null,
    facility_code: null,
    location: door.zone,
    building: door.building,
    floor: '1',
    zone: door.zone,
    result: 'alarm',
    source_system: 'alarm-panel',
    source_event_id: uuid(),
    metadata: {
      alarmType: emergency.type,
      response: emergency.response,
      severity: 'CRITICAL',
      durationMinutes: emergency.durationMinutes || 15,
      zones: emergency.zones || [],
    },
    device_id: null,
    created_at: now,
  };
}

// ─── Event Weight Table ──────────────────────────────────────────────
// Weights control the probability distribution of generated events.
// Total weight = 100 for easy mental math on percentages.
// access_granted dominates (80%) to simulate realistic traffic patterns
// where most badge swipes succeed. Anomalies (forced/held/alarm) are rare.

const EVENT_WEIGHTS: EventWeight[] = [
  { type: 'ACCESS_GRANTED',    weight: 80, generator: genAccessGranted },
  { type: 'ACCESS_DENIED',     weight: 5,  generator: genAccessDenied },
  { type: 'DOOR_HELD_OPEN',    weight: 3,  generator: genDoorHeldOpen },
  { type: 'DOOR_FORCED',       weight: 1,  generator: genDoorForced },
  { type: 'VISITOR_CHECK_IN',  weight: 3,  generator: genVisitorCheckIn },
  { type: 'VISITOR_CHECK_OUT', weight: 2,  generator: genVisitorCheckOut },
  { type: 'CAMERA_MOTION',     weight: 3,  generator: genCameraMotion },
  { type: 'ALARM',             weight: 3,  generator: genAlarmEvent },
];

// ─── Pattern Time Matching ───────────────────────────────────────────
// Recipes define time-of-day traffic patterns (e.g., "08:00-09:00" at 12 EPM
// for morning rush). These functions parse the time ranges and check whether
// the current wall clock falls within a pattern, returning the pattern's rate
// or the default base rate if no pattern matches.

interface ParsedTimeRange {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  rate: number;
  doors?: string[];
}

function parseTimeRange(pattern: { time: string; rate: number; doors?: string[] }): ParsedTimeRange | null {
  const match = pattern.time.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return {
    startHour: parseInt(match[1]!, 10),
    startMinute: parseInt(match[2]!, 10),
    endHour: parseInt(match[3]!, 10),
    endMinute: parseInt(match[4]!, 10),
    rate: pattern.rate,
    doors: pattern.doors,
  };
}

function isTimeInRange(now: Date, range: ParsedTimeRange): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = range.startHour * 60 + range.startMinute;
  const endMinutes = range.endHour * 60 + range.endMinute;
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function getCurrentRate(scenario: NormalScenario): number {
  if (!scenario.patterns || scenario.patterns.length === 0) {
    return scenario.eventsPerMinute;
  }

  const now = new Date();
  for (const pattern of scenario.patterns) {
    const range = parseTimeRange(pattern);
    if (range && isTimeInRange(now, range)) {
      return range.rate;
    }
  }

  return scenario.eventsPerMinute;
}

// ─── DemoEmulator Class ──────────────────────────────────────────────

export interface DemoEmulatorStats {
  eventsGenerated: number;
  uptime: number;       // milliseconds
  currentRate: number;   // events per minute
  doorsSeeded: number;
  camerasSeeded: number;
  cardholdersSeeded: number;
  visitorsSeeded: number;
  emergenciesTriggered: number;
  errors: number;
}

/**
 * Recipe-driven live event emulator for demo dashboards.
 *
 * Given a DemoRecipe (which defines buildings, zones, staff roles, visitor rates,
 * and emergency scenarios), the emulator:
 *   1. Seeds doors, cameras, cardholders, and visitors into PostgreSQL
 *   2. Runs a continuous event generation loop at the recipe's configured rate
 *   3. Adjusts event rate based on time-of-day patterns (morning rush, lunch, etc.)
 *   4. Periodically rolls against emergency probabilities to inject alarm events
 *
 * The generated events are written directly to the `access_events` table using
 * the same schema as real PAC connector data, so the dashboard displays them
 * identically to production events.
 */
export class DemoEmulator {
  private pool: import('pg').Pool;
  private recipe: DemoRecipe;
  private orgId: string;

  // Seeded entity caches
  private doors: SeededDoor[] = [];
  private cameras: SeededCamera[] = [];
  private cardholders: SeededCardholder[] = [];
  private visitors: SeededVisitor[] = [];

  // Runtime state
  private eventTimer: ReturnType<typeof setInterval> | null = null;
  private rateTimer: ReturnType<typeof setInterval> | null = null;
  private emergencyTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number = 0;
  private running = false;

  // Stats
  private stats = {
    eventsGenerated: 0,
    emergenciesTriggered: 0,
    errors: 0,
    doorsSeeded: 0,
    camerasSeeded: 0,
    cardholdersSeeded: 0,
    visitorsSeeded: 0,
  };

  // Current interval (recalculated on rate changes)
  private currentIntervalMs = 0;

  /**
   * @param pool - PostgreSQL connection pool for writing events and seeding entities.
   * @param recipe - Recipe definition that controls building layout, staff, and event patterns.
   * @param orgId - Organization ID for multi-tenant scoping (defaults to 'demo').
   */
  constructor(pool: import('pg').Pool, recipe: DemoRecipe, orgId = 'demo') {
    this.pool = pool;
    this.recipe = recipe;
    this.orgId = orgId;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /**
   * Initialize and start the demo emulator.
   *
   * Performs initial data seeding (doors, cameras, cardholders, visitors),
   * ensures the access_events table schema is compatible, then starts
   * three concurrent timers:
   *   - Event loop: generates events at the recipe's configured rate
   *   - Rate timer: recalculates event rate every 60s (time-of-day patterns)
   *   - Emergency timer: rolls against emergency probabilities every 60s
   *
   * Safe to call multiple times — subsequent calls are ignored if already running.
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('DemoEmulator already running, ignoring start()');
      return;
    }

    log.info({ recipe: this.recipe.name, vertical: this.recipe.vertical }, 'Starting demo emulator');

    // Build entity caches
    this.doors = buildDoors(this.recipe);
    this.cameras = buildCameras(this.recipe);
    this.cardholders = buildCardholders(this.recipe);
    this.visitors = buildVisitors(this.recipe);

    // Seed initial data
    try {
      const seedResult = await seedDemoData(this.pool, this.recipe, this.orgId);
      this.stats.doorsSeeded = seedResult.doors;
      this.stats.camerasSeeded = seedResult.cameras;
      this.stats.cardholdersSeeded = seedResult.cardholders;
      this.stats.visitorsSeeded = seedResult.visitors;
      this.stats.errors += seedResult.errors;
    } catch (err) {
      log.error({ err }, 'Failed to seed demo data — continuing with event generation');
      this.stats.errors++;
    }

    // Ensure access_events table exists and schema is compatible
    await this.ensureSchema();

    this.startedAt = Date.now();
    this.running = true;

    // Start event generation loop
    this.scheduleEventLoop();

    // Recalculate rate every 60 seconds (patterns may shift)
    this.rateTimer = setInterval(() => {
      if (this.running) this.scheduleEventLoop();
    }, 60_000);

    // Emergency event check every 60 seconds
    if (this.recipe.scenarios.emergencies && this.recipe.scenarios.emergencies.length > 0) {
      this.emergencyTimer = setInterval(() => {
        this.checkEmergencies();
      }, 60_000);
    }

    const rate = getCurrentRate(this.recipe.scenarios.normal);
    log.info({
      doors: this.doors.length,
      cameras: this.cameras.length,
      cardholders: this.cardholders.length,
      visitors: this.visitors.length,
      eventsPerMinute: rate,
    }, 'Demo emulator running');
  }

  /** Stop the emulator and clear all timers. Safe to call if already stopped. */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.eventTimer) {
      clearInterval(this.eventTimer);
      this.eventTimer = null;
    }
    if (this.rateTimer) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
    if (this.emergencyTimer) {
      clearInterval(this.emergencyTimer);
      this.emergencyTimer = null;
    }

    log.info({ eventsGenerated: this.stats.eventsGenerated }, 'Demo emulator stopped');
  }

  /** Return current emulator statistics (events generated, uptime, seeded counts, error count). */
  getStats(): DemoEmulatorStats {
    return {
      ...this.stats,
      uptime: this.running ? Date.now() - this.startedAt : 0,
      currentRate: getCurrentRate(this.recipe.scenarios.normal),
    };
  }

  // ─── Event Loop ─────────────────────────────────────────────────

  /**
   * (Re)schedule the event generation interval based on current rate.
   * Converts events-per-minute to a millisecond interval (e.g., 4 EPM = 15000ms).
   * Only reschedules if the computed interval actually changed, avoiding unnecessary timer churn.
   */
  private scheduleEventLoop(): void {
    const rate = getCurrentRate(this.recipe.scenarios.normal);
    const intervalMs = rate > 0 ? Math.round((60 * 1000) / rate) : 30_000;

    // Only reschedule if the interval actually changed
    if (intervalMs === this.currentIntervalMs && this.eventTimer) return;
    this.currentIntervalMs = intervalMs;

    if (this.eventTimer) {
      clearInterval(this.eventTimer);
    }

    this.eventTimer = setInterval(() => {
      this.emitEvent().catch(err => {
        log.warn({ err }, 'Event emission failed');
        this.stats.errors++;
      });
    }, intervalMs);

    log.debug({ rate, intervalMs }, 'Event loop (re)scheduled');
  }

  /** Generate a single event using weighted random selection and write it to PostgreSQL. */
  private async emitEvent(): Promise<void> {
    if (!this.running) return;
    if (this.doors.length === 0 && this.cameras.length === 0) return;

    const ctx: EmulatorContext = {
      doors: this.doors,
      cameras: this.cameras,
      cardholders: this.cardholders,
      visitors: this.visitors,
      recipe: this.recipe,
    };

    // Pick an event type by weight
    const selected = pickWeighted(EVENT_WEIGHTS);
    const event = selected.generator(ctx);
    if (!event) return;

    await this.writeEvent(event);
    this.stats.eventsGenerated++;
  }

  // ─── Emergency Check ───────────────────────────────────────────
  // Runs every 60 seconds. For each defined emergency scenario, rolls a random
  // number against the scenario's probability (probability is per-minute, so
  // a value of 0.0002 = ~0.02% chance per minute = roughly once per ~83 hours).
  // When triggered, generates a CRITICAL alarm event with the emergency type,
  // response action, affected zones, and duration from the recipe definition.

  /**
   * Check each emergency scenario against its per-minute probability
   * and generate alarm events for any that trigger.
   */
  private async checkEmergencies(): Promise<void> {
    if (!this.running) return;
    const emergencies = this.recipe.scenarios.emergencies;
    if (!emergencies) return;

    for (const emergency of emergencies) {
      // Roll against probability (probability is per minute, check runs once per minute)
      if (Math.random() < emergency.probability) {
        log.info({ type: emergency.type, response: emergency.response }, 'Emergency triggered');

        const ctx: EmulatorContext = {
          doors: this.doors,
          cameras: this.cameras,
          cardholders: this.cardholders,
          visitors: this.visitors,
          recipe: this.recipe,
        };

        // Generate the alarm event
        const alarmDoor = pick(this.doors);
        const now = new Date().toISOString();
        const event: AccessEventRow = {
          id: uuid(),
          event_type: emergency.type.toLowerCase(),
          timestamp: now,
          cardholder_id: null,
          cardholder_name: null,
          credential_type: null,
          door_id: alarmDoor.id,
          door_name: alarmDoor.name,
          reader_id: null,
          reader_name: null,
          facility_code: null,
          location: alarmDoor.zone,
          building: alarmDoor.building,
          floor: '1',
          zone: alarmDoor.zone,
          result: 'alarm',
          source_system: 'emergency-system',
          source_event_id: uuid(),
          metadata: {
            alarmType: emergency.type,
            response: emergency.response,
            severity: 'CRITICAL',
            durationMinutes: emergency.durationMinutes || 15,
            zones: emergency.zones || [],
            triggeredAt: now,
          },
          device_id: null,
          created_at: now,
        };

        try {
          await this.writeEvent(event);
          this.stats.emergenciesTriggered++;
          this.stats.eventsGenerated++;
        } catch (err) {
          log.warn({ err, type: emergency.type }, 'Failed to write emergency event');
          this.stats.errors++;
        }
      }
    }
  }

  // ─── Database Writer ───────────────────────────────────────────

  /**
   * Write a single access event row to the access_events PostgreSQL table.
   * Uses ON CONFLICT DO NOTHING to handle duplicate event IDs gracefully.
   * @param event - Fully populated event row to insert.
   */
  private async writeEvent(event: AccessEventRow): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO access_events (
          id, org_id, site_id, event_type, timestamp, cardholder_id, cardholder_name,
          credential_type, door_id, door_name, reader_id, reader_name,
          facility_code, location, building, floor, zone, result,
          source_system, source_event_id, metadata, device_id, created_at
        )
        VALUES ($1,$22,$23,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (id) DO NOTHING
      `, [
        event.id,
        event.event_type,
        event.timestamp,
        event.cardholder_id,
        event.cardholder_name,
        event.credential_type,
        event.door_id,
        event.door_name,
        event.reader_id,
        event.reader_name,
        event.facility_code,
        event.location,
        event.building,
        event.floor,
        event.zone,
        event.result,
        event.source_system,
        event.source_event_id,
        JSON.stringify(event.metadata),
        event.device_id,
        event.created_at,
        process.env.DASHBOARD_ADMIN_ORG || 'demo',
        'default',
      ]);
    } catch (err) {
      // Table might not have all columns yet — log and continue
      log.debug({ err, eventType: event.event_type }, 'Failed to write event');
      throw err;
    }
  }

  /**
   * Ensure the access_events table schema is compatible with demo event writes.
   * Drops NOT NULL constraints on all columns except `id` (the demo emulator
   * doesn't populate every field for every event type). Also converts legacy
   * integer `id` columns to TEXT type for UUID compatibility.
   */
  private async ensureSchema(): Promise<void> {
    try {
      // Drop NOT NULL constraints on all columns except id (matches pac-emulator pattern)
      const { rows } = await this.pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'access_events' AND is_nullable = 'NO' AND column_name != 'id'
      `);
      for (const row of rows) {
        try {
          await this.pool.query(`ALTER TABLE access_events ALTER COLUMN "${row.column_name}" DROP NOT NULL`);
        } catch (err) { log.debug({ err, column: row.column_name }, 'Schema fixup: constraint already dropped or column does not exist'); }
      }
      // Fix id type if it's integer (legacy schemas)
      try {
        const { rows: idRows } = await this.pool.query(`
          SELECT data_type FROM information_schema.columns
          WHERE table_name = 'access_events' AND column_name = 'id'
        `);
        if (idRows.length > 0 && ['integer', 'bigint', 'smallint'].includes(idRows[0].data_type)) {
          await this.pool.query(`ALTER TABLE access_events ALTER COLUMN id DROP DEFAULT`);
          await this.pool.query(`ALTER TABLE access_events ALTER COLUMN id SET DATA TYPE TEXT USING id::TEXT`);
        }
      } catch (err) { log.debug({ err }, 'Schema fixup: access_events id column type change failed'); }
      log.debug({ columnsFixed: rows.length }, 'Schema compatibility check complete');
    } catch (err) {
      log.warn({ err }, 'Schema compatibility check failed — events may fail to write');
    }
  }
}

// ─── Factory: Start emulator from product name ──────────────────────

/** Singleton reference — only one emulator runs per process. */
let activeEmulator: DemoEmulator | null = null;

/**
 * Load a recipe by product name and start the demo emulator.
 *
 * Recipes are loaded dynamically from `adapters/emulators/recipes/{product}.ts`.
 * Product name aliases are normalized (e.g., "safe-school" -> "school",
 * "safeschool" -> "gsoc"). Falls back to `buildFallbackRecipe()` if the
 * recipe file is not found.
 *
 * If an emulator is already running, it is stopped before the new one starts
 * (singleton pattern — only one emulator per process).
 *
 * @param opts.connectionString - PostgreSQL connection string for event writes.
 * @param opts.product - Product identifier (e.g., "safeschool", "safeschool", "gsoc").
 * @param opts.orgId - Organization ID for multi-tenant scoping (default: "demo").
 * @returns The started DemoEmulator instance.
 */
export async function startDemoEmulator(opts: {
  connectionString: string;
  product: string;
  orgId?: string;
}): Promise<DemoEmulator> {
  const { connectionString, product, orgId = 'demo' } = opts;

  // Load recipe for this product
  let recipe: DemoRecipe;
  const productMap: Record<string, string> = {
    safeschool: 'school',
    'safe-school': 'school',
    safeschool: 'safeschool',
    'badge-guard': 'safeschool',
    'safeschool': 'gsoc',
    gsoc: 'gsoc',
    'safeschool': 'property-mgmt',
    propertyguard: 'property-mgmt',
    safeschool: 'safeschool',
    'nexus-safeschool': 'safeschool',
  };

  const recipeName = productMap[product.toLowerCase()] || product.toLowerCase();

  try {
    // Dynamic import of recipe file (indirect path prevents esbuild from resolving as glob)
    const recipePath = ['..', '..', '..', 'adapters', 'emulators', 'recipes', `${recipeName}.js`].join('/');
    const mod = await import(recipePath);
    recipe = mod.recipe || mod.default;
    log.info({ recipeName, recipeFull: recipe.name }, 'Loaded demo recipe');
  } catch (err) {
    log.warn({ err, recipeName }, 'Recipe not found — using minimal fallback');
    recipe = buildFallbackRecipe(product);
  }

  // Create pool
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString,
    max: 3,
    ssl: connectionString.includes('sslmode=require') || connectionString.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Stop any existing emulator
  if (activeEmulator) {
    await activeEmulator.stop();
  }

  const emulator = new DemoEmulator(pool, recipe, orgId);
  await emulator.start();
  activeEmulator = emulator;
  return emulator;
}

/**
 * Stop the active demo emulator (if running).
 */
export async function stopDemoEmulator(): Promise<void> {
  if (activeEmulator) {
    await activeEmulator.stop();
    activeEmulator = null;
  }
}

/**
 * Get stats from the active demo emulator.
 */
export function getDemoEmulatorStats(): DemoEmulatorStats | null {
  return activeEmulator ? activeEmulator.getStats() : null;
}

// ─── Fallback Recipe ─────────────────────────────────────────────────

/**
 * Build a minimal generic recipe when no product-specific recipe file exists.
 * Provides a basic office building layout (lobby, offices, server room, parking)
 * with 30 staff, 3 visitors/hour, and standard morning/lunch/evening traffic patterns.
 */
function buildFallbackRecipe(product: string): DemoRecipe {
  return {
    name: `${product} Demo`,
    vertical: product,
    buildings: [{ name: 'Main Building', floors: 2 }],
    zones: [
      { name: 'Main Lobby', access: 'BADGE_ONLY', doors: 2, cameraCount: 2 },
      { name: 'Office Area', access: 'BADGE_ONLY', doors: 4, cameraCount: 1 },
      { name: 'Server Room', access: 'RESTRICTED', doors: 1, cameraCount: 1 },
      { name: 'Parking', access: 'OPEN', doors: 2, cameraCount: 2 },
      { name: 'Loading Dock', access: 'BADGE_ONLY', doors: 1, cameraCount: 1 },
    ],
    people: {
      staff: {
        count: 30,
        roles: [
          { role: 'Employee', count: 20, zones: ['all'], shift: 'DAY', credential: 'BADGE' },
          { role: 'Security', count: 4, zones: ['all'], shift: '24/7', credential: 'BADGE_PIN' },
          { role: 'IT Staff', count: 3, zones: ['all', 'server_room'], credential: 'BADGE_PIN' },
          { role: 'Manager', count: 3, zones: ['all'], credential: 'BADGE' },
        ],
      },
      visitors: { perHour: 3, types: ['Vendor', 'Client', 'Delivery'] },
    },
    scenarios: {
      normal: {
        eventsPerMinute: 4,
        patterns: [
          { time: '08:00-09:00', type: 'morning_arrival', rate: 12 },
          { time: '12:00-13:00', type: 'lunch', rate: 8 },
          { time: '17:00-18:00', type: 'evening_departure', rate: 10 },
        ],
      },
      emergencies: [
        { type: 'FIRE_ALARM', probability: 0.0002, response: 'evacuate', durationMinutes: 15 },
        { type: 'INTRUSION', probability: 0.0001, response: 'lockdown', durationMinutes: 20 },
      ],
    },
    integrations: {
      adapters: ['access-control', 'cameras'],
    },
    ui: {
      theme: { accent: '#3b82f6', accentHover: '#60a5fa', logo: '' },
      nav: [],
      dashboard: { cards: [], widgets: [] },
      components: [],
      features: {},
    },
  };
}
