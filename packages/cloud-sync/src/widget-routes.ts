// @ts-nocheck
/**
 * Embeddable Widget Routes
 *
 * Provides a compact iFrame widget for embedding security status
 * into third-party pages, intranets, or digital signage.
 *
 * Tenant scoping: the widget is unauthenticated (iframe embed), so it relies
 * on a signed `?orgId=<id>&token=<hmac>` URL that the dashboard generates
 * server-side. The token is HMAC(orgId + date-day) with WIDGET_SIGNING_SECRET;
 * an unsigned or mismatched request returns empty data (fail-closed) so a
 * casual caller hitting /widget/data cannot enumerate any tenant's state.
 *
 * Routes:
 *   GET  /widget/config    — Widget configuration for iFrame embedding
 *   GET  /widget/data      — Real-time widget data feed (tenant-scoped)
 *   POST /widget/configure — Configure widget settings
 *   GET  /widget/embed     — Embeddable HTML widget page
 *   GET  /widget/health    — Widget health check
 *   GET  /widget/token     — Generate a signed widget token (JWT-gated)
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:widget');

export interface WidgetRoutesOptions {
  connectionString?: string;
}

/** Canonical "empty" response used when the widget is unauthorized. */
const EMPTY_DATA = {
  active_alarms: 0,
  open_incidents: 0,
  devices_online: 0,
  devices_total: 0,
  recent_events: [],
  posture_grade: 'N/A',
  alerts: [],
};

/**
 * Verify a widget token. Returns the orgId on success, null on failure.
 * Token = base64url(HMAC-SHA256(orgId + ':' + dayBucket, WIDGET_SIGNING_SECRET))
 * where `dayBucket` is the current UTC date (YYYY-MM-DD) so tokens roll daily.
 */
function verifyWidgetToken(orgId: string | undefined, token: string | undefined): string | null {
  const secret = process.env.WIDGET_SIGNING_SECRET;
  if (!secret || !orgId || !token) return null;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const day of [today, yesterday]) {
    const expected = crypto.createHmac('sha256', secret).update(`${orgId}:${day}`).digest('base64url');
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return orgId;
    } catch { /* length mismatch → fall through */ }
  }
  return null;
}

function signWidgetToken(orgId: string): string | null {
  const secret = process.env.WIDGET_SIGNING_SECRET;
  if (!secret) return null;
  const today = new Date().toISOString().slice(0, 10);
  return crypto.createHmac('sha256', secret).update(`${orgId}:${today}`).digest('base64url');
}

