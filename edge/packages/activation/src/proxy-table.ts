/**
 * Proxy Lookup Table
 *
 * Maps proxy index (0-1023) to cloud sync server entries.
 * The activation key encodes a proxy index that routes the edge device
 * to the correct cloud backend.
 *
 * Index allocation:
 *   0     = SafeSchool (public, free for schools)
 *   10    = SafeSchool staging/dev
 *
 * Additional proxy entries can be loaded at runtime from environment variables:
 *   EDGERUNTIME_PROXY_{index}=https://your-cloud.example.com
 *   Or bulk-loaded from EDGERUNTIME_PROXY_TABLE_JSON (JSON file path).
 */

import { readFileSync, existsSync } from 'node:fs';

export interface ProxyEntry {
  url: string;
  region: string;
  weight: number;
  /** Additional regional endpoints for geo-routing and failover */
  regions?: ProxyEntry[];
}

const PROXY_TABLE: (ProxyEntry | null)[] = new Array(1024).fill(null);

// Index 0: SafeSchool - free for schools, public cloud
PROXY_TABLE[0] = {
  url: 'https://edge.safeschool.org',
  region: 'us-east',
  weight: 1,
};

// Index 10: SafeSchool staging/dev
PROXY_TABLE[10] = {
  url: 'https://edge-staging.safeschool.org',
  region: 'us-east',
  weight: 0,
};

/**
 * Load additional proxy entries from environment variables.
 */
function loadExtraProxies(): void {
  const jsonPath = process.env.EDGERUNTIME_PROXY_TABLE_JSON;
  if (jsonPath && existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, 'utf-8');
      const entries = JSON.parse(raw) as Record<string, ProxyEntry & { regions?: ProxyEntry[] }>;
      for (const [indexStr, entry] of Object.entries(entries)) {
        const index = parseInt(indexStr, 10);
        if (index >= 0 && index < 1024 && entry.url) {
          PROXY_TABLE[index] = {
            url: entry.url,
            region: entry.region ?? 'unknown',
            weight: entry.weight ?? 1,
            regions: entry.regions?.map((r) => ({
              url: r.url,
              region: r.region ?? 'unknown',
              weight: r.weight ?? 1,
            })),
          };
        }
      }
    } catch {
      // Silently skip - extra proxies are optional
    }
  }

  for (let i = 0; i < 1024; i++) {
    const envUrl = process.env[`EDGERUNTIME_PROXY_${i}`];
    if (envUrl === 'none' || envUrl === 'disabled') {
      PROXY_TABLE[i] = null;
      continue;
    }
    if (envUrl) {
      const envRegion = process.env[`EDGERUNTIME_PROXY_${i}_REGION`] ?? 'unknown';
      const regionsEnv = process.env[`EDGERUNTIME_PROXY_${i}_REGIONS`];
      let regions: ProxyEntry[] | undefined;
      if (regionsEnv) {
        regions = regionsEnv
          .split(',')
          .map((url) => url.trim())
          .filter((url) => url.length > 0)
          .map((url, idx) => ({
            url,
            region: process.env[`EDGERUNTIME_PROXY_${i}_REGION_${idx}`] ?? 'unknown',
            weight: 1,
          }));
      }
      PROXY_TABLE[i] = { url: envUrl, region: envRegion, weight: 1, regions };
    }
  }
}

loadExtraProxies();

export const PRODUCT_PROXY_INDEX = {
  safeschool: 0,
} as const;

export const STAGING_PROXY_INDEX = {
  safeschool: 10,
} as const;

export function getProxyEntry(index: number): ProxyEntry | undefined {
  if (index < 0 || index >= PROXY_TABLE.length) return undefined;
  return PROXY_TABLE[index] ?? undefined;
}

export function resolveProxy(index: number): string | null {
  const entry = getProxyEntry(index);
  return entry?.url ?? null;
}

export function getProxyTableSize(): number {
  return PROXY_TABLE.length;
}

export function getConfiguredProxyCount(): number {
  return PROXY_TABLE.filter((e) => e !== null).length;
}

export function getProxyWithRegions(index: number): (ProxyEntry & { regions: ProxyEntry[] }) | undefined {
  const entry = getProxyEntry(index);
  if (!entry) return undefined;
  return { ...entry, regions: entry.regions ?? [] };
}

export function setProxyEntry(index: number, entry: ProxyEntry): void {
  if (index >= 0 && index < 1024) {
    PROXY_TABLE[index] = entry;
  }
}
