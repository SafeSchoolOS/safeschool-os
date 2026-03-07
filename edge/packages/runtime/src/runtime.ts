/**
 * EdgeRuntime Class
 *
 * Main orchestrator. Boot sequence:
 * 1. Load config
 * 2. Read & validate activation key
 * 3. Decode key -> extract products, tier, proxyIndex
 * 4. Verify HMAC (offline, no network)
 * 5. Resolve proxy URL from lookup table
 * 6. Init sync engine with proxy URL as cloudSyncUrl
 * 7. Load enabled product modules via module-loader
 * 8. Each module registers its connectors + conflict strategies
 * 9. Start sync engine
 * 10. Start Fastify API server
 */

import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { createLogger, ActivationError, type EdgeRuntimeConfig, type ProductFlag } from '@edgeruntime/core';
import { validateKey, validateKeys, type ValidationResult, PRODUCT_PROXY_INDEX, getProxyWithRegions } from '@edgeruntime/activation';
import { SyncEngine, type SyncRouteConfig, LatencyProber, FederationManager } from '@edgeruntime/sync-engine';
import { ModuleLoader, ModuleRegistry } from '@edgeruntime/module-loader';
import { ConnectorRegistry } from '@edgeruntime/connector-framework';
import { createApiServer, ConnectorEventBuffer } from './api-server.js';
import type { FastifyInstance } from 'fastify';
import type { RealtimeChannel } from '@edgeruntime/cloud-sync';

const log = createLogger('runtime');

export class EdgeRuntime {
  private config: EdgeRuntimeConfig;
  private activation: ValidationResult | null = null;
  private syncEngine: SyncEngine | null = null;
  private moduleRegistry: ModuleRegistry | null = null;
  private connectorRegistry: ConnectorRegistry;
  private connectorEvents: ConnectorEventBuffer;
  private federationManager: FederationManager | null = null;
  private apiServer: FastifyInstance | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private cameraSyncHandle: ReturnType<typeof setInterval> | null = null;

  constructor(config: EdgeRuntimeConfig) {
    this.config = config;
    this.connectorRegistry = new ConnectorRegistry();
    this.connectorEvents = new ConnectorEventBuffer(1000);
  }