export async function widgetRoutes(fastify: FastifyInstance, opts: WidgetRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  const pool = connStr ? new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  }) : null;
  if (!pool) log.info('Widget routes running without database (using defaults)');

  // ─── Helper: load widget config from DB (tenant-scoped) ────────
  // If orgId is null we fall back to the default shell so the iframe still
  // renders; we do NOT read an arbitrary tenant's config in that case.
  async function loadWidgetConfig(orgId: string | null): Promise<Record<string, any>> {
    const defaults = {
      allowed_origins: ['*'],
      theme: 'dark',
      refresh_interval: 30,
      show_sections: ['alarms', 'incidents', 'devices', 'posture', 'events'],
    };
    if (!pool || !orgId) return defaults;
    try {
      const { rows } = await pool.query(
        'SELECT * FROM widget_config WHERE COALESCE(org_id, $1) = $1 ORDER BY updated_at DESC LIMIT 1',
        [orgId]
      );
      if (rows.length > 0) {
        const row = rows[0];
        return {
          allowed_origins: typeof row.allowed_origins === 'string' ? JSON.parse(row.allowed_origins) : row.allowed_origins || defaults.allowed_origins,
          theme: row.theme || defaults.theme,
          refresh_interval: row.refresh_interval || defaults.refresh_interval,
          show_sections: typeof row.show_sections === 'string' ? JSON.parse(row.show_sections) : row.show_sections || defaults.show_sections,
        };
      }
    } catch (err) { log.debug({ err }, 'Failed to load widget config (table may not exist)'); }
    return defaults;
  }

  // ─── GET /widget/config — Widget configuration for embedding (tenant-scoped) ────
  // Mounted inside the JWT scope → user.orgId is trustworthy.
  fastify.get('/widget/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const orgId = user?.orgId || null;
      const config = await loadWidgetConfig(orgId);
      const host = request.headers.host || 'localhost';
      const proto = request.headers['x-forwarded-proto'] || 'http';
      const baseUrl = `${proto}://${host}`;

      return reply.send({
        widget_url: `${baseUrl}/api/v1/widget/embed`,
        embed_code: `<iframe src="${baseUrl}/api/v1/widget/embed" width="380" height="520" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.3);"></iframe>`,
        allowed_origins: config.allowed_origins,
        theme: config.theme,
        refresh_interval: config.refresh_interval,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get widget config');
      return reply.code(500).send({ error: 'Failed to get widget config' });
    }
  });

  // ─── GET /widget/token — Mint a signed widget token for the caller's org ────
  // JWT-protected (the global preHandler lets /api/v1/widget/* through without
  // JWT, so we verify the user object ourselves and refuse if absent).
  fastify.get('/widget/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.orgId) {
      return reply.code(401).send({ error: 'JWT required to mint widget token' });
    }
    const token = signWidgetToken(user.orgId);
    if (!token) {
      return reply.code(503).send({ error: 'WIDGET_SIGNING_SECRET is not configured on this deployment' });
    }
    return reply.send({ orgId: user.orgId, token, valid_for_hours: 48 });
  });

  // ─── GET /widget/data — Real-time widget data feed (tenant-scoped) ──────────
  fastify.get('/widget/data', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();
      const q = request.query as { orgId?: string; token?: string };
      const orgId = verifyWidgetToken(q.orgId, q.token);

      // Unauthorized / unsigned caller → return zeros. Never leak any tenant's data.
      if (!orgId || !pool) {
        return reply.send({ ...EMPTY_DATA, timestamp: now.toISOString() });
      }

      // Active alarms (unacknowledged, tenant-scoped)
      let activeAlarms = 0;
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*) as cnt FROM alarms WHERE org_id = $1 AND acknowledged_at IS NULL`,
          [orgId]
        );
        activeAlarms = parseInt(rows[0]?.cnt || '0', 10);
      } catch (err) { log.debug({ err }, 'Failed to query active alarms for widget (table may not exist)'); }

      // Open incidents (tenant-scoped)
      let openIncidents = 0;
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*) as cnt FROM incidents WHERE org_id = $1 AND status IN ('open', 'investigating')`,
          [orgId]
        );
        openIncidents = parseInt(rows[0]?.cnt || '0', 10);
      } catch (err) { log.debug({ err }, 'Failed to query open incidents for widget (table may not exist)'); }

      // Devices online / total (tenant-scoped via COALESCE default)
      let devicesOnline = 0;
      let devicesTotal = 0;
      try {
        const { rows } = await pool.query(`
          SELECT COUNT(*) as total,
                 COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') as online
          FROM sync_devices
          WHERE COALESCE(org_id, $1) = $1
        `, [orgId]);
        devicesTotal = parseInt(rows[0]?.total || '0', 10);
        devicesOnline = parseInt(rows[0]?.online || '0', 10);
      } catch (err) { log.debug({ err }, 'Failed to query device counts for widget (table may not exist)'); }

      // Recent events (last 5, summary only, tenant-scoped via sync_entities.org_id if present)
      let recentEvents: Array<{ type: string; time: string; location: string }> = [];
      try {
        const { rows } = await pool.query(`
          SELECT data, updated_at FROM sync_entities
          WHERE COALESCE(org_id, $1) = $1
            AND entity_type IN ('access_event', 'event')
          ORDER BY updated_at DESC LIMIT 5
        `, [orgId]);
        recentEvents = rows.map(r => {
          const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {};
          return {
            type: d.eventType || d.type || 'event',
            time: r.updated_at || now.toISOString(),
            location: d.location || d.doorName || d.readerName || 'Unknown',
          };
        });
      } catch (err) { log.debug({ err }, 'Failed to query recent events for widget (table may not exist)'); }

      // Posture grade (tenant-scoped)
      let postureGrade = 'N/A';
      try {
        const { rows } = await pool.query(
          `SELECT grade FROM posture_history WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC LIMIT 1`,
          [orgId]
        );
        if (rows.length > 0) postureGrade = rows[0].grade;
      } catch (err) { log.debug({ err }, 'Failed to query posture grade for widget (table may not exist)'); }

      // Critical alerts (tenant-scoped)
      let alerts: Array<{ message: string; severity: string; time: string }> = [];
      try {
        const { rows } = await pool.query(`
          SELECT * FROM alarms
          WHERE org_id = $1 AND acknowledged_at IS NULL AND priority IN ('critical', 'high')
          ORDER BY created_at DESC LIMIT 5
        `, [orgId]);
        alerts = rows.map(r => ({
          message: r.title || r.alarm_type || 'Alert',
          severity: r.priority || 'high',
          time: r.created_at || now.toISOString(),
        }));
      } catch (err) { log.debug({ err }, 'Failed to query critical alerts for widget (table may not exist)'); }

      return reply.send({
        active_alarms: activeAlarms,
        open_incidents: openIncidents,
        devices_online: devicesOnline,
        devices_total: devicesTotal,
        recent_events: recentEvents,
        posture_grade: postureGrade,
        alerts,
        timestamp: now.toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to fetch widget data');
      return reply.code(500).send({ error: 'Failed to fetch widget data' });
    }
  });

  // ─── POST /widget/configure — Configure widget settings (tenant-scoped) ─────
  fastify.post('/widget/configure', async (request: FastifyRequest, reply: FastifyReply) => {
    // This route is inside the JWT scope in api-server.ts, so the preHandler
    // has already validated the user; getOrgId is safe here.
    const orgId = getOrgId(request);
    const body = request.body as any;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const allowedOrigins = body?.allowed_origins || ['*'];
    const theme = body?.theme || 'dark';
    const refreshInterval = body?.refresh_interval || 30;
    const showSections = body?.show_sections || ['alarms', 'incidents', 'devices', 'posture', 'events'];

    if (!pool) {
      return reply.code(201).send({ id, allowed_origins: allowedOrigins, theme, refresh_interval: refreshInterval, show_sections: showSections });
    }

    try {
      // Per-tenant upsert: remove this tenant's row, then insert.
      await pool.query(`ALTER TABLE widget_config ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
      await pool.query('DELETE FROM widget_config WHERE COALESCE(org_id, $1) = $1', [orgId]);
      await pool.query(`
        INSERT INTO widget_config (id, org_id, allowed_origins, theme, refresh_interval, show_sections, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      `, [
        id, orgId,
        JSON.stringify(allowedOrigins),
        theme,
        refreshInterval,
        JSON.stringify(showSections),
        now,
      ]);

      log.info({ orgId, theme, refreshInterval }, 'Widget configured');
      return reply.code(201).send({
        id,
        allowed_origins: allowedOrigins,
        theme,
        refresh_interval: refreshInterval,
        show_sections: showSections,
      });
    } catch (err) {
      log.error({ err }, 'Failed to configure widget');
      return reply.code(500).send({ error: 'Failed to configure widget' });
    }
  });

  // ─── GET /widget/embed — Embeddable HTML widget page ────────────
  // Unauthenticated. Only a verified orgId token reads config; without it,
  // the page renders with safe defaults so the iframe doesn't leak another
  // tenant's theme/refresh settings.
  fastify.get('/widget/embed', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { orgId?: string; token?: string };
    const verifiedOrg = verifyWidgetToken(q.orgId, q.token);
    const config = await loadWidgetConfig(verifiedOrg);
    const refreshMs = (config.refresh_interval || 30) * 1000;
    const theme = config.theme || 'dark';
    // Pass through only values that verify, so a tampered URL gets empty data.
    const dataQs = verifiedOrg
      ? `?orgId=${encodeURIComponent(verifiedOrg)}&token=${encodeURIComponent(q.token!)}`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Status Widget</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:${theme === 'dark' ? '#1a1a2e' : '#f8f9fa'};
  color:${theme === 'dark' ? '#e0e0e0' : '#212529'};
  padding:16px;min-height:100vh}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.header h1{font-size:14px;font-weight:600;opacity:0.7;text-transform:uppercase;letter-spacing:1px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.card{background:${theme === 'dark' ? '#16213e' : '#ffffff'};border-radius:10px;padding:14px;
  border:1px solid ${theme === 'dark' ? '#1a1a4e' : '#dee2e6'}}
.card .label{font-size:11px;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.card .value{font-size:28px;font-weight:700}
.alarm-value{color:#ef4444}
.incident-value{color:#f59e0b}
.online-value{color:#22c55e}
.grade-wrap{display:flex;align-items:center;justify-content:center;flex-direction:column}
.grade-circle{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-size:28px;font-weight:800;border:3px solid}
.grade-A{border-color:#22c55e;color:#22c55e}
.grade-B{border-color:#3b82f6;color:#3b82f6}
.grade-C{border-color:#f59e0b;color:#f59e0b}
.grade-D{border-color:#f97316;color:#f97316}
.grade-F{border-color:#ef4444;color:#ef4444}
.grade-NA{border-color:#6b7280;color:#6b7280}
.health-bar{height:8px;border-radius:4px;background:${theme === 'dark' ? '#2a2a4a' : '#dee2e6'};overflow:hidden;margin-top:6px}
.health-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#22c55e,#22c55e);transition:width 0.5s}
.events{margin-top:4px}
.events h2{font-size:12px;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
.event-item{display:flex;justify-content:space-between;align-items:center;padding:6px 0;
  border-bottom:1px solid ${theme === 'dark' ? '#1a1a4e' : '#dee2e6'};font-size:12px}
.event-item:last-child{border-bottom:none}
.event-type{font-weight:600;flex:1}
.event-loc{opacity:0.6;flex:1;text-align:center}
.event-time{opacity:0.5;font-size:11px}
.footer{margin-top:14px;text-align:center;font-size:10px;opacity:0.4}
.alert-banner{background:#ef4444;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;
  margin-bottom:12px;font-weight:600;display:none}
.alert-banner.visible{display:block}
</style>
</head>
<body>
<div class="header"><h1>Security Status</h1><span class="status-dot" id="dot"></span></div>
<div class="alert-banner" id="alertBanner"></div>
<div class="grid">
  <div class="card">
    <div class="label">Active Alarms</div>
    <div class="value alarm-value" id="alarms">--</div>
  </div>
  <div class="card">
    <div class="label">Open Incidents</div>
    <div class="value incident-value" id="incidents">--</div>
  </div>
  <div class="card">
    <div class="label">Devices Online</div>
    <div class="value online-value" id="devices">--</div>
    <div class="health-bar"><div class="health-fill" id="healthBar" style="width:0%"></div></div>
  </div>
  <div class="card grade-wrap">
    <div class="label">Posture</div>
    <div class="grade-circle grade-NA" id="gradeCircle">--</div>
  </div>
</div>
<div class="events">
  <h2>Recent Events</h2>
  <div id="eventList"><div class="event-item" style="opacity:0.5">Loading...</div></div>
</div>
<div class="footer">Auto-refreshes every ${Math.round(refreshMs / 1000)}s &middot; EdgeRuntime</div>
<script>
(function(){
  var dataUrl = location.origin + '/api/v1/widget/data' + ${JSON.stringify(dataQs)};
  function fmt(ts){
    try { var d = new Date(ts); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
    catch(e) { return ''; }
  }
  function update(data){
    document.getElementById('alarms').textContent = data.active_alarms;
    document.getElementById('incidents').textContent = data.open_incidents;
    document.getElementById('devices').textContent = data.devices_online + '/' + data.devices_total;
    var pct = data.devices_total > 0 ? Math.round((data.devices_online / data.devices_total) * 100) : 0;
    document.getElementById('healthBar').style.width = pct + '%';
    var gc = document.getElementById('gradeCircle');
    gc.textContent = data.posture_grade || '--';
    gc.className = 'grade-circle grade-' + (data.posture_grade || 'NA');
    var el = document.getElementById('eventList');
    if (data.recent_events && data.recent_events.length) {
      el.innerHTML = data.recent_events.slice(0, 3).map(function(e){
        return '<div class="event-item">'
          + '<span class="event-type">' + e.type + '</span>'
          + '<span class="event-loc">' + e.location + '</span>'
          + '<span class="event-time">' + fmt(e.time) + '</span>'
          + '</div>';
      }).join('');
    } else {
      el.innerHTML = '<div class="event-item" style="opacity:0.5">No recent events</div>';
    }
    var banner = document.getElementById('alertBanner');
    if (data.alerts && data.alerts.length) {
      banner.textContent = data.alerts[0].message;
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
    document.getElementById('dot').style.background = '#22c55e';
    try { window.parent.postMessage({ type: 'widget_data', data: data }, '*'); } catch(e){}
  }
  function load(){
    fetch(dataUrl).then(function(r){ return r.json(); }).then(update).catch(function(){
      document.getElementById('dot').style.background = '#ef4444';
    });
  }
  load();
  setInterval(load, ${refreshMs});
})();
</script>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // ─── GET /widget/health — Widget health check ───────────────────
  fastify.get('/widget/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  log.info('Widget routes registered');
}
