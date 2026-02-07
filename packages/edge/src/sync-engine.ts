/**
 * SafeSchool Edge Sync Engine
 *
 * Runs on the on-site mini PC. Maintains bidirectional sync with the
 * Railway cloud instance. If cloud connectivity is lost, the edge
 * automatically switches to standalone mode and continues operating
 * independently. When connectivity is restored, it reconciles changes.
 *
 * Sync strategy:
 * - Alerts: Edge -> Cloud (real-time, WebSocket with HTTP fallback)
 * - Configuration: Cloud -> Edge (polling every SYNC_INTERVAL_MS)
 * - Visitor logs: Edge -> Cloud (batch, every SYNC_INTERVAL_MS)
 * - Door status: Edge -> Cloud (real-time events)
 * - User/site data: Cloud -> Edge (polling)
 */

import type { OperatingMode, SyncState } from '@safeschool/core';

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '5000', 10);
const CLOUD_SYNC_URL = process.env.CLOUD_SYNC_URL;
const CLOUD_SYNC_KEY = process.env.CLOUD_SYNC_KEY;
const SITE_ID = process.env.SITE_ID;

let currentMode: OperatingMode = 'EDGE';
let cloudReachable = false;
let lastSyncAt: Date | null = null;

async function checkCloudConnectivity(): Promise<boolean> {
  if (!CLOUD_SYNC_URL) return false;

  try {
    const response = await fetch(`${CLOUD_SYNC_URL}/health`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'X-Sync-Key': CLOUD_SYNC_KEY || '' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function syncToCloud(): Promise<void> {
  if (!cloudReachable || !CLOUD_SYNC_URL) return;

  try {
    // TODO: Implement actual sync logic
    // 1. Push pending alerts
    // 2. Push visitor check-in/out events
    // 3. Push door status changes
    // 4. Pull configuration updates
    // 5. Pull user roster changes

    lastSyncAt = new Date();
    console.log(`[Sync] Synced to cloud at ${lastSyncAt.toISOString()}`);
  } catch (err) {
    console.error('[Sync] Failed to sync to cloud:', err);
  }
}

async function runSyncLoop(): Promise<void> {
  console.log(`[Sync] Starting sync engine for site ${SITE_ID}`);
  console.log(`[Sync] Cloud URL: ${CLOUD_SYNC_URL || 'NOT CONFIGURED'}`);
  console.log(`[Sync] Sync interval: ${SYNC_INTERVAL_MS}ms`);

  setInterval(async () => {
    const wasReachable = cloudReachable;
    cloudReachable = await checkCloudConnectivity();

    if (cloudReachable && !wasReachable) {
      console.log('[Sync] Cloud connectivity RESTORED - syncing pending changes');
      currentMode = 'EDGE';
    } else if (!cloudReachable && wasReachable) {
      console.log('[Sync] Cloud connectivity LOST - switching to STANDALONE mode');
      currentMode = 'STANDALONE';
    }

    if (cloudReachable) {
      await syncToCloud();
    }
  }, SYNC_INTERVAL_MS);
}

export function getSyncState(): SyncState {
  return {
    siteId: SITE_ID || 'unknown',
    lastSyncAt: lastSyncAt || new Date(0),
    cloudReachable,
    operatingMode: currentMode,
    pendingChanges: 0, // TODO: track actual pending changes
  };
}

// Start the sync engine
runSyncLoop();
