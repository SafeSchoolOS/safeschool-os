import type { DispatchAdapter, DispatchPayload, DispatchResult } from './index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchAttempt {
  adapterName: string;
  method: string;
  startedAt: string; // ISO timestamp
  completedAt: string;
  success: boolean;
  dispatchId: string;
  responseTimeMs: number;
  error?: string;
}

export interface DispatchChainResult extends DispatchResult {
  /** All dispatch attempts in order. */
  attempts: DispatchAttempt[];
  /** Whether failover was triggered. */
  failoverUsed: boolean;
  /** Name of the adapter that ultimately succeeded (if any). */
  successfulAdapter?: string;
}

export interface DispatchChainConfig {
  /** Timeout per adapter in ms (default 15000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// DispatchChain
// ---------------------------------------------------------------------------

/**
 * DispatchChain implements the DispatchAdapter interface itself so it
 * can be used transparently wherever a single adapter is expected.
 *
 * Failover order: primary -> secondary -> cellular (if provided).
 * Each adapter is given a configurable timeout. If it fails or times out
 * the chain moves to the next adapter.
 */
export class DispatchChain implements DispatchAdapter {
  name = 'DispatchChain';

  private primary: DispatchAdapter;
  private secondary: DispatchAdapter | null;
  private cellular: DispatchAdapter | null;
  private timeoutMs: number;

  constructor(
    primary: DispatchAdapter,
    secondary: DispatchAdapter | null = null,
    cellular: DispatchAdapter | null = null,
    config: DispatchChainConfig = {},
  ) {
    this.primary = primary;
    this.secondary = secondary;
    this.cellular = cellular;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  // -----------------------------------------------------------------------
  // DispatchAdapter interface
  // -----------------------------------------------------------------------

  async dispatch(alert: DispatchPayload): Promise<DispatchChainResult> {
    const attempts: DispatchAttempt[] = [];
    const adapters: DispatchAdapter[] = [this.primary];
    if (this.secondary) adapters.push(this.secondary);
    if (this.cellular) adapters.push(this.cellular);

    for (const adapter of adapters) {
      const attempt = await this.tryAdapter(adapter, alert);
      attempts.push(attempt);

      if (attempt.success) {
        return {
          success: true,
          dispatchId: attempt.dispatchId,
          method: attempt.method,
          responseTimeMs: this.totalResponseTime(attempts),
          attempts,
          failoverUsed: attempts.length > 1,
          successfulAdapter: adapter.name,
        };
      }

      console.warn(
        `[DispatchChain] ${adapter.name} failed: ${attempt.error ?? 'unknown'}. ` +
          (adapters.indexOf(adapter) < adapters.length - 1
            ? 'Trying next adapter...'
            : 'No more adapters.'),
      );
    }

    // All adapters failed
    return {
      success: false,
      dispatchId: '',
      method: 'CHAIN_EXHAUSTED',
      responseTimeMs: this.totalResponseTime(attempts),
      error: `All dispatch adapters failed: ${attempts.map((a) => `${a.adapterName}(${a.error})`).join(', ')}`,
      attempts,
      failoverUsed: attempts.length > 1,
    };
  }

  async getStatus(dispatchId: string): Promise<string> {
    // Try to determine which adapter owns this dispatch ID from the method prefix
    const adapters = [this.primary, this.secondary, this.cellular].filter(
      Boolean,
    ) as DispatchAdapter[];

    for (const adapter of adapters) {
      try {
        const status = await adapter.getStatus(dispatchId);
        return status;
      } catch {
        // Try next adapter
      }
    }

    return 'UNKNOWN';
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async tryAdapter(
    adapter: DispatchAdapter,
    alert: DispatchPayload,
  ): Promise<DispatchAttempt> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
      const result = await this.withTimeout(
        adapter.dispatch(alert),
        this.timeoutMs,
        adapter.name,
      );

      return {
        adapterName: adapter.name,
        method: result.method,
        startedAt,
        completedAt: new Date().toISOString(),
        success: result.success,
        dispatchId: result.dispatchId,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      };
    } catch (err) {
      return {
        adapterName: adapter.name,
        method: adapter.name.toUpperCase().replace(/\s+/g, '_'),
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        dispatchId: '',
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private totalResponseTime(attempts: DispatchAttempt[]): number {
    return attempts.reduce((sum, a) => sum + a.responseTimeMs, 0);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Convenience factory for creating a DispatchChain from adapters.
 */
export function createDispatchChain(
  primary: DispatchAdapter,
  secondary?: DispatchAdapter | null,
  cellular?: DispatchAdapter | null,
  config?: DispatchChainConfig,
): DispatchChain {
  return new DispatchChain(
    primary,
    secondary ?? null,
    cellular ?? null,
    config,
  );
}
