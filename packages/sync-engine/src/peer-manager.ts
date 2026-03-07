/**
 * EdgeRuntime Peer Manager
 *
 * Manages peer discovery and peer-to-peer sync between edge devices
 * in the same organization. Cloud is the authority for peer discovery —
 * peers are returned in the heartbeat response.
 *
 * Peer sync uses the same push/pull/HMAC protocol as cloud sync.
 */

import { createLogger } from '@edgeruntime/core';
import { SyncClient, type SyncEntity, type PullResponse, type PeerInfo } from './sync-client.js';

const log = createLogger('peer-manager');

export { type PeerInfo };

export class PeerManager {
  private peers: PeerInfo[] = [];
  private readonly syncKey: string;
  private readonly timeoutMs: number;

  constructor(config: { syncKey: string; timeoutMs?: number }) {
    this.syncKey = config.syncKey;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  /**
   * Update the peer list from a heartbeat response.
   */
  updatePeers(peers: PeerInfo[]): void {
    this.peers = peers;
    log.debug({ peerCount: peers.length }, 'Peer list updated');
  }

  /**
   * Get current known peers.
   */
  getPeers(): PeerInfo[] {
    return [...this.peers];
  }

  /**
   * Check which peers are reachable by hitting their /health endpoint.
   */
  async getReachablePeers(): Promise<PeerInfo[]> {
    if (this.peers.length === 0) return [];

    const results = await Promise.allSettled(
      this.peers.map(async (peer) => {
        const client = this.createClient(peer);
        const ok = await client.checkHealth();
        return ok ? peer : null;
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<PeerInfo | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((p): p is PeerInfo => p !== null);
  }

  /**
   * Pull from the best reachable peer (first one that responds).
   * Returns the pull response, or null if no peers reachable.
   */
  async syncFromBestPeer(siteId: string, since: Date): Promise<PullResponse | null> {
    for (const peer of this.peers) {
      try {
        const client = this.createClient(peer);
        const response = await client.pull(siteId, since);
        log.info({ peer: peer.siteId, ip: peer.ipAddress }, 'Pulled from peer');
        return response;
      } catch (err) {
        log.debug({ peer: peer.siteId, err }, 'Peer pull failed, trying next');
      }
    }
    return null;
  }

  /**
   * Push local changes to all reachable peers.
   */
  async pushToPeers(siteId: string, entities: SyncEntity[]): Promise<void> {
    if (entities.length === 0 || this.peers.length === 0) return;

    const results = await Promise.allSettled(
      this.peers.map(async (peer) => {
        const client = this.createClient(peer);
        const result = await client.push(siteId, entities);
        log.debug({ peer: peer.siteId, synced: result.synced }, 'Pushed to peer');
        return result;
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      log.warn({ succeeded, failed, total: this.peers.length }, 'Some peer pushes failed');
    }
  }

  private createClient(peer: PeerInfo): SyncClient {
    return new SyncClient({
      baseUrl: `http://${peer.ipAddress}:${peer.apiPort}`,
      syncKey: this.syncKey,
      timeoutMs: this.timeoutMs,
    });
  }
}
