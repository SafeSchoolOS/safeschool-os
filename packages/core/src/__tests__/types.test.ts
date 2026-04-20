import { describe, it, expect } from 'vitest';
import { LICENSE_TIERS, PRODUCT_FLAGS } from '../types.js';
import type {
  OperatingMode,
  LicenseTier,
  ProductFlag,
  SyncState,
  ModuleManifest,
  ConnectorDefinition,
  EdgeRuntimeConfig,
  FederationPeer,
  FederationRoute,
  FederationConfig,
} from '../types.js';

describe('LICENSE_TIERS', () => {
  it('should map index 0 to trial', () => {
    expect(LICENSE_TIERS[0]).toBe('trial');
  });

  it('should map index 1 to starter', () => {
    expect(LICENSE_TIERS[1]).toBe('starter');
  });

  it('should map index 2 to pro', () => {
    expect(LICENSE_TIERS[2]).toBe('pro');
  });

  it('should map index 3 to enterprise', () => {
    expect(LICENSE_TIERS[3]).toBe('enterprise');
  });

  it('should have exactly 4 tiers', () => {
    expect(Object.keys(LICENSE_TIERS)).toHaveLength(4);
  });

  it('should return undefined for out-of-range index', () => {
    expect(LICENSE_TIERS[99]).toBeUndefined();
  });
});

describe('PRODUCT_FLAGS', () => {
  it('should map index 0 to safeschool', () => {
    expect(PRODUCT_FLAGS[0]).toBe('safeschool');
  });

  it('should map index 1 to safeschool', () => {
    expect(PRODUCT_FLAGS[1]).toBe('safeschool');
  });

  it('should map index 2 to safeschool', () => {
    expect(PRODUCT_FLAGS[2]).toBe('safeschool');
  });

  it('should map index 3 to safeschool', () => {
    expect(PRODUCT_FLAGS[3]).toBe('safeschool');
  });

  it('should map index 4 to safeschool', () => {
    expect(PRODUCT_FLAGS[4]).toBe('safeschool');
  });

  it('should map index 5 to safeschool', () => {
    expect(PRODUCT_FLAGS[5]).toBe('safeschool');
  });

  it('should map index 6 to healthcare', () => {
    expect(PRODUCT_FLAGS[6]).toBe('healthcare');
  });

  it('should have exactly 7 product flags', () => {
    expect(Object.keys(PRODUCT_FLAGS)).toHaveLength(7);
  });

  it('should return undefined for out-of-range index', () => {
    expect(PRODUCT_FLAGS[99]).toBeUndefined();
  });
});

describe('Type assertions', () => {
  it('OperatingMode should accept valid modes', () => {
    const modes: OperatingMode[] = ['EDGE', 'STANDALONE', 'CLOUD', 'MIRROR'];
    expect(modes).toHaveLength(4);
    // TypeScript compile-time check — if this compiles, the types are correct
    modes.forEach((m) => expect(typeof m).toBe('string'));
  });

  it('SyncState should be structurally valid', () => {
    const state: SyncState = {
      siteId: 'test-site',
      lastSyncAt: new Date(),
      cloudReachable: true,
      operatingMode: 'EDGE',
      pendingChanges: 0,
    };
    expect(state.siteId).toBe('test-site');
    expect(state.cloudReachable).toBe(true);
    expect(state.pendingChanges).toBe(0);
    expect(state.lastError).toBeUndefined();
  });

  it('SyncState should accept optional lastError', () => {
    const state: SyncState = {
      siteId: 's1',
      lastSyncAt: new Date(),
      cloudReachable: false,
      operatingMode: 'CLOUD',
      pendingChanges: 5,
      lastError: 'connection timeout',
    };
    expect(state.lastError).toBe('connection timeout');
  });

  it('ModuleManifest should be structurally valid', () => {
    const manifest: ModuleManifest = {
      name: 'test-module',
      version: '1.0.0',
      product: 'safeschool',
      description: 'A test module',
      entityTypes: ['door', 'camera'],
    };
    expect(manifest.name).toBe('test-module');
    expect(manifest.entityTypes).toContain('door');
    expect(manifest.conflictStrategies).toBeUndefined();
  });

  it('ConnectorDefinition should allow extra properties', () => {
    const connector: ConnectorDefinition = {
      name: 'lenel-pacs',
      type: 'lenel-onguard',
      enabled: true,
      pollIntervalMs: 5000,
      apiUrl: 'https://pacs.example.com',
      apiKey: 'secret-key',
    };
    expect(connector.name).toBe('lenel-pacs');
    expect(connector['apiUrl']).toBe('https://pacs.example.com');
  });

  it('EdgeRuntimeConfig should have required fields', () => {
    const config: EdgeRuntimeConfig = {
      activationKey: 'TEST-KEY',
      siteId: 'site-1',
      dataDir: './data',
      syncIntervalMs: 30000,
      healthCheckIntervalMs: 15000,
      apiPort: 8470,
    };
    expect(config.activationKey).toBe('TEST-KEY');
    expect(config.operatingMode).toBeUndefined();
    expect(config.connectors).toBeUndefined();
  });

  it('FederationConfig should be structurally valid', () => {
    const peer: FederationPeer = {
      product: 'safeschool',
      host: '192.168.1.100',
      apiPort: 8470,
      syncKey: 'shared-secret',
    };
    const route: FederationRoute = {
      targetProduct: 'safeschool',
      entityTypes: ['access_event', 'lockdown'],
      direction: 'push',
    };
    const config: FederationConfig = {
      enabled: true,
      peers: [peer],
      routes: [route],
    };
    expect(config.enabled).toBe(true);
    expect(config.peers).toHaveLength(1);
    expect(config.routes[0].direction).toBe('push');
  });
});