  async boot(): Promise<void> {
    log.info('EdgeRuntime booting...');

    // Step 1: Ensure data directory
    const dataDir = resolve(this.config.dataDir);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Step 2-4: Validate activation key(s) — supports single key or array
    if (!this.config.activationKey || (Array.isArray(this.config.activationKey) && this.config.activationKey.length === 0)) {
      throw new ActivationError('No activation key provided. Set EDGERUNTIME_ACTIVATION_KEY or config.activationKey');
    }

    const keys = Array.isArray(this.config.activationKey)
      ? this.config.activationKey
      : [this.config.activationKey];

    this.activation = keys.length === 1
      ? validateKey(keys[0]!)
      : validateKeys(keys);

    if (!this.activation.valid) {
      throw new ActivationError(`Activation key invalid: ${this.activation.error}`);
    }

    log.info({
      products: this.activation.products,
      tier: this.activation.tier,
      proxyUrl: this.activation.proxyUrl,
      keyCount: keys.length,
    }, 'Activation key(s) validated');

    // Step 5: Resolve primary proxy URL (used for heartbeat/upgrade)
    const cloudSyncUrl = this.activation.proxyUrl;
    if (!cloudSyncUrl) {
      throw new ActivationError(
        `Proxy index ${this.activation.proxyIndex} is not configured. ` +
        `Set EDGERUNTIME_PROXY_${this.activation.proxyIndex} environment variable to the cloud sync URL.`,
      );
    }
    const cloudSyncKey = this.config.cloudSyncKey ?? 'default-sync-key';
    const queueDbPath = resolve(dataDir, 'sync-queue.db');

    // Step 6: Create SyncEngine with primary URL (modules can trackChange immediately)
    this.syncEngine = new SyncEngine({
      siteId: this.config.siteId,
      cloudSyncUrl,
      cloudSyncKey,
      syncIntervalMs: this.config.syncIntervalMs,
      healthCheckIntervalMs: this.config.healthCheckIntervalMs,
      queueDbPath,
      dataDir,
      cloudTlsFingerprint: this.config.cloudTlsFingerprint,
      operatingMode: this.config.operatingMode,
      orgId: this.config.orgId,
    });

    // Step 7: Load product modules
    const enabledProducts = this.activation.products!;
    const conflictResolver = this.syncEngine.getConflictResolver();

    // Collect federation handlers registered by modules (deferred — FederationManager created later)
    const federationHandlers: Array<(fromProduct: string, events: Record<string, unknown>[]) => Record<string, unknown>[]> = [];

    const moduleLoader = new ModuleLoader({
      moduleDirs: this.config.moduleDirs ?? ['./modules'],
      enabledProducts,
      context: {
        siteId: this.config.siteId,
        dataDir,
        registerConflictStrategy: (entityType, strategy) => {
          conflictResolver.registerStrategy(entityType, strategy as any);
        },
        registerConflictMerger: (entityType, merger) => {
          conflictResolver.registerMerger(entityType, merger);
        },
        registerConnectorType: (typeName, connectorClass) => {
          this.connectorRegistry.registerType(typeName, connectorClass);
        },
        trackChange: (entity) => {
          this.syncEngine!.trackChange(entity);
        },
        registerFederationHandler: (handler) => {
          federationHandlers.push(handler);
        },
        userAccountStore: this.syncEngine.userAccountStore,
      },
    });

    this.moduleRegistry = await moduleLoader.loadAll();

    log.info({
      modules: this.moduleRegistry.getNames(),
    }, 'Modules loaded');

    // Step 8: Build routing map from loaded module manifests
    const routeConfigs = await this.buildRoutingMap(enabledProducts);

    if (routeConfigs.length > 0) {
      this.syncEngine.setRoutes(routeConfigs);
      log.info({ routes: routeConfigs.length }, 'Multi-backend sync routing activated');
    }

    // Step 9: Start sync engine (now routes correctly)
    this.syncEngine.start();

    // Start modules
    await this.moduleRegistry.startAll();

    // Step 9b: Instantiate connectors from config
    if (this.config.connectors && this.config.connectors.length > 0) {
      for (const connDef of this.config.connectors) {
        try {
          const { name, type, enabled, pollIntervalMs, ...rest } = connDef;
          this.connectorRegistry.createConnector(name, type, {
            enabled,
            pollIntervalMs: pollIntervalMs ?? 5000,
            ...rest,
          });
          log.info({ name, type }, 'Connector instance created from config');
        } catch (err) {
          log.warn({ err, name: connDef.name, type: connDef.type }, 'Failed to create connector (type may not be registered by any module)');
        }
      }
      // Wire up event handlers to buffer connector events and sync to cloud
      for (const connector of this.connectorRegistry.getAllConnectors()) {
        connector.onEvents((name, events) => {
          this.connectorEvents.push(name, events);
          log.debug({ connector: name, count: events.length }, 'Connector events received');

          // Also queue connector events as sync entities for cloud push
          if (this.syncEngine && this.config.operatingMode !== 'CLOUD') {
            for (const evt of events) {
              // Map connector source to registered entity type so SyncRouter can route it
              const entityType = this.inferEntityType(evt);
              this.syncEngine.trackChange({
                type: entityType,
                action: 'create',
                data: { ...evt, id: evt.eventId || `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
                timestamp: (evt.timestamp as string) || new Date().toISOString(),
              });
            }
          }
        });
      }

      await this.connectorRegistry.startAll();
      log.info({ count: this.connectorRegistry.getAllConnectors().length }, 'Connectors started');

      // Step 9b-2: Sync camera entities from VMS connectors (runs once now, then every 5 min)
      this.syncCameraEntities();
      this.cameraSyncHandle = setInterval(() => this.syncCameraEntities(), 5 * 60 * 1000);
    }

    // Step 9c: Register remote config handler (cloud pushes settings via heartbeat)
    if (this.config.operatingMode !== 'CLOUD') {
      this.syncEngine.onConfigChange(async (config) => {
        await this.applyRemoteConfig(config);
      });
    }

    // Step 10: Federation — cross-product event sharing between edge VMs
    if (this.config.federation?.enabled && this.config.federation.peers.length > 0) {
      const enabledProducts = this.activation!.products!;
      // Filter peers to only those whose product is in our activation key
      const gatedPeers = this.config.federation.peers.filter(
        p => enabledProducts.includes(p.product),
      );

      if (gatedPeers.length > 0) {
        this.federationManager = new FederationManager({
          federation: { ...this.config.federation, peers: gatedPeers },
          enabledProducts,
          siteId: this.config.siteId,
          syncKey: cloudSyncKey,
        });

        // Listen for connector events and forward to federation
        this.connectorEvents.onPush((name, events) => {
          this.federationManager!.onConnectorEvents(name, events);
        });

        // Wire deferred federation handlers from modules
        for (const handler of federationHandlers) {
          this.federationManager.registerHandler(handler);
        }

        this.federationManager.start();
        log.info({ peers: gatedPeers.map(p => p.product) }, 'Federation manager started');
      } else {
        log.info('Federation configured but no peers match activation key — skipping');
      }
    }

    // Step 11: Start API server (in CLOUD mode, mount cloud-sync routes)
    const apiResult = await createApiServer({
      syncEngine: this.syncEngine,
      moduleRegistry: this.moduleRegistry,
      connectorRegistry: this.connectorRegistry,
      connectorEvents: this.connectorEvents,
      federationManager: this.federationManager ?? undefined,
      port: this.config.apiPort,
      operatingMode: this.config.operatingMode,
      userAccountStore: this.syncEngine.userAccountStore,
      ...(this.config.operatingMode === 'CLOUD' ? {
        cloudOptions: {
          syncKey: cloudSyncKey,
          syncAdapter: this.config.cloudSyncAdapter ?? await this.createDefaultSyncAdapter(),
          licenseAdapter: this.config.cloudLicenseAdapter ?? await this.createDefaultLicenseAdapter(),
          getOrgId: this.config.cloudGetOrgId,
          homepageHtml: await this.loadHomepageHtml(),
        },
      } : {}),
    });
    this.apiServer = apiResult.app;
    this.realtimeChannel = apiResult.realtimeChannel ?? null;

    log.info({
      siteId: this.config.siteId,
      mode: this.syncEngine.getOperatingMode(),
      products: enabledProducts,
      tier: this.activation.tier,
      apiPort: this.config.apiPort,
    }, 'EdgeRuntime booted successfully');
  }

  /**
   * Build routing map from module manifests.
   * Each module's manifest declares its product and entityTypes.
   * We look up each product's proxy URL (with optional geo-routing)
   * and create a SyncRouteConfig per product.
   */
  private async buildRoutingMap(enabledProducts: ProductFlag[]): Promise<SyncRouteConfig[]> {
    if (!this.moduleRegistry) return [];

    const modules = [...this.moduleRegistry.getAll().values()];
    const routeConfigs: SyncRouteConfig[] = [];
    const latencyProber = new LatencyProber();
    const seenProducts = new Set<ProductFlag>();

    for (const mod of modules) {
      const manifest = mod.getManifest();
      const product = manifest.product;

      if (seenProducts.has(product)) continue;
      seenProducts.add(product);

      // Look up proxy index for this product
      const proxyIndex = PRODUCT_PROXY_INDEX[product as keyof typeof PRODUCT_PROXY_INDEX];
      if (proxyIndex === undefined) {
        log.warn({ product }, 'No proxy index for product, skipping route');
        continue;
      }

      const proxyEntry = getProxyWithRegions(proxyIndex);
      if (!proxyEntry) {
        log.warn({ product, proxyIndex }, 'No proxy entry for product, skipping route');
        continue;
      }

      // Auto geo-routing: if regional endpoints exist, probe and pick fastest
      let bestUrl = proxyEntry.url;
      if (proxyEntry.regions.length > 0) {
        try {
          const allEndpoints = [proxyEntry, ...proxyEntry.regions];
          const best = await latencyProber.selectBest(allEndpoints);
          bestUrl = best.url;
          log.info({ product, bestUrl, region: best.region }, 'Geo-routing: selected fastest endpoint');
        } catch (err) {
          log.warn({ product, err }, 'Geo-routing probe failed, using primary URL');
        }
      }

      // Collect entity types from all modules for this product
      const entityTypes: string[] = [];
      for (const m of modules) {
        if (m.getManifest().product === product) {
          entityTypes.push(...m.getManifest().entityTypes);
        }
      }

      routeConfigs.push({
        product,
        cloudSyncUrl: bestUrl,
        entityTypes,
      });
    }

    return routeConfigs;
  }

  /**
   * Create a default in-memory SyncDatabaseAdapter for CLOUD mode dev/testing.
   * Production deployments should provide their own adapter via config.
   */
  private async createDefaultSyncAdapter() {
    const { MemoryAdapter } = await import('@edgeruntime/cloud-sync');
    log.warn('Using in-memory SyncDatabaseAdapter — data will be lost on restart. Provide cloudSyncAdapter in config for production.');
    return new MemoryAdapter();
  }

  /**
   * Create a default in-memory LicenseDatabaseAdapter for CLOUD mode dev/testing.
   * Production deployments should provide their own adapter via config.
   */
  private async createDefaultLicenseAdapter() {
    const { MemoryAdapter } = await import('@edgeruntime/cloud-sync');
    log.warn('Using in-memory LicenseDatabaseAdapter — data will be lost on restart. Provide cloudLicenseAdapter in config for production.');
    return new MemoryAdapter();
  }

  /** Load optional product homepage HTML. Tries HOMEPAGE_HTML_PATH env var first, then cloud-sync package loader. */
  private async loadHomepageHtml(): Promise<string | undefined> {
    // Try explicit path first
    const htmlPath = process.env.HOMEPAGE_HTML_PATH;
    if (htmlPath) {
      try {
        const html = readFileSync(htmlPath, 'utf-8');
        log.info({ path: htmlPath }, 'Loaded homepage HTML from path');
        return html;
      } catch {
        log.debug({ path: htmlPath }, 'HOMEPAGE_HTML_PATH not found, trying package loader');
      }
    }

    // Try loading by product name via cloud-sync package
    const homepageName = process.env.HOMEPAGE_NAME;
    if (homepageName) {
      try {
        const { loadHomepageHtml: loadFromPackage } = await import('@edgeruntime/cloud-sync');
        const html = loadFromPackage(homepageName);
        if (html) {
          log.info({ name: homepageName }, 'Loaded homepage HTML from package');
          return html;
        }
      } catch (err) {
        log.warn({ err, name: homepageName }, 'Failed to load homepage from package');
      }
    }

    return undefined;
  }

  async shutdown(): Promise<void> {
    log.info('EdgeRuntime shutting down...');

    if (this.cameraSyncHandle) {
      clearInterval(this.cameraSyncHandle);
      this.cameraSyncHandle = null;
    }

    if (this.realtimeChannel) {
      this.realtimeChannel.shutdown();
    }

    if (this.apiServer) {
      await this.apiServer.close();
    }

    if (this.federationManager) {
      this.federationManager.shutdown();
    }

    await this.connectorRegistry.stopAll();

    if (this.moduleRegistry) {
      await this.moduleRegistry.stopAll();
    }

    if (this.syncEngine) {
      this.syncEngine.shutdown();
    }

    log.info('EdgeRuntime shutdown complete');
  }

  getActivation(): ValidationResult | null {
    return this.activation;
  }

  getSyncEngine(): SyncEngine | null {
    return this.syncEngine;
  }

  getModuleRegistry(): ModuleRegistry | null {
    return this.moduleRegistry;
  }

  getConnectorRegistry(): ConnectorRegistry {
    return this.connectorRegistry;
  }

  /**
   * Enumerate cameras from VMS connectors and sync as camera entities.
   * Runs on startup and every 5 minutes so the cloud dashboard shows camera status.
   */
  private async syncCameraEntities(): Promise<void> {
    if (!this.syncEngine || this.config.operatingMode === 'CLOUD') return;

    for (const connector of this.connectorRegistry.getAllConnectors()) {
      // Check if connector has a listCameras method (VMS connectors like Milestone)
      const c = connector as any;
      if (typeof c.listCameras !== 'function') continue;

      try {
        const cameras = await c.listCameras();
        if (!Array.isArray(cameras) || cameras.length === 0) continue;

        for (const cam of cameras) {
          this.syncEngine.trackChange({
            type: 'camera',
            action: 'update',
            data: {
              id: cam.id || `${connector.name}_${cam.name}`,
              name: cam.name || cam.id,
              connectorName: connector.name,
              status: cam.enabled || cam.online ? 'online' : 'offline',
              connected: cam.enabled || cam.online || false,
              type: cam.type || 'IP Camera',
              location: cam.location || undefined,
              streamUrl: cam.streamUrl || undefined,
            },
            timestamp: new Date().toISOString(),
          });
        }

        log.info({ connector: connector.name, count: cameras.length }, 'Camera entities synced');
      } catch (err) {
        log.warn({ err, connector: connector.name }, 'Failed to sync camera entities');
      }
    }

    // Also extract cameras from recent video events (for connectors without listCameras)
    const events = this.connectorEvents.getAll();
    const seenCameras = new Set<string>();
    for (const evt of events) {
      const cameraId = evt.cameraId as string;
      const cameraName = evt.cameraName as string;
      if (!cameraId || seenCameras.has(cameraId)) continue;
      seenCameras.add(cameraId);

      const sourceSystem = (evt.sourceSystem as string) || '';
      if (!sourceSystem.toLowerCase().includes('milestone') &&
          !sourceSystem.toLowerCase().includes('xprotect') &&
          !sourceSystem.toLowerCase().includes('video') &&
          !sourceSystem.toLowerCase().includes('camera')) continue;

      this.syncEngine.trackChange({
        type: 'camera',
        action: 'update',
        data: {
          id: cameraId,
          name: cameraName || cameraId,
          connectorName: (evt._connector as string) || 'unknown',
          status: 'online',
          connected: true,
          type: 'IP Camera',
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (seenCameras.size > 0) {
      log.info({ count: seenCameras.size }, 'Camera entities extracted from video events');
    }
  }

  /**
   * Apply remote config received from cloud via heartbeat.
   * Updates connectors, sync settings, and persists to config.yaml.
   */
  private async applyRemoteConfig(config: import('@edgeruntime/sync-engine').DeviceConfigPayload): Promise<void> {
    log.info({ version: config.version }, 'Applying remote config');

    // Handle system commands first
    if (config.commands && config.commands.length > 0) {
      for (const cmd of config.commands) {
        log.info({ action: cmd.action, id: cmd.id }, 'Executing remote command');
        switch (cmd.action) {
          case 'restart':
            log.info('Restart requested — exiting for process manager to restart');
            setTimeout(() => process.exit(0), 1000);
            break;
          case 'reboot':
            try {
              const { execFile } = await import('node:child_process');
              execFile('reboot', [], (err) => {
                if (err) log.error({ err }, 'Reboot failed');
              });
            } catch (err) {
              log.error({ err }, 'Reboot command failed');
            }
            break;
          case 'clear_cache':
            // Clear sync queue
            if (this.syncEngine) {
              const queue = this.syncEngine.getOfflineQueue();
              queue.clear?.();
            }
            log.info('Cache cleared');
            break;
          case 'rotate_logs':
            log.info('Log rotation requested (handled by process manager)');
            break;
        }
      }
    }

    // Apply connector changes
    if (config.connectors) {
      log.info({ count: config.connectors.length }, 'Applying remote connector config');

      // Stop all existing connectors
      await this.connectorRegistry.stopAll();

      // Remove existing connectors
      for (const connector of this.connectorRegistry.getAllConnectors()) {
        await this.connectorRegistry.removeConnector(connector.name);
      }

      // Create new connectors from remote config
      for (const connDef of config.connectors) {
        try {
          const { name, type, enabled, pollIntervalMs, ...rest } = connDef;
          this.connectorRegistry.createConnector(name, type, {
            enabled,
            pollIntervalMs: pollIntervalMs ?? 5000,
            ...rest,
          });
          log.info({ name, type }, 'Remote connector created');
        } catch (err) {
          log.warn({ err, name: connDef.name, type: connDef.type }, 'Failed to create remote connector');
        }
      }

      // Wire event handlers for new connectors
      for (const connector of this.connectorRegistry.getAllConnectors()) {
        connector.onEvents((name, events) => {
          this.connectorEvents.push(name, events);
          if (this.syncEngine && this.config.operatingMode !== 'CLOUD') {
            for (const evt of events) {
              const entityType = this.inferEntityType(evt);
              this.syncEngine.trackChange({
                type: entityType,
                action: 'create',
                data: { ...evt, id: evt.eventId || `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
                timestamp: (evt.timestamp as string) || new Date().toISOString(),
              });
            }
          }
        });
      }

      await this.connectorRegistry.startAll();
      log.info({ count: this.connectorRegistry.getAllConnectors().length }, 'Remote connectors started');
    }

    // Persist to config.yaml so settings survive restarts
    this.persistRemoteConfig(config);
  }

  /**
   * Save remote config to config.yaml so it persists across restarts.
   */
  private persistRemoteConfig(config: import('@edgeruntime/sync-engine').DeviceConfigPayload): void {
    try {
      const configPath = process.env.EDGERUNTIME_CONFIG ?? resolve('config.yaml');
      let existing: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        try {
          existing = (yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {};
        } catch { /* start fresh */ }
      }

      if (config.connectors) {
        existing.connectors = config.connectors;
      }
      if (config.syncIntervalMs) {
        existing.syncIntervalMs = config.syncIntervalMs;
      }
      if (config.siteName) {
        existing.siteName = config.siteName;
      }
      if (config.federation) {
        existing.federation = config.federation;
      }

      // Track which remote config version is applied
      existing._remoteConfigVersion = config.version;

      writeFileSync(configPath, yaml.dump(existing, { lineWidth: 120 }), 'utf-8');
      log.info({ path: configPath, version: config.version }, 'Remote config persisted to YAML');
    } catch (err) {
      log.error({ err }, 'Failed to persist remote config to YAML');
    }
  }

  /**
   * Map a connector event to its registered entity type based on sourceSystem.
   * This ensures the SyncRouter can route events to the correct cloud backend.
   */
  private inferEntityType(evt: Record<string, unknown>): string {
    const source = ((evt.sourceSystem as string) ?? '').toLowerCase();
    if (source.includes('milestone') || source.includes('xprotect') || source.includes('video')) return 'video_event';
    if (source.includes('fire')) return 'fire_event';
    if (source.includes('intrusion')) return 'intrusion_event';
    if (source.includes('intercom')) return 'intercom_event';
    // Default: access control events (Lenel, vendor, vendor, S2, ASSA, etc.)
    return 'access_event';
  }
}
