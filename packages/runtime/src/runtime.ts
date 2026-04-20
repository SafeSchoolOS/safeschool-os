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
import { AdapterInventory } from './adapter-inventory.js';
import { AdapterDownloader } from './adapter-downloader.js';
import { AdapterHotLoader } from './adapter-hot-loader.js';
import type { AdapterUpdateDirective } from '@edgeruntime/sync-engine';
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
  private adapterInventory: AdapterInventory | null = null;
  private adapterDownloader: AdapterDownloader | null = null;
  private adapterHotLoader: AdapterHotLoader | null = null;
  private adapterUpdateResults: import('@edgeruntime/sync-engine').AdapterUpdateResult[] = [];

  constructor(config: EdgeRuntimeConfig) {
    this.config = config;
    this.connectorRegistry = new ConnectorRegistry();
    this.connectorEvents = new ConnectorEventBuffer(1000);
  }

  /**
   * Boot the EdgeRuntime through the full initialization sequence.
   *
   * Steps (in order):
   *   1. Ensure data directory exists
   *   2-4. Validate activation key(s) — HMAC verification, product/tier extraction
   *   5. Resolve cloud proxy URL from activation key's proxy index
   *   6. Create SyncEngine with primary cloud URL
   *   7. Load product modules (registers connectors, conflict strategies, federation handlers)
   *   8. Build multi-backend sync routing map (geo-routed per product)
   *   9. Start sync engine, connectors, and realtime command handlers
   *   10. Initialize federation (cross-product event sharing between edge VMs)
   *   11. Start Fastify API server (with cloud routes if CLOUD/MIRROR mode)
   *
   * @throws {ActivationError} If no activation key is provided or key validation fails.
   * @throws {ActivationError} If the proxy index from the key has no configured URL.
   */
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
    let cloudSyncKey = this.config.cloudSyncKey;
    if (!cloudSyncKey) {
      // Auto-generate a key so the runtime can boot; cloud will reject syncs until keys match
      const { randomBytes } = await import('node:crypto');
      cloudSyncKey = randomBytes(32).toString('hex');
      log.warn('No cloudSyncKey configured — generated a random key. Set EDGERUNTIME_CLOUD_SYNC_KEY for cloud sync to work.');
    }
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
      activationKey: keys[0],
    });

    // Step 7: Load product modules
    const enabledProducts = this.activation.products!;
    const conflictResolver = this.syncEngine.getConflictResolver();

    // Collect federation handlers registered by modules.
    // These are deferred: modules register handlers during loadAll(), but the
    // FederationManager is created later (Step 10) after connectors are wired.
    // Each handler receives events from a peer product and returns filtered/transformed events.
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

    // Step 9b-3: Initialize adapter update system
    if (this.config.operatingMode !== 'CLOUD') {
      this.adapterInventory = new AdapterInventory(dataDir);
      this.adapterDownloader = new AdapterDownloader(cloudSyncUrl, dataDir, cloudSyncKey);
      this.adapterHotLoader = new AdapterHotLoader(this.connectorRegistry, this.adapterInventory);
      await this.adapterHotLoader.loadAllFromInventory();

      // Report installed adapters to sync engine (included in heartbeats)
      this.syncEngine!.setInstalledAdapters(this.adapterInventory.getVersionMap());
      log.info({ installedAdapters: Object.keys(this.adapterInventory.getVersionMap()).length }, 'Adapter update system initialized');
    }

    // Step 9c: Register remote config handler (cloud pushes settings via heartbeat)
    if (this.config.operatingMode !== 'CLOUD') {
      this.syncEngine.onConfigChange(async (config) => {
        await this.applyRemoteConfig(config);
      });

      // Step 9d: Register realtime command handlers — route cloud commands to PAC connectors
      const registry = this.connectorRegistry;

      // Lockdown: broadcast to all access control connectors
      this.syncEngine.onRealtimeCommand('lockdown', async (cmd) => {
        const results = await registry.executeCommand('lockdown', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      this.syncEngine.onRealtimeCommand('lockdown_end', async (cmd) => {
        const results = await registry.executeCommand('lockdown_end', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      this.syncEngine.onRealtimeCommand('lockdown_zone', async (cmd) => {
        const results = await registry.executeCommand('lockdown_zone', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      this.syncEngine.onRealtimeCommand('lockdown_building', async (cmd) => {
        const results = await registry.executeCommand('lockdown_building', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      // Door control: route to specific or all access connectors
      this.syncEngine.onRealtimeCommand('door_lock', async (cmd) => {
        const results = await registry.executeCommand('door_lock', cmd.payload, cmd.payload.connectorName as string | undefined);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      this.syncEngine.onRealtimeCommand('door_unlock', async (cmd) => {
        const results = await registry.executeCommand('door_unlock', cmd.payload, cmd.payload.connectorName as string | undefined);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      // Credential commands
      this.syncEngine.onRealtimeCommand('credential_suspend', async (cmd) => {
        const results = await registry.executeCommand('credential_suspend', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });
      this.syncEngine.onRealtimeCommand('credential_revoke', async (cmd) => {
        const results = await registry.executeCommand('credential_revoke', cmd.payload);
        const allOk = Object.values(results).every(r => r.status === 'completed');
        return { status: allOk ? 'completed' : 'failed', detail: JSON.stringify(results) };
      });

      // Report capabilities: edge sends capabilities on connect
      this.syncEngine.onRealtimeCommand('report_capabilities', async () => {
        const caps = registry.getCapabilitiesAll();
        return { status: 'completed', detail: JSON.stringify(caps) };
      });

      log.info('Realtime command handlers registered for PAC connector routing');
    }

    // Step 10: Federation — cross-product event sharing between edge VMs.
    // Federation allows multiple edge VMs (each running different products) to share
    // events over the local network. For example, a SafeSchool VM can receive
    // SafeSchool visitor events and display them on its dashboard.
    // Only peers whose product is in our activation key are connected (license-gated).
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

    // Step 11: Start API server
    // CLOUD mode: full cloud backend with all routes
    // MIRROR mode: edge device with local dashboard (EDGE sync + CLOUD routes backed by local data)
    const needsCloudRoutes = this.config.operatingMode === 'CLOUD' || this.config.operatingMode === 'MIRROR';
    const apiResult = await createApiServer({
      syncEngine: this.syncEngine,
      moduleRegistry: this.moduleRegistry,
      connectorRegistry: this.connectorRegistry,
      connectorEvents: this.connectorEvents,
      federationManager: this.federationManager ?? undefined,
      port: this.config.apiPort,
      operatingMode: this.config.operatingMode,
      userAccountStore: this.syncEngine.userAccountStore,
      ...(needsCloudRoutes ? {
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
    if (process.env.DATABASE_URL) {
      const { PostgresAdapter } = await import('@edgeruntime/cloud-sync');
      log.info('Using PostgreSQL SyncDatabaseAdapter (DATABASE_URL detected)');
      return new PostgresAdapter(process.env.DATABASE_URL);
    }
    const { MemoryAdapter } = await import('@edgeruntime/cloud-sync');
    log.warn('Using in-memory SyncDatabaseAdapter — data will be lost on restart. Set DATABASE_URL for production.');
    return new MemoryAdapter();
  }

  /**
   * Create a default in-memory LicenseDatabaseAdapter for CLOUD mode dev/testing.
   * Production deployments should provide their own adapter via config.
   */
  private async createDefaultLicenseAdapter() {
    if (process.env.DATABASE_URL) {
      const { PostgresAdapter } = await import('@edgeruntime/cloud-sync');
      log.info('Using PostgreSQL LicenseDatabaseAdapter (DATABASE_URL detected)');
      return new PostgresAdapter(process.env.DATABASE_URL);
    }
    const { MemoryAdapter } = await import('@edgeruntime/cloud-sync');
    log.warn('Using in-memory LicenseDatabaseAdapter — data will be lost on restart. Set DATABASE_URL for production.');
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

  /**
   * Gracefully shut down the EdgeRuntime.
   *
   * Shutdown sequence (reverse of boot order to avoid dangling references):
   *   1. Stop camera sync polling timer
   *   2. Close realtime WebSocket channel (disconnects all dashboard clients)
   *   3. Close Fastify HTTP server (stops accepting new requests, drains in-flight)
   *   4. Stop federation manager (stops pushing events to peer VMs)
   *   5. Stop all PAC/VMS connectors (closes vendor API connections)
   *   6. Stop all product modules (cleanup hooks)
   *   7. Shutdown sync engine (flushes pending queue, closes SQLite)
   */
  async shutdown(): Promise<void> {
    log.info('EdgeRuntime shutting down...');

    // 1. Stop camera entity sync timer
    if (this.cameraSyncHandle) {
      clearInterval(this.cameraSyncHandle);
      this.cameraSyncHandle = null;
    }

    // 2. Close realtime WebSocket channel
    if (this.realtimeChannel) {
      this.realtimeChannel.shutdown();
    }

    // 3. Close HTTP server
    if (this.apiServer) {
      await this.apiServer.close();
    }

    // 4. Stop federation
    if (this.federationManager) {
      this.federationManager.shutdown();
    }

    // 5. Stop connectors
    await this.connectorRegistry.stopAll();

    // 6. Stop modules
    if (this.moduleRegistry) {
      await this.moduleRegistry.stopAll();
    }

    // 7. Shutdown sync engine
    if (this.syncEngine) {
      this.syncEngine.shutdown();
    }

    log.info('EdgeRuntime shutdown complete');
  }

  /** Get the validated activation key result (products, tier, proxy URL). Null before boot(). */
  getActivation(): ValidationResult | null {
    return this.activation;
  }

  /** Get the sync engine instance. Null before boot(). */
  getSyncEngine(): SyncEngine | null {
    return this.syncEngine;
  }

  /** Get the module registry with all loaded product modules. Null before boot(). */
  getModuleRegistry(): ModuleRegistry | null {
    return this.moduleRegistry;
  }

  /** Get the connector registry (always available, may be empty before boot). */
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

    // Process adapter updates from cloud
    if (config.adapterUpdates && config.adapterUpdates.length > 0 && this.adapterDownloader && this.adapterHotLoader && this.adapterInventory) {
      await this.processAdapterUpdates(config.adapterUpdates);
    }

    // Persist to config.yaml so settings survive restarts
    this.persistRemoteConfig(config);
  }

  /**
   * Process adapter update directives received from cloud.
   * Downloads bundles, verifies integrity, and hot-loads new adapter versions.
   */
  private async processAdapterUpdates(directives: AdapterUpdateDirective[]): Promise<void> {
    log.info({ count: directives.length }, 'Processing adapter updates from cloud');

    for (const directive of directives) {
      const result: import('@edgeruntime/sync-engine').AdapterUpdateResult = {
        adapterId: directive.adapterId,
        targetVersion: directive.targetVersion,
        status: 'failed',
        appliedAt: new Date().toISOString(),
      };

      try {
        // Check runtime compatibility
        if (directive.minRuntimeVersion) {
          const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
          const runtimeVersion = pkgJson.version || '0.0.0';
          // Simple check — skip if our version is older
          const rv = runtimeVersion.split('.').map(Number);
          const mv = directive.minRuntimeVersion.split('.').map(Number);
          if (rv[0]! < mv[0]! || (rv[0] === mv[0] && rv[1]! < mv[1]!)) {
            log.warn({ id: directive.adapterId, requires: directive.minRuntimeVersion, runtime: runtimeVersion }, 'Skipping adapter update — runtime too old');
            result.error = `Runtime ${runtimeVersion} < required ${directive.minRuntimeVersion}`;
            this.adapterUpdateResults.push(result);
            continue;
          }
        }

        // Download bundle
        const localPath = await this.adapterDownloader!.download(directive);

        // Hot-load the new version
        await this.adapterHotLoader!.replaceAdapter(
          directive.adapterId,
          localPath,
          directive.targetVersion,
          directive.bundleHash,
        );

        result.status = 'success';
        log.info({ id: directive.adapterId, version: directive.targetVersion }, 'Adapter updated successfully');
      } catch (err) {
        result.status = 'failed';
        result.error = (err as Error).message;
        log.error({ id: directive.adapterId, err: (err as Error).message }, 'Adapter update failed');
      }

      this.adapterUpdateResults.push(result);
    }

    // Update sync engine with new adapter versions and results
    if (this.syncEngine && this.adapterInventory) {
      this.syncEngine.setInstalledAdapters(this.adapterInventory.getVersionMap());
      this.syncEngine.setAdapterUpdateResults(this.adapterUpdateResults);
      this.adapterUpdateResults = []; // Clear after pushing to sync engine
    }
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
