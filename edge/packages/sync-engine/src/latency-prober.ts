/**
 * LatencyProber
 *
 * Measures endpoint latency via HEAD /health requests and selects
 * the fastest healthy endpoint. Used for auto geo-routing and failover.
 *
 * - Uses Promise.allSettled() so one slow endpoint doesn't block others
 * - 3-second timeout per probe
 * - Probes 3 times, uses median latency to avoid outliers
 */

import { createLogger } from '@edgeruntime/core';

/** Minimal proxy entry shape (avoids dependency on @edgeruntime/activation) */
export interface ProxyEndpoint {
  url: string;
  region: string;
  weight: number;
}

const log = createLogger('latency-prober');

const PROBE_TIMEOUT_MS = 3000;
const PROBE_COUNT = 3;

export interface ProbeResult {
  url: string;
  region: string;
  healthy: boolean;
  medianLatencyMs: number;
  probeResults: number[];
}

export class LatencyProber {
  /**
   * Probe a single endpoint once. Returns latency in ms, or -1 if unhealthy.
   */
  private async probeSingle(url: string): Promise<number> {
    const healthUrl = `${url.replace(/\/+$/, '')}/health`;
    const start = performance.now();

    try {
      const response = await fetch(healthUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (!response.ok) return -1;
      return performance.now() - start;
    } catch {
      return -1;
    }
  }

  /**
   * Probe all endpoints, returning latency results for each.
   */
  async probeAll(endpoints: ProxyEndpoint[]): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    const probePromises = endpoints.map(async (endpoint) => {
      const latencies: number[] = [];

      for (let i = 0; i < PROBE_COUNT; i++) {
        const latency = await this.probeSingle(endpoint.url);
        latencies.push(latency);
      }

      // Filter out failed probes (-1)
      const successfulLatencies = latencies.filter((l) => l >= 0);
      const healthy = successfulLatencies.length > 0;

      // Use median of successful probes
      let medianLatencyMs = Infinity;
      if (healthy) {
        successfulLatencies.sort((a, b) => a - b);
        const mid = Math.floor(successfulLatencies.length / 2);
        medianLatencyMs = successfulLatencies[mid]!;
      }

      const result: ProbeResult = {
        url: endpoint.url,
        region: endpoint.region,
        healthy,
        medianLatencyMs,
        probeResults: latencies,
      };

      results.push(result);
      return result;
    });

    await Promise.allSettled(probePromises);
    return results;
  }

  /**
   * Probe all endpoints and return the fastest healthy one.
   * Falls back to the first endpoint if none are healthy.
   */
  async selectBest(endpoints: ProxyEndpoint[]): Promise<ProxyEndpoint> {
    if (endpoints.length === 0) {
      throw new Error('No endpoints to probe');
    }

    if (endpoints.length === 1) {
      return endpoints[0]!;
    }

    const results = await this.probeAll(endpoints);

    log.info(
      { probes: results.map((r) => ({ url: r.url, region: r.region, latencyMs: r.medianLatencyMs, healthy: r.healthy })) },
      'Latency probe results',
    );

    // Pick fastest healthy endpoint
    const healthyResults = results.filter((r) => r.healthy);
    if (healthyResults.length === 0) {
      log.warn('No healthy endpoints found, using first endpoint');
      return endpoints[0]!;
    }

    healthyResults.sort((a, b) => a.medianLatencyMs - b.medianLatencyMs);
    const best = healthyResults[0]!;

    log.info(
      { url: best.url, region: best.region, latencyMs: best.medianLatencyMs },
      'Selected fastest endpoint',
    );

    // Find and return the matching ProxyEndpoint
    return endpoints.find((e) => e.url === best.url) ?? endpoints[0]!;
  }

  /**
   * Re-probe endpoints excluding a failed URL. Used for failover.
   * Returns the best healthy alternative.
   */
  async failover(failedUrl: string, allEndpoints: ProxyEndpoint[]): Promise<ProxyEndpoint | null> {
    const alternatives = allEndpoints.filter((e) => e.url !== failedUrl);

    if (alternatives.length === 0) {
      log.warn({ failedUrl }, 'No alternative endpoints for failover');
      return null;
    }

    log.info(
      { failedUrl, alternatives: alternatives.map((e) => e.url) },
      'Probing alternatives for failover',
    );

    const results = await this.probeAll(alternatives);
    const healthyResults = results.filter((r) => r.healthy);

    if (healthyResults.length === 0) {
      log.warn({ failedUrl }, 'No healthy alternatives found for failover');
      return null;
    }

    healthyResults.sort((a, b) => a.medianLatencyMs - b.medianLatencyMs);
    const best = healthyResults[0]!;
    const bestEntry = alternatives.find((e) => e.url === best.url) ?? null;

    if (bestEntry) {
      log.info(
        { failedUrl, newUrl: bestEntry.url, region: bestEntry.region, latencyMs: best.medianLatencyMs },
        'Failover target selected',
      );
    }

    return bestEntry;
  }
}
