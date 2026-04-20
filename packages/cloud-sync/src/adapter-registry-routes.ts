/**
 * Adapter Registry Routes — On-demand adapter plugin system
 *
 * Cloud-hosted registry of all available adapter plugins.
 * Edge devices query this registry to discover and download
 * the specific adapters their recipe requires.
 *
 * Endpoints:
 *   GET  /                         — List all available adapters
 *   GET  /categories               — List adapter categories with counts
 *   GET  /:category                — List adapters in a category
 *   GET  /:category/:name          — Get specific adapter metadata
 *   GET  /:category/:name/bundle   — Download adapter JS bundle
 *   POST /resolve                  — Resolve recipe/integrations to adapters
 */

import { createReadStream } from 'node:fs';
import { readFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('cloud-sync:adapter-registry');

export interface AdapterRegistryRoutesOptions {
  /** Path to the pre-built manifest.json (from esbuild-adapters.mjs) */
  manifestPath?: string;
  /** Path to directory containing pre-built adapter bundles */
  bundlesDir?: string;
}

interface AdapterManifestEntry {
  id: string;
  category: string;
  name: string;
  bundlePath?: string;
  bundleSize?: number;
  bundleHash?: string;
  hasMeta: boolean;
  vendor?: string;
  displayName?: string;
  summary?: string;
  status?: string;
  version?: string;
  dependencies?: string[];
}

interface AdapterManifest {
  version: string;
  builtAt: string;
  adapters: AdapterManifestEntry[];
  categories: Array<{ id: string; name: string; adapterCount: number }>;
}

// ─── Manifest cache ──────────────────────────────────────────────────

let cachedManifest: AdapterManifest | null = null;
let manifestLoadedAt = 0;
const MANIFEST_CACHE_TTL_MS = 60_000;

async function loadManifest(manifestPath: string): Promise<AdapterManifest> {
  const now = Date.now();
  if (cachedManifest && now - manifestLoadedAt < MANIFEST_CACHE_TTL_MS) {
    return cachedManifest;
  }

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    cachedManifest = JSON.parse(raw) as AdapterManifest;
    manifestLoadedAt = now;
    return cachedManifest;
  } catch (err) {
    if (cachedManifest) {
      log.warn({ err }, 'Failed to reload manifest, using cached version');
      return cachedManifest;
    }
    throw err;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

// ─── Plugin ──────────────────────────────────────────────────────────

export async function adapterRegistryRoutes(
  fastify: FastifyInstance,
  options: AdapterRegistryRoutesOptions,
): Promise<void> {
  const manifestPath = options.manifestPath
    || process.env.ADAPTER_MANIFEST_PATH
    || join(process.cwd(), 'adapters', 'dist', 'bundles', 'manifest.json');

  const bundlesDir = options.bundlesDir
    || process.env.ADAPTER_BUNDLES_DIR
    || join(process.cwd(), 'adapters', 'dist', 'bundles');

  if (!(await fileExists(manifestPath))) {
    log.warn('Adapter manifest not found at %s — registry will return empty results', manifestPath);
  }

  // ─── GET / — Full adapter catalog ─────────────────────────────────

  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifest = await loadManifest(manifestPath);
      return reply.send({
        adapters: manifest.adapters,
        categories: manifest.categories,
        version: manifest.version,
        builtAt: manifest.builtAt,
      });
    } catch (err) {
      log.error({ err }, 'Failed to load adapter manifest');
      return reply.code(503).send({ error: 'Adapter manifest not available. Run: node adapters/esbuild-adapters.mjs' });
    }
  });

  // ─── GET /categories — Category list ──────────────────────────────

  fastify.get('/categories', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifest = await loadManifest(manifestPath);
      return reply.send({ categories: manifest.categories });
    } catch {
      return reply.code(503).send({ error: 'Adapter manifest not available' });
    }
  });

  // ─── GET /:category — Adapters in a category ─────────────────────

  fastify.get('/:category', async (request: FastifyRequest, reply: FastifyReply) => {
    const { category } = request.params as { category: string };

    try {
      const manifest = await loadManifest(manifestPath);
      const adapters = manifest.adapters.filter(a => a.category === category);

      if (adapters.length === 0) {
        const categoryExists = manifest.categories.some(c => c.id === category);
        if (!categoryExists) {
          return reply.code(404).send({
            error: `Category not found: ${category}`,
            availableCategories: manifest.categories.map(c => c.id),
          });
        }
      }

      return reply.send({ category, adapters });
    } catch {
      return reply.code(503).send({ error: 'Adapter manifest not available' });
    }
  });

  // ─── GET /:category/:name — Adapter metadata ─────────────────────

  fastify.get('/:category/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { category, name } = request.params as { category: string; name: string };
    const adapterId = `${category}/${name}`;

    try {
      const manifest = await loadManifest(manifestPath);
      const adapter = manifest.adapters.find(a => a.id === adapterId);

      if (!adapter) {
        return reply.code(404).send({ error: `Adapter not found: ${adapterId}` });
      }

      // Try loading full meta from built meta bundle
      let fullMeta: any = null;
      const metaBundlePath = join(bundlesDir, category, `${name}.meta.mjs`);
      if (await fileExists(metaBundlePath)) {
        try {
          const metaModule = await import(`file://${metaBundlePath.replace(/\\/g, '/')}`);
          fullMeta = metaModule.meta || metaModule.default;
        } catch {
          // Fall through to basic info
        }
      }

      // Check bundle availability
      const bundlePath = join(bundlesDir, category, `${name}.mjs`);
      const bundleAvailable = await fileExists(bundlePath);

      return reply.send({
        ...(fullMeta || adapter),
        bundleAvailable,
        bundleSize: adapter.bundleSize,
        bundleHash: adapter.bundleHash,
        downloadUrl: bundleAvailable ? `/api/v1/adapters/${category}/${name}/bundle` : undefined,
      });
    } catch {
      return reply.code(503).send({ error: 'Adapter manifest not available' });
    }
  });

  // ─── GET /:category/:name/bundle — Download adapter bundle ────────

  fastify.get('/:category/:name/bundle', async (request: FastifyRequest, reply: FastifyReply) => {
    const { category, name } = request.params as { category: string; name: string };
    const bundlePath = join(bundlesDir, category, `${name}.mjs`);

    if (!(await fileExists(bundlePath))) {
      return reply.code(404).send({ error: `Bundle not found: ${category}/${name}` });
    }

    try {
      const bundleStat = await stat(bundlePath);
      const content = await readFile(bundlePath);
      const hash = createHash('sha256').update(content).digest('hex');

      // ETag-based caching
      const etag = `"${hash}"`;
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }

      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Content-Length', bundleStat.size)
        .header('ETag', etag)
        .header('X-Bundle-Hash', hash)
        .header('X-Adapter-Id', `${category}/${name}`)
        .header('Cache-Control', 'public, max-age=3600, must-revalidate')
        .send(createReadStream(bundlePath));
    } catch (err) {
      log.error({ err }, 'Failed to serve adapter bundle');
      return reply.code(500).send({ error: 'Failed to read bundle file' });
    }
  });

  // ─── POST /resolve — Resolve recipe → required adapters ───────────

  fastify.post('/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { recipe?: string; integrations?: string[] } | null;

    if (!body || (!body.recipe && (!body.integrations || body.integrations.length === 0))) {
      return reply.code(400).send({ error: 'Provide "recipe" name or "integrations" adapter ID list' });
    }

    try {
      const manifest = await loadManifest(manifestPath);
      const requestedIds = body.integrations || [];

      const resolved: AdapterManifestEntry[] = [];
      const missing: string[] = [];
      let totalSize = 0;

      for (const id of requestedIds) {
        const adapter = manifest.adapters.find(a => a.id === id);
        if (adapter) {
          resolved.push(adapter);
          totalSize += adapter.bundleSize || 0;

          // Resolve transitive dependencies
          if (adapter.dependencies) {
            for (const depId of adapter.dependencies) {
              if (!requestedIds.includes(depId) && !resolved.some(r => r.id === depId)) {
                const dep = manifest.adapters.find(a => a.id === depId);
                if (dep) {
                  resolved.push(dep);
                  totalSize += dep.bundleSize || 0;
                } else {
                  missing.push(depId);
                }
              }
            }
          }
        } else {
          missing.push(id);
        }
      }

      return reply.send({
        adapters: resolved,
        missing: missing.length > 0 ? missing : undefined,
        totalBundles: resolved.length,
        totalSize,
        allResolved: missing.length === 0,
        downloadUrls: resolved.map(a => ({
          id: a.id,
          url: `/api/v1/adapters/${a.category}/${a.name}/bundle`,
          size: a.bundleSize,
          hash: a.bundleHash,
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to resolve adapters');
      return reply.code(503).send({ error: 'Adapter manifest not available' });
    }
  });

  // ─── POST /check-updates — Check for adapter updates ────────────────

  fastify.post('/check-updates', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { installedAdapters?: Record<string, string>; runtimeVersion?: string } | null;

    if (!body || !body.installedAdapters || Object.keys(body.installedAdapters).length === 0) {
      return reply.code(400).send({ error: 'Provide "installedAdapters" map of adapterId -> version' });
    }

    try {
      const manifest = await loadManifest(manifestPath);
      const updates: Array<{
        adapterId: string;
        currentVersion: string;
        targetVersion: string;
        bundleUrl: string;
        bundleHash: string;
        bundleSize: number;
        priority: string;
      }> = [];

      for (const [adapterId, installedVersion] of Object.entries(body.installedAdapters)) {
        const entry = manifest.adapters.find(a => a.id === adapterId);
        if (!entry || !entry.version) continue;

        // Simple semver comparison
        if (isNewerVersion(entry.version, installedVersion)) {
          const majorBump = parseInt(entry.version.split('.')[0]) > parseInt(installedVersion.split('.')[0]);
          updates.push({
            adapterId: entry.id,
            currentVersion: installedVersion,
            targetVersion: entry.version,
            bundleUrl: `/api/v1/adapters/${entry.category}/${entry.name}/bundle`,
            bundleHash: entry.bundleHash || '',
            bundleSize: entry.bundleSize || 0,
            priority: majorBump ? 'critical' : 'normal',
          });
        }
      }

      return reply.send({
        updates,
        upToDate: updates.length === 0,
        checkedAt: new Date().toISOString(),
        totalAdaptersChecked: Object.keys(body.installedAdapters).length,
      });
    } catch (err) {
      log.error({ err }, 'Failed to check for adapter updates');
      return reply.code(503).send({ error: 'Adapter manifest not available' });
    }
  });

  log.info('Adapter registry routes registered (manifest: %s)', manifestPath);
}

/** Check if version a is newer than version b */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}
