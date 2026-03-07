/**
 * Module Registry
 *
 * Based on GSOC ConnectorRegistry pattern. Manages module instances
 * and their lifecycle.
 */

import { ModuleError, createLogger } from '@edgeruntime/core';
import type { IEdgeModule, ModuleHealthStatus } from './module-interface.js';

const log = createLogger('module-registry');

export class ModuleRegistry {
  private modules: Map<string, IEdgeModule> = new Map();

  /**
   * Register a loaded module instance.
   */
  register(name: string, module: IEdgeModule): void {
    if (this.modules.has(name)) {
      throw new ModuleError(`Module "${name}" is already registered`, name);
    }
    this.modules.set(name, module);
    log.info({ module: name }, 'Module registered');
  }

  /**
   * Get a module by name.
   */
  get(name: string): IEdgeModule | undefined {
    return this.modules.get(name);
  }

  /**
   * Get all registered modules.
   */
  getAll(): Map<string, IEdgeModule> {
    return new Map(this.modules);
  }

  /**
   * Get names of all registered modules.
   */
  getNames(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Remove a module.
   */
  remove(name: string): boolean {
    const removed = this.modules.delete(name);
    if (removed) {
      log.info({ module: name }, 'Module removed');
    }
    return removed;
  }

  /**
   * Start all registered modules.
   */
  async startAll(): Promise<void> {
    for (const [name, module] of this.modules) {
      try {
        await module.start();
        log.info({ module: name }, 'Module started');
      } catch (err) {
        log.error({ err, module: name }, 'Module failed to start');
      }
    }
  }

  /**
   * Stop all registered modules.
   */
  async stopAll(): Promise<void> {
    for (const [name, module] of this.modules) {
      try {
        await module.stop();
        log.info({ module: name }, 'Module stopped');
      } catch (err) {
        log.error({ err, module: name }, 'Module failed to stop');
      }
    }
  }

  /**
   * Health check all modules.
   */
  async healthCheckAll(): Promise<Record<string, ModuleHealthStatus>> {
    const results: Record<string, ModuleHealthStatus> = {};
    for (const [name, module] of this.modules) {
      try {
        results[name] = await module.healthCheck();
      } catch (err) {
        results[name] = { healthy: false, details: { error: String(err) } };
      }
    }
    return results;
  }
}
