/**
 * Pairing Client — Device-side HTTP client for pairing code flow
 *
 * Used by the setup wizard and sync engine to:
 *   1. Request a pairing code from the cloud
 *   2. Poll for claim status
 *   3. Receive activation key + cloud sync key on successful claim
 */

import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('pairing-client');

export interface PairingClientConfig {
  /** Cloud base URL (e.g., https://safeschoolos.org) */
  cloudUrl: string;
  /** Product slug (e.g., 'safeschool', 'safeschool') */
  product: string;
  /** Device fingerprint (auto-generated if not provided) */
  fingerprint?: string;
  /** Device hostname */
  hostname?: string;
  /** EdgeRuntime version */
  version?: string;
}

export interface PairingCodeResponse {
  code: string;
  expiresAt: string;
}

export interface ClaimResponse {
  activationKey: string;
  cloudSyncKey: string;
  siteId: string;
  siteName: string;
  orgId?: string;
  products: string[];
  tier: string;
  proxyUrl?: string;
}

/**
 * Get device fingerprint: SHA256(product + ':' + firstNonLoopbackMAC)
 */
export function getDeviceFingerprint(product: string): string {
  const mac = getFirstMac();
  return createHash('sha256').update(`${product}:${mac}`).digest('hex');
}

function getFirstMac(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return 'unknown';
}

export class PairingClient {
  private readonly cloudUrl: string;
  private readonly product: string;
  private readonly fingerprint: string;
  private readonly hostname?: string;
  private readonly version?: string;

  constructor(config: PairingClientConfig) {
    this.cloudUrl = config.cloudUrl.replace(/\/$/, '');
    this.product = config.product;
    this.fingerprint = config.fingerprint || getDeviceFingerprint(config.product);
    this.hostname = config.hostname;
    this.version = config.version;
  }

  /**
   * Request a pairing code from the cloud.
   */
  async requestCode(): Promise<PairingCodeResponse> {
    const url = `${this.cloudUrl}/api/v1/pairing/request`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: this.product,
        fingerprint: this.fingerprint,
        hostname: this.hostname,
        version: this.version,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Pairing request failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<PairingCodeResponse>;
  }

  /**
   * Poll for claim status. Resolves when claimed, rejects on expiry or abort.
   * Polls every 3 seconds.
   */
  async pollForClaim(code: string, signal?: AbortSignal): Promise<ClaimResponse> {
    const url = `${this.cloudUrl}/api/v1/pairing/status/${code}`;
    const POLL_INTERVAL = 3000;

    return new Promise<ClaimResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      let timer: ReturnType<typeof setInterval>;

      const cleanup = () => {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error('Aborted'));
      };

      signal?.addEventListener('abort', onAbort);

      const poll = async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            // Non-200 but not fatal — keep polling unless 404
            if (res.status === 404) {
              cleanup();
              reject(new Error('Code not found'));
              return;
            }
            return;
          }

          const data = await res.json() as Record<string, unknown>;

          if (data.status === 'claimed' && data.activationKey) {
            cleanup();
            resolve({
              activationKey: data.activationKey as string,
              cloudSyncKey: data.cloudSyncKey as string,
              siteId: data.siteId as string,
              siteName: data.siteName as string,
              orgId: data.orgId as string | undefined,
              products: data.products as string[],
              tier: data.tier as string,
              proxyUrl: data.proxyUrl as string | undefined,
            });
            return;
          }

          if (data.status === 'expired') {
            cleanup();
            reject(new Error('Code expired'));
            return;
          }

          // status === 'pending' — keep polling
        } catch (err) {
          log.warn({ err }, 'Pairing poll failed, will retry');
        }
      };

      // Initial poll
      poll();
      timer = setInterval(poll, POLL_INTERVAL);
    });
  }
}
