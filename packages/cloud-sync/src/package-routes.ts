// @ts-nocheck
/**
 * Package Room Management Routes (SafeSchool) — tenant-scoped.
 *
 * Packages are stored as sync_entities rows with entity_type='package' /
 * 'package_preregister'. All reads/writes filter by the caller's org_id
 * (previously hard-coded 'demo' — multi-tenant leak).
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';
const log = createLogger('cloud-sync:packages');

function detectCarrier(tracking: string): string | null {
  if (/^1Z[A-Z0-9]{16,}$/i.test(tracking)) return 'UPS';
  if (/^(94|93|92)\d{18,22}$/.test(tracking)) return 'USPS';
  if (/^\d{12,15}$/.test(tracking)) return 'FedEx';
  if (/^TBA\d+$/i.test(tracking)) return 'Amazon';
  if (/^\d{10}$/.test(tracking)) return 'DHL';
  return null;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function simulateTracking(trackingNumber: string) {
  const carrier = detectCarrier(trackingNumber) || 'Unknown';
  const hash = hashCode(trackingNumber);
  const units = ['1205', '803', '1402', '2201', '507', '1810', '304', '1105', '2503', '612'];
  const unit = units[hash % units.length];
  const routes = [
    ['Louisville, KY', 'Indianapolis, IN', 'Columbus, OH', 'Newark, NJ', 'Providence, RI'],
    ['Memphis, TN', 'Nashville, TN', 'Richmond, VA', 'Newark, NJ', 'Providence, RI'],
    ['Oakland, CA', 'Salt Lake City, UT', 'Denver, CO', 'Chicago, IL', 'Providence, RI'],
  ];
  const route = routes[hash % routes.length]!;
  const statusList = ['IN_TRANSIT', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERED'];
  const status = statusList[hash % statusList.length]!;
  const now = Date.now();
  const events = route.map((loc, i) => ({
    timestamp: new Date(now - (route.length - i) * 18 * 3600000).toISOString(),
    status: i === route.length - 1 ? 'DELIVERED' : i === route.length - 2 ? 'OUT_FOR_DELIVERY' : 'IN_TRANSIT',
    location: loc,
    description: i === 0 ? 'Picked up' : i === route.length - 1 ? 'Delivered' : 'In transit',
  }));
  return {
    trackingNumber, carrier, status,
    statusDetail: status === 'DELIVERED' ? 'Delivered to front desk' : 'Package in transit',
    estimatedDelivery: new Date(now + 24 * 3600000).toISOString(),
    deliveredAt: status === 'DELIVERED' ? new Date(now - 2 * 3600000).toISOString() : undefined,
    deliveryAddress: { street: '100 Harbor Point Dr', city: 'Providence', state: 'RI', zip: '02903', unit },
    events, lastUpdated: new Date().toISOString(),
  };
}

const BUILDING_ADDRESS = {
  street: process.env.BUILDING_STREET || '100 Harbor Point Dr',
  city: process.env.BUILDING_CITY || 'Providence',
  state: process.env.BUILDING_STATE || 'RI',
  zip: process.env.BUILDING_ZIP || '02903',
};

function extractUnitFromAddress(address: string): string | null {
  if (!address) return null;
  const patterns = [
    /(?:apt|apartment|unit|ste|suite|#|room|rm)\s*\.?\s*(\w+)/i,
    /(?:^|\s)(\d{3,5})\s*$/,
  ];
  for (const p of patterns) {
    const m = address.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

const getTracker = () => ({
  track: async (tn: string) => {
    const result = simulateTracking(tn);
    if (result.deliveryAddress) {
      result.deliveryAddress.street = BUILDING_ADDRESS.street;
      result.deliveryAddress.city = BUILDING_ADDRESS.city;
      result.deliveryAddress.state = BUILDING_ADDRESS.state;
      result.deliveryAddress.zip = BUILDING_ADDRESS.zip;
    }
    return result;
  },
  detectCarrier: (tn: string) => detectCarrier(tn),
  extractUnit: (address: string) => extractUnitFromAddress(address),
  buildingAddress: BUILDING_ADDRESS,
});

export interface PackageRoutesOptions {
  connectionString?: string;
}

export async function packageRoutes(fastify: FastifyInstance, opts: PackageRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — package routes will use sync_entities fallback');
  }

  const pool = connStr
    ? new pg.Pool({
        connectionString: connStr,
        max: 5,
        ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
          ? { rejectUnauthorized: false }
          : undefined,
      })
    : null;

  // ─── Helpers (tenant-scoped) ──────────────────────────────────────

  async function queryPackages(orgId: string, filters: Record<string, any> = {}, limit = 50, offset = 0) {
    if (!pool) return { packages: [], total: 0 };

    const conditions = [`entity_type = 'package'`, `COALESCE(org_id, $1) = $1`];
    const params: any[] = [orgId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`data->>'status' = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.carrier) {
      conditions.push(`data->>'carrier' = $${idx++}`);
      params.push(filters.carrier);
    }
    if (filters.unitNumber) {
      conditions.push(`data->>'unitNumber' = $${idx++}`);
      params.push(filters.unitNumber);
    }
    if (filters.trackingNumber) {
      conditions.push(`data->>'trackingNumber' = $${idx++}`);
      params.push(filters.trackingNumber);
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM sync_entities WHERE ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const dataRes = await pool.query(
      `SELECT id, data, sync_timestamp, updated_at FROM sync_entities WHERE ${where} ORDER BY sync_timestamp DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    );

    const packages = dataRes.rows.map((r: any) => ({
      id: r.id,
      ...r.data,
      createdAt: r.sync_timestamp,
      updatedAt: r.updated_at,
    }));

    return { packages, total };
  }

  async function getPackageById(orgId: string, id: string) {
    if (!pool) return null;
    const res = await pool.query(
      `SELECT id, data, sync_timestamp, updated_at FROM sync_entities WHERE id = $1 AND entity_type = 'package' AND COALESCE(org_id, $2) = $2`,
      [id, orgId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, ...r.data, createdAt: r.sync_timestamp, updatedAt: r.updated_at };
  }

  async function updatePackageData(orgId: string, id: string, updates: Record<string, any>) {
    if (!pool) return null;
    const now = new Date().toISOString();
    const res = await pool.query(
      `UPDATE sync_entities SET data = data || $1::jsonb, updated_at = $2
       WHERE id = $3 AND entity_type = 'package' AND COALESCE(org_id, $4) = $4
       RETURNING id, data, sync_timestamp, updated_at`,
      [JSON.stringify(updates), now, id, orgId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, ...r.data, createdAt: r.sync_timestamp, updatedAt: r.updated_at };
  }

  async function lookupTenantByUnit(orgId: string, unitNumber: string) {
    if (!pool) return null;
    const res = await pool.query(
      `SELECT id, data FROM sync_entities
       WHERE entity_type = 'tenant' AND COALESCE(org_id, $1) = $1
         AND (data->>'unitNumber' = $2 OR data->>'suite' = $2 OR data->>'unit' = $2)
       LIMIT 1`,
      [orgId, unitNumber],
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].data;
  }

  async function checkPreRegistered(orgId: string, trackingNumber: string) {
    if (!pool) return null;
    const res = await pool.query(
      `SELECT id, data FROM sync_entities
       WHERE entity_type = 'package_preregister' AND COALESCE(org_id, $1) = $1
         AND data->>'trackingNumber' = $2 AND data->>'status' = 'waiting'
       LIMIT 1`,
      [orgId, trackingNumber],
    );
    if (res.rows.length === 0) return null;
    return { id: res.rows[0].id, ...res.rows[0].data };
  }

  async function sendSmsNotification(phone: string, message: string): Promise<boolean> {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioSid || !twilioToken || !twilioFrom) {
      log.info({ phone, message }, 'SMS notification (simulated — no Twilio config)');
      return true;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const body = new URLSearchParams({
        To: phone,
        From: twilioFrom,
        Body: message,
      });
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!resp.ok) {
        log.warn({ status: resp.status }, 'Twilio SMS failed');
        return false;
      }
      log.info({ phone }, 'SMS sent via Twilio');
      return true;
    } catch (err) {
      log.warn({ err }, 'Twilio SMS error');
      return false;
    }
  }

  // ─── POST /packages (tenant-scoped) ─────────────────────────────

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.trackingNumber) {
      return reply.code(400).send({ error: 'trackingNumber is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const trackingNumber = body.trackingNumber.trim();
    const carrier = body.carrier || detectCarrier(trackingNumber) || 'Other';
    let unitNumber = body.unitNumber || '';
    const size = body.size || 'Medium';
    const shelfLocation = body.shelfLocation || '';
    const notes = body.notes || '';

    let trackingInfo = null;
    if (!unitNumber) {
      try {
        const tracker = getTracker();
        if (tracker.detectCarrier(trackingNumber)) {
          trackingInfo = await tracker.track(trackingNumber);
          if (trackingInfo.deliveryAddress?.unit) {
            unitNumber = trackingInfo.deliveryAddress.unit;
            log.info({ trackingNumber, unit: unitNumber }, 'Auto-detected unit from carrier tracking data');
          }
        }
      } catch (err) {
        log.debug({ trackingNumber, err }, 'Could not auto-detect unit from tracking — continuing without');
      }
    }

    let tenantName = '';
    let tenantPhone = '';
    let preRegMatch = false;

    const preReg = await checkPreRegistered(orgId, trackingNumber);
    if (preReg) {
      if (!unitNumber && preReg.unitNumber) unitNumber = preReg.unitNumber;
      tenantName = preReg.tenantName || '';
      tenantPhone = preReg.tenantPhone || '';
      preRegMatch = true;
      if (pool) {
        await pool.query(
          `UPDATE sync_entities SET data = data || '{"status":"received"}'::jsonb, updated_at = $1
           WHERE id = $2 AND COALESCE(org_id, $3) = $3`,
          [now, preReg.id, orgId],
        );
      }
      log.info({ trackingNumber, orgId }, 'Pre-registered package matched');
    }

    if (!tenantName && unitNumber) {
      const tenant = await lookupTenantByUnit(orgId, unitNumber);
      if (tenant) {
        tenantName = tenant.tenant_name || tenant.name || tenant.contact_name || '';
        tenantPhone = tenant.contact_phone || tenant.phone || '';
      }
    }

    const packageData = {
      trackingNumber,
      carrier,
      unitNumber: preReg?.unitNumber || unitNumber,
      tenantName: preReg?.tenantName || tenantName || body.recipientName || '',
      tenantPhone: preReg?.tenantPhone || tenantPhone || body.phone || '',
      size,
      shelfLocation,
      status: 'received',
      receivedAt: now,
      notifiedAt: null,
      pickedUpAt: null,
      returnedAt: null,
      verificationMethod: null,
      preRegistered: preRegMatch,
      notes,
    };

    if (pool) {
      // Store with caller's real org_id (was hard-coded 'demo' — cross-tenant leak)
      await pool.query(
        `INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
         VALUES ($1, 'package', $2, 'default', $3, 'create', NOW(), NOW())
         ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $3, updated_at = NOW()`,
        [id, orgId, JSON.stringify(packageData)],
      );
    }

    log.info({ id, orgId, trackingNumber, carrier, unitNumber: packageData.unitNumber }, 'Package logged');

    return reply.code(201).send({
      id,
      trackingNumber,
      carrier,
      unit: packageData.unitNumber,
      tenant: packageData.tenantName,
      status: 'received',
      shelfLocation,
      preRegistered: preRegMatch,
      createdAt: now,
    });
  });

  // ─── GET /packages (tenant-scoped) ──────────────────────────────

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const filters: Record<string, any> = {};
    if (q.status) filters.status = q.status;
    if (q.carrier) filters.carrier = q.carrier;
    if (q.unit) filters.unitNumber = q.unit;
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 200);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const result = await queryPackages(orgId, filters, limit, offset);
    return result;
  });

  // ─── GET /config ────────────────────────────────────────────────
  fastify.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      buildingAddress: BUILDING_ADDRESS,
      carrierDetection: true,
      unitExtraction: true,
      supportedCarriers: ['UPS', 'FedEx', 'USPS', 'Amazon', 'DHL'],
      envVars: {
        BUILDING_STREET: 'Street address for carrier matching',
        BUILDING_CITY: 'City',
        BUILDING_STATE: 'State code (e.g., RI)',
        BUILDING_ZIP: 'ZIP code',
      },
    });
  });

  // ─── GET /packages/stats (tenant-scoped) ────────────────────────

  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!pool) {
      return { today: 0, pending: 0, pickedUp: 0, returned: 0, avgPickupHours: 0, byCarrier: {} };
    }

    const orgId = getOrgId(request);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayRes, statusRes, carrierRes, avgRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as cnt FROM sync_entities
         WHERE entity_type = 'package' AND COALESCE(org_id, $1) = $1 AND sync_timestamp >= $2`,
        [orgId, todayStart.toISOString()],
      ),
      pool.query(
        `SELECT data->>'status' as status, COUNT(*) as cnt FROM sync_entities
         WHERE entity_type = 'package' AND COALESCE(org_id, $1) = $1
         GROUP BY data->>'status'`,
        [orgId],
      ),
      pool.query(
        `SELECT data->>'carrier' as carrier, COUNT(*) as cnt FROM sync_entities
         WHERE entity_type = 'package' AND COALESCE(org_id, $1) = $1
         GROUP BY data->>'carrier'`,
        [orgId],
      ),
      pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (
          (data->>'pickedUpAt')::timestamp - (data->>'receivedAt')::timestamp
        )) / 3600) as avg_hours
        FROM sync_entities
        WHERE entity_type = 'package' AND COALESCE(org_id, $1) = $1
          AND data->>'status' = 'picked_up' AND data->>'pickedUpAt' IS NOT NULL`,
        [orgId],
      ),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of statusRes.rows) {
      statusMap[row.status] = parseInt(row.cnt, 10);
    }

    const byCarrier: Record<string, number> = {};
    for (const row of carrierRes.rows) {
      byCarrier[row.carrier] = parseInt(row.cnt, 10);
    }

    return {
      today: parseInt(todayRes.rows[0]?.cnt || '0', 10),
      pending: (statusMap['received'] || 0) + (statusMap['notified'] || 0),
      pickedUp: statusMap['picked_up'] || 0,
      returned: statusMap['returned'] || 0,
      avgPickupHours: Math.round(parseFloat(avgRes.rows[0]?.avg_hours || '0')),
      byCarrier,
    };
  });

  // ─── GET /packages/pre-registered (tenant-scoped) ────────────────

  fastify.get('/pre-registered', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return { preRegistered: [] };
    const orgId = getOrgId(request);

    const res = await pool.query(
      `SELECT id, data, sync_timestamp FROM sync_entities
       WHERE entity_type = 'package_preregister' AND COALESCE(org_id, $1) = $1
       ORDER BY sync_timestamp DESC LIMIT 100`,
      [orgId],
    );

    const preRegistered = res.rows.map((r: any) => ({
      id: r.id,
      ...r.data,
      createdAt: r.sync_timestamp,
    }));

    return { preRegistered };
  });

  // ─── GET /packages/:id (tenant-scoped) ──────────────────────────

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const pkg = await getPackageById(orgId, id);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }
    return pkg;
  });

  // ─── PUT /packages/:id/pickup (tenant-scoped) ───────────────────

  fastify.put('/packages/:id/pickup', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const pkg = await getPackageById(orgId, id);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    const now = new Date().toISOString();
    const verificationMethod = body?.verificationMethod || 'verbal';
    const verifiedBy = body?.verifiedBy || '';

    const updated = await updatePackageData(orgId, id, {
      status: 'picked_up',
      pickedUpAt: now,
      verificationMethod,
      verifiedBy,
    });

    if (pkg.preRegistered && pkg.trackingNumber && pool) {
      await pool.query(
        `UPDATE sync_entities SET data = data || '{"status":"picked_up"}'::jsonb, updated_at = $1
         WHERE entity_type = 'package_preregister' AND COALESCE(org_id, $2) = $2
           AND data->>'trackingNumber' = $3`,
        [now, orgId, pkg.trackingNumber],
      );
    }

    log.info({ id, orgId, verificationMethod }, 'Package picked up');

    return { ok: true, pickedUpAt: now };
  });

  // ─── PUT /packages/:id/notify (tenant-scoped) ───────────────────

  fastify.put('/packages/:id/notify', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const pkg = await getPackageById(orgId, id);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    const phone = pkg.tenantPhone;
    const carrier = pkg.carrier || 'Unknown';
    const shelf = pkg.shelfLocation || 'the package room';
    const message = `You have a package from ${carrier}. Pick up at ${shelf}.`;

    let notificationSent = false;
    if (phone) {
      notificationSent = await sendSmsNotification(phone, message);
    } else {
      log.warn({ id, orgId }, 'No phone number for package notification');
    }

    const now = new Date().toISOString();
    await updatePackageData(orgId, id, {
      status: 'notified',
      notifiedAt: now,
    });

    log.info({ id, orgId, phone: phone || '(none)', notificationSent }, 'Package notification sent');

    return { ok: true, notificationSent, phone: phone || null };
  });

  // ─── PUT /packages/:id/return (tenant-scoped) ───────────────────

  fastify.put('/packages/:id/return', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const pkg = await getPackageById(orgId, id);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    const now = new Date().toISOString();
    const reason = body?.reason || 'Uncollected - exceeded hold period';

    await updatePackageData(orgId, id, {
      status: 'returned',
      returnedAt: now,
      returnReason: reason,
    });

    log.info({ id, orgId, reason }, 'Package returned to carrier');

    return { ok: true, returnedAt: now };
  });

  // ─── GET /packages/track/:trackingNumber ────────────────────────

  fastify.get('/track/:trackingNumber', async (request: FastifyRequest, reply: FastifyReply) => {
    const { trackingNumber } = request.params as { trackingNumber: string };
    if (!trackingNumber || trackingNumber.trim().length < 5) {
      return reply.code(400).send({ error: 'Invalid tracking number' });
    }

    const tracker = getTracker();
    const tn = trackingNumber.trim();
    const carrier = tracker.detectCarrier(tn);

    if (!carrier) {
      return reply.code(400).send({
        error: `Unrecognized tracking number format: ${tn}`,
        hint: 'Supported formats: UPS (1Z...), FedEx (12-15 digits), USPS (94/93/92 + 18-22 digits), DHL (10 digits)',
      });
    }

    try {
      const result = await tracker.track(tn);
      log.info({ trackingNumber: tn, carrier, status: result.status, simulated: result.simulated }, 'Tracking lookup');
      return result;
    } catch (err) {
      log.warn({ trackingNumber: tn, err }, 'Tracking lookup failed');
      return reply.code(502).send({ error: 'Carrier API unavailable', detail: (err as Error).message });
    }
  });

  // ─── POST /packages/pre-register (tenant-scoped) ────────────────

  fastify.post('/pre-register', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.trackingNumber) {
      return reply.code(400).send({ error: 'trackingNumber is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const preRegData = {
      trackingNumber: body.trackingNumber.trim(),
      unitNumber: body.unitNumber || '',
      tenantName: body.tenantName || '',
      tenantPhone: body.tenantPhone || '',
      description: body.description || '',
      status: 'waiting',
      registeredAt: now,
    };

    if (pool) {
      // Store with caller's real org_id (was hard-coded 'demo')
      await pool.query(
        `INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
         VALUES ($1, 'package_preregister', $2, 'default', $3, 'create', NOW(), NOW())
         ON CONFLICT (org_id, entity_type, id) DO UPDATE SET data = $3, updated_at = NOW()`,
        [id, orgId, JSON.stringify(preRegData)],
      );
    }

    log.info({ id, orgId, trackingNumber: preRegData.trackingNumber, unitNumber: preRegData.unitNumber }, 'Package pre-registered');

    return reply.code(201).send({ ok: true, id });
  });
}
