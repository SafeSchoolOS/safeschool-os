/**
 * Module Loader
 *
 * Discovers and dynamically imports product modules from configured directories.
 * Each module directory must export a default IEdgeModule implementation.
 */

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger, type ProductFlag } from '@edgeruntime/core';
import { ModuleRegistry } from './module-registry.js';
import type { IEdgeModule, ModuleContext } from './module-interface.js';

const log = createLogger('module-loader');

export interface ModuleLoaderConfig {
  moduleDirs: string[];
  enabledProducts: ProductFlag[];
  context: ModuleContext;
}

export class ModuleLoader {
  private readonly config: ModuleLoaderConfig;
  private readonly registry: ModuleRegistry;

  constructor(config: ModuleLoaderConfig) {
    this.config = config;
    this.registry = new ModuleRegistry();
  }

  /**
   * Discover and load all enabled modules from configured directories.
   */
  async loadAll(): Promise<ModuleRegistry> {
    for (const dir of this.config.moduleDirs) {
      const absDir = resolve(dir);

      if (!existsSync(absDir)) {
        log.warn({ dir: absDir }, 'Module directory does not exist, skipping');
        continue;
      }

      const entries = await readdir(absDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const modulePath = join(absDir, entry.name);
        try {
          await this.loadModule(modulePath, entry.name);
        } catch (err) {
          log.error({ err, module: entry.name }, 'Failed to load module');
        }
      }
    }

    return this.registry;
  }

  /**
   * Load a single module from a directory.
   */
  private async loadModule(modulePath: string, dirName: string): Promise<void> {
    // Try to find the module entry point
    const candidates = [
      join(modulePath, 'dist', 'index.js'),
      join(modulePath, 'src', 'index.js'),
      join(modulePath, 'index.js'),
    ];

    let entryPoint: string | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        entryPoint = candidate;
        break;
      }
    }

    if (!entryPoint) {
      log.warn({ module: dirName }, 'No entry point found, skipping');
      return;
    }

    // Dynamic import
    const moduleExport = await import(`file://${entryPoint.replace(/\\/g, '/')}`);
    const ModuleClass = moduleExport.default ?? moduleExport.Module ?? moduleExport[Object.keys(moduleExport)[0]!];

    if (!ModuleClass) {
      log.warn({ module: dirName }, 'No default export found, skipping');
      return;
    }

    // Instantiate
    const instance: IEdgeModule =
      typeof ModuleClass === 'function' ? new ModuleClass() : ModuleClass;

    const manifest = instance.getManifest();

    // Check if this product is enabled by the activation key
    if (!this.config.enabledProducts.includes(manifest.product)) {
      log.info({ module: manifest.name, product: manifest.product }, 'Product not enabled by license, skipping');
      return;
    }

    // Initialize the module
    await instance.initialize(this.config.context);

    // Register conflict strategies from manifest
    if (manifest.conflictStrategies) {
      for (const [entityType, strategy] of Object.entries(manifest.conflictStrategies)) {
        this.config.context.registerConflictStrategy(entityType, strategy);
      }
    }

    this.registry.register(manifest.name, instance);
    log.info({ module: manifest.name, version: manifest.version, product: manifest.product }, 'Module loaded');
  }

  getRegistry(): ModuleRegistry {
    return this.registry;
  }
}
