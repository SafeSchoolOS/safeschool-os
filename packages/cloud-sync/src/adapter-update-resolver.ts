// @ts-nocheck
/**
 * Adapter Update Resolver
 *
 * Compares a device's installed adapter versions against the current
 * manifest and produces update directives. Called during heartbeat
 * processing and via the explicit check-updates endpoint.
 */

import { createLogger } from '@edgeruntime/core';

const log = createLogger('cloud-sync:adapter-update-resolver');

export interface ManifestEntry {
  id: string;
  version: string;
  category: string;
  vendor: string;
  bundlePath: string;
  bundleHash: string;
  bundleSize: number;
  minRuntimeVersion?: string;
  status: string;
}

export interface UpdateDirective {
  adapterId: string;
  targetVersion: string;
  bundleUrl: string;
  bundleHash: string;
  bundleSize: number;
  priority: 'critical' | 'normal' | 'low';
  minRuntimeVersion?: string;
}

export interface UpdateCheckRequest {
  installedAdapters: Record<string, string>;
  runtimeVersion?: string;
}

export interface UpdateCheckResponse {
  updates: UpdateDirective[];
  upToDate: boolean;
  checkedAt: string;
}

/**
 * Compare installed adapter versions against manifest.
 * Returns directives for adapters that have newer versions available.
 */
export function resolveUpdates(
  installed: Record<string, string>,
  manifest: ManifestEntry[],
  runtimeVersion?: string,
  registryBaseUrl?: string,
): UpdateDirective[] {
  const updates: UpdateDirective[] = [];
  const base = registryBaseUrl || '/api/v1/adapters';

  for (const entry of manifest) {
    const installedVersion = installed[entry.id];
    if (!installedVersion) continue; // Device doesn't have this adapter
    if (entry.status === 'deprecated') continue; // Don't push deprecated adapters

    // Simple semver comparison — newer version available?
    if (!isNewer(entry.version, installedVersion)) continue;

    // Check runtime compatibility
    if (entry.minRuntimeVersion && runtimeVersion) {
      if (!isCompatible(runtimeVersion, entry.minRuntimeVersion)) {
        log.debug({ id: entry.id, requires: entry.minRuntimeVersion, device: runtimeVersion }, 'Skipping update — runtime too old');
        continue;
      }
    }

    // Determine priority
    const majorBump = getMajor(entry.version) > getMajor(installedVersion);
    const priority: UpdateDirective['priority'] = majorBump ? 'critical' : 'normal';

    updates.push({
      adapterId: entry.id,
      targetVersion: entry.version,
      bundleUrl: `${base}/${entry.category}/${entry.id.split('/')[1]}/bundle`,
      bundleHash: entry.bundleHash || '',
      bundleSize: entry.bundleSize || 0,
      priority,
      minRuntimeVersion: entry.minRuntimeVersion,
    });
  }

  return updates;
}

/** Parse major version from semver string */
function getMajor(version: string): number {
  const m = version.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Check if version a is newer than version b (simple semver) */
function isNewer(a: string, b: string): boolean {
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

/** Check if runtime version meets minimum requirement */
function isCompatible(runtimeVersion: string, minRequired: string): boolean {
  return !isNewer(minRequired, runtimeVersion);
}
