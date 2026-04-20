// @ts-nocheck
/**
 * Cardholder Sync API Routes
 *
 * Fastify plugin providing bidirectional cardholder sync management between
 * EdgeRuntime and PAC (Physical Access Control) systems.
 *
 * Mount behind JWT auth at prefix '/api/v1/sync/cardholders':
 *
 * Endpoints:
 *   POST   /                 — Trigger full sync
 *   GET    /status           — Get sync status (last sync time, counts)
 *   GET    /mappings         — List all mappings with match status
 *   GET    /conflicts        — List unresolved conflicts
 *   POST   /conflicts/:edgeId/resolve — Resolve a conflict
 *   GET    /config           — Get sync configuration
 *   PUT    /config           — Update sync config
 *   POST   /import           — Force full import from PAC (overwrites)
 *   POST   /export           — Force push all edge records to PAC
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import pg from 'pg';

const log = createLogger('cloud-sync:cardholder-sync-routes');

export interface CardholderSyncRoutesOptions {
  connectionString?: string;
}

export async function cardholderSyncRoutes(fastify: FastifyInstance, opts: CardholderSyncRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — cardholder sync routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Lazy-load the sync engine to avoid circular deps
  let syncEngine: any = null;
  let engineInit = false;

  async function getEngine() {
    if (syncEngine) return syncEngine;

    try {
      const { CardholderSyncEngine, DemoPacAdapter } = await import('@edgeruntime/sync-engine');

      // Check if we have a real PAC adapter configured
      const isDemoMode = process.env.DEMO_MODE === 'true' || !process.env.PAC_ADAPTER_URL;

      let adapter: any;
      if (isDemoMode) {
        // Get edge cardholders for demo matching
        const { rows } = await pool.query(
          `SELECT id, data FROM sync_entities WHERE entity_type = 'cardholder' ORDER BY updated_at DESC LIMIT 100`,
        ).catch((err) => { log.warn({ err }, 'Failed to query edge cardholders for demo adapter'); return { rows: [] }; });

        const edgeCardholders = rows.map((r: any) => {
          const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
          return { edgeId: r.id, ...d };
        });

        adapter = new DemoPacAdapter(edgeCardholders);
        log.info('Using demo PAC adapter for cardholder sync');
      } else {
        // Real PAC adapter integration is not yet wired up in cloud routes.
        //
        // The adapter-loader system (packages/sync-engine/src/adapter-loader.ts)
        // handles downloading and caching vendor adapter bundles on the edge,
        // but this cloud-side route doesn't have access to the ConnectorRegistry
        // or a live PAC connection. To implement real sync:
        //   1. Edge device runs cardholder sync locally via ConnectorRegistry
        //      → BaseConnector PAC adapter
        //   2. Cloud receives results via the normal sync-engine push
        //   3. This cloud route only needs to read/write sync_entities
        //
        // Until edge-side cardholder sync is wired, fall back to DemoPacAdapter
        // so the API endpoints remain functional for dashboard development.
        log.warn('PAC_ADAPTER_URL is set but real PAC adapter loading is not implemented in cloud routes — using DemoPacAdapter fallback');
        const { rows } = await pool.query(
          `SELECT id, data FROM sync_entities WHERE entity_type = 'cardholder' ORDER BY updated_at DESC LIMIT 100`,
        ).catch((err) => { log.warn({ err }, 'Failed to query edge cardholders for PAC adapter'); return { rows: [] }; });
        const edgeCardholders = rows.map((r: any) => {
          const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
          return { edgeId: r.id, ...d };
        });
        adapter = new DemoPacAdapter(edgeCardholders);
      }

      syncEngine = new CardholderSyncEngine(pool, adapter);

      if (!engineInit) {
        await syncEngine.init();
        engineInit = true;
      }

      return syncEngine;
    } catch (err: any) {
      log.error({ err: err.message }, 'Failed to initialize cardholder sync engine');
      throw err;
    }
  }

  // ─── POST / — Trigger full sync ────────────────────────────────

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const result = await engine.sync();
      return reply.send({ ok: true, result });
    } catch (err: any) {
      log.error({ err: err.message }, 'Cardholder sync failed');
      return reply.code(500).send({ error: 'Sync failed', details: err.message });
    }
  });

  // ─── GET /status — Get sync status ─────────────────────────────

  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const status = await engine.getStatus();
      return reply.send(status);
    } catch (err: any) {
      log.error({ err: err.message }, 'Failed to get sync status');
      return reply.code(500).send({ error: 'Failed to get status', details: err.message });
    }
  });

  // ─── GET /mappings — List all mappings ─────────────────────────

  fastify.get('/mappings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const mappings = await engine.getMappings();

      // Enrich with cardholder names from sync_entities
      const edgeIds = mappings.map((m: any) => m.edgeId).filter(Boolean);
      let nameMap: Record<string, string> = {};
      if (edgeIds.length > 0) {
        const placeholders = edgeIds.map((_: any, i: number) => `$${i + 1}`).join(',');
        const { rows } = await pool.query(
          `SELECT id, data FROM sync_entities WHERE id IN (${placeholders}) AND entity_type = 'cardholder'`,
          edgeIds,
        ).catch((err) => { log.warn({ err }, 'Failed to query cardholder names for mapping enrichment'); return { rows: [] }; });
        for (const row of rows) {
          const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          nameMap[row.id] = `${d.firstName || ''} ${d.lastName || ''}`.trim() || row.id;
        }
      }

      const enriched = mappings.map((m: any) => ({
        ...m,
        name: nameMap[m.edgeId] || m.edgeId,
        hashMatch: m.edgeHash === m.pacHash,
      }));

      return reply.send({ mappings: enriched, total: enriched.length });
    } catch (err: any) {
      log.error({ err: err.message }, 'Failed to get mappings');
      return reply.code(500).send({ error: 'Failed to get mappings', details: err.message });
    }
  });

  // ─── GET /conflicts — List unresolved conflicts ────────────────

  fastify.get('/conflicts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const conflicts = await engine.getConflicts();
      return reply.send({ conflicts, total: conflicts.length });
    } catch (err: any) {
      log.error({ err: err.message }, 'Failed to get conflicts');
      return reply.code(500).send({ error: 'Failed to get conflicts', details: err.message });
    }
  });

  // ─── POST /conflicts/:edgeId/resolve — Resolve a conflict ─────

  fastify.post('/conflicts/:edgeId/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const { edgeId } = request.params as { edgeId: string };
    const { resolutions } = request.body as { resolutions: Record<string, 'pac' | 'edge'> };

    if (!resolutions || typeof resolutions !== 'object') {
      return reply.code(400).send({ error: 'resolutions object required. e.g. { "badgeNumber": "pac", "email": "edge" }' });
    }

    try {
      const engine = await getEngine();
      await engine.resolveConflict(edgeId, resolutions);
      return reply.send({ ok: true, edgeId, resolved: Object.keys(resolutions).length });
    } catch (err: any) {
      log.error({ err: err.message, edgeId }, 'Failed to resolve conflict');
      return reply.code(500).send({ error: 'Failed to resolve conflict', details: err.message });
    }
  });

  // ─── GET /config — Get sync configuration ─────────────────────

  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const config = engine.getConfig();
      return reply.send(config);
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to get config', details: err.message });
    }
  });

  // ─── PUT /config — Update sync configuration ──────────────────

  fastify.put('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const updates = request.body as Record<string, unknown>;

    // Validate allowed fields
    const allowed = ['defaultAuthority', 'pacAuthorityFields', 'edgeAuthorityFields',
      'mergeFields', 'autoResolve', 'matchStrategy', 'syncIntervalMs', 'pacSystem'];
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (allowed.includes(key)) filtered[key] = val;
    }

    if (Object.keys(filtered).length === 0) {
      return reply.code(400).send({ error: 'No valid config fields provided', allowed });
    }

    try {
      const engine = await getEngine();
      engine.updateConfig(filtered);
      return reply.send({ ok: true, config: engine.getConfig() });
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to update config', details: err.message });
    }
  });

  // ─── POST /import — Force full import from PAC ────────────────

  fastify.post('/import', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const result = await engine.pullFromPac();
      return reply.send({ ok: true, result });
    } catch (err: any) {
      log.error({ err: err.message }, 'PAC import failed');
      return reply.code(500).send({ error: 'Import failed', details: err.message });
    }
  });

  // ─── POST /export — Force push all edge records to PAC ────────

  fastify.post('/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engine = await getEngine();
      const result = await engine.pushToPac();
      return reply.send({ ok: true, result });
    } catch (err: any) {
      log.error({ err: err.message }, 'PAC export failed');
      return reply.code(500).send({ error: 'Export failed', details: err.message });
    }
  });

  log.info('Cardholder sync routes registered');
}
