/**
 * Adapter Manifest Builder
 *
 * Scans the adapters source directory for .meta.ts files, extracts
 * adapter metadata, and produces a manifest.json used by the adapter
 * registry routes at runtime. Run this at build/deploy time so the
 * cloud never has to dynamically import TypeScript at request time.
 *
 * Usage (CLI):
 *   npx tsx packages/cloud-sync/src/adapter-manifest.ts --src adapters/src --out adapters/dist/manifest.json
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, basename, dirname, relative } from 'node:path';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('adapter-manifest');

// ─── Types ──────────────────────────────────────────────────────────

export interface AdapterManifestEntry {
  /** Adapter ID — e.g. 'access-control/lenel' */
  id: string;
  /** Category slug — e.g. 'access-control' */
  category: string;
  /** Vendor slug — e.g. 'lenel' */
  vendor: string;
  /** Human-readable name — e.g. 'Lenel OnGuard' */
  displayName: string;
  /** One-line description */
  summary: string;
  /** Stability status */
  status: string;
  /** Semver version */
  version: string;
  /** Pre-built bundle size in bytes (populated after esbuild) */
  bundleSize?: number;
  /** Relative path to the JS bundle from the bundles root */
  bundlePath?: string;
  /** SHA-256 hex hash of the bundle for integrity verification */
  bundleHash?: string;
  /** Other adapter IDs this adapter depends on */
  dependencies?: string[];
}

export interface AdapterManifestCategory {
  /** Category slug */
  id: string;
  /** Human-readable name */
  name: string;
  /** Number of adapters in this category */
  adapterCount: number;
}

export interface AdapterManifest {
  /** Manifest schema version */
  version: string;
  /** ISO timestamp of when this manifest was built */
  builtAt: string;
  /** All adapter entries */
  adapters: AdapterManifestEntry[];
  /** Category summary */
  categories: AdapterManifestCategory[];
}

// ─── Category display names ─────────────────────────────────────────

const CATEGORY_NAMES: Record<string, string> = {
  'access-control': 'Access Control',
  'cameras': 'Cameras & Video',
  'intrusion-panel': 'Intrusion Panels',
  'fire-alarm': 'Fire Alarm',
  'elevator-control': 'Elevator Control',
  'biometrics': 'Biometrics',
  'mustering': 'Mustering',
  'guard-tour': 'Guard Tour',
  'hr-sync': 'HR Sync',
  'ldap': 'LDAP / Directory',
  'pms': 'Property Management',
  'telephony': 'Telephony',
  'ble-reader': 'BLE Readers',
  'nfc-reader': 'NFC Readers',
  'ehr': 'EHR',
  'nurse-call': 'Nurse Call',
  'rtls': 'Real-Time Location',
  'dispatch': 'Dispatch / 911',
  'visitor-mgmt': 'Visitor Management',
  'badge-printing': 'Badge Printing',
  'notifications': 'Notifications',
  'reporting': 'Reporting',
  'intercom': 'Intercom',
  'weapons-detection': 'Weapons Detection',
  'panic-devices': 'Panic Devices',
  'lpr': 'License Plate Recognition',
  'gunshot-detection': 'Gunshot Detection',
  'social-media': 'Social Media',
  'threat-assessment': 'Threat Assessment',
  'threat-intel': 'Threat Intelligence',
  'environmental': 'Environmental Sensors',
  'weather': 'Weather',
  'transportation': 'Transportation',
  'grants': 'Grants & Funding',
  'ai': 'AI / Analytics',
  'finance': 'Finance',
  'cloud-storage': 'Cloud Storage',
  'construction': 'Construction',
  'shipping': 'Shipping & Receiving',
  'auth': 'Authentication',
};

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Recursively find all .meta.ts files under a directory.
 */
async function findMetaFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(current, entry);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }

      if (info.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith('.meta.ts')) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results.sort();
}

/**
 * Extract adapter metadata from a .meta.ts file without importing it.
 * Parses the key fields we need using regex — avoids needing a TS compiler
 * at build time while still getting the essential metadata.
 */
async function extractMetaFromFile(filePath: string): Promise<AdapterManifestEntry | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    log.warn({ err, filePath }, 'Could not read meta file');
    return null;
  }

  const extract = (key: string): string | undefined => {
    // Match patterns like:  id: 'access-control/lenel',  or  id: "access-control/lenel",
    const match = content.match(new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`));
    return match?.[1];
  };

  const id = extract('id');
  const category = extract('category');
  const vendor = extract('vendor');
  const displayName = extract('displayName');
  const summary = extract('summary');
  const status = extract('status');
  const version = extract('version');

  if (!id || !category || !vendor) {
    log.warn({ filePath }, 'Meta file missing required fields (id, category, vendor)');
    return null;
  }

  return {
    id,
    category,
    vendor,
    displayName: displayName || vendor,
    summary: summary || '',
    status: status || 'experimental',
    version: version || '0.0.0',
  };
}

// ─── Main builder ───────────────────────────────────────────────────

/**
 * Scan the adapters source directory and build a manifest.
 *
 * @param adapterSrcDir  Path to the adapters/src/ directory
 * @returns The built manifest
 */
export async function buildAdapterManifest(adapterSrcDir: string): Promise<AdapterManifest> {
  log.info({ adapterSrcDir }, 'Building adapter manifest');

  const metaFiles = await findMetaFiles(adapterSrcDir);
  log.info('Found %d .meta.ts files', metaFiles.length);

  const adapters: AdapterManifestEntry[] = [];

  for (const file of metaFiles) {
    const entry = await extractMetaFromFile(file);
    if (entry) {
      adapters.push(entry);
    }
  }

  // Deduplicate by ID (in case of multiple meta files for the same adapter)
  const seen = new Set<string>();
  const deduped = adapters.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Build category summary
  const categoryMap = new Map<string, number>();
  for (const adapter of deduped) {
    categoryMap.set(adapter.category, (categoryMap.get(adapter.category) || 0) + 1);
  }

  const categories: AdapterManifestCategory[] = Array.from(categoryMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => ({
      id,
      name: CATEGORY_NAMES[id] || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      adapterCount: count,
    }));

  const manifest: AdapterManifest = {
    version: '1.0.0',
    builtAt: new Date().toISOString(),
    adapters: deduped.sort((a, b) => a.id.localeCompare(b.id)),
    categories,
  };

  log.info(
    'Manifest built: %d adapters across %d categories',
    manifest.adapters.length,
    manifest.categories.length,
  );

  return manifest;
}

/**
 * Build and write manifest to a file.
 */
export async function buildAndWriteManifest(
  adapterSrcDir: string,
  outputPath: string,
): Promise<AdapterManifest> {
  const manifest = await buildAdapterManifest(adapterSrcDir);
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
  log.info('Manifest written to %s', outputPath);
  return manifest;
}

// ─── CLI entry point ────────────────────────────────────────────────

if (process.argv[1] && (process.argv[1].endsWith('adapter-manifest.ts') || process.argv[1].endsWith('adapter-manifest.js'))) {
  const args = process.argv.slice(2);
  let srcDir = 'adapters/src';
  let outPath = 'adapters/dist/manifest.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && args[i + 1]) srcDir = args[++i]!;
    if (args[i] === '--out' && args[i + 1]) outPath = args[++i]!;
  }

  buildAndWriteManifest(srcDir, outPath)
    .then((m) => {
      console.log(`Built manifest: ${m.adapters.length} adapters, ${m.categories.length} categories`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to build manifest:', err);
      process.exit(1);
    });
}
